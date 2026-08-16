# Free Store Audit — Setup Guide (currently dormant)

**Status: this feature is not live on the site right now.** The site is
hosted on GitHub Pages (static-only, no server), so the automated audit tool
— which needs a real backend to safely crawl a store and score it — was
disconnected from the live pages. Its CTAs now point to the "Apply For Free
Growth Audit" contact form instead, which needs no backend and works fine on
GitHub Pages.

The backend that powered it (`api/`, `lib/`) is untouched and fully tested —
this document is for if/when you want to bring it back by redeploying on
Vercel alongside GitHub Pages. It explains what exists, what's still needed,
and how to deploy it.

## Important: the frontend page was also removed, not just disconnected

The `/free-store-audit` page's React components (the URL form, loading
state, results dashboard, lead form) were removed from `docs/index.html`
entirely — deploying the backend alone will **not** bring the page back.
That frontend code still exists in this repo's git history, in the commit
that removed it (look for "drop the Free Store Audit tool" or similar in
`git log`) — restore it from there, re-add the two router lines for the
`free-store-audit` hash, and point the CTAs back to it before redeploying
the backend.

## What exists

```
docs/index.html       <- your live site (the audit page/route is NOT in here right now)
api/audit.js          <- POST: crawls a public storefront and returns real scores
api/lead.js            <- POST: saves + emails a "get my full audit" submission
api/manual-review.js   <- POST: saves + emails a "review my store manually" submission
lib/                   <- the actual audit engine (SSRF-safe fetcher, HTML signal
                           extraction, deterministic scoring, email, storage, rate limiting)
test/                  <- 188 automated tests covering the backend (run: npm test)
vercel.json            <- output folder + serverless function timeout config
```

## Why a real deployment is required

A single HTML file cannot safely fetch arbitrary third-party websites,
send email, or persist data — that all requires a server. `api/*.js` are
written as **Vercel serverless functions**, the smallest way to add "a
server" to a static site without changing how the rest of your site is
built or hosted. You don't have to use Vercel specifically, but these
files assume that convention (a `(req, res) => {}` handler per file in
`/api`, auto-routed).

## What you need to create (all free-tier, ~10 minutes)

1. **A Vercel account** — [vercel.com](https://vercel.com), sign in with GitHub.
2. **A Resend account** — [resend.com](https://resend.com), for sending you
   the lead-notification emails. Free tier: 3,000 emails/month.
3. **A KV/Redis store for persisting leads** — the easiest path is Vercel's
   own **Storage → KV** tab inside your Vercel project (a few clicks, no
   separate signup); it's Upstash under the hood. A standalone
   [Upstash](https://upstash.com) account works identically if you prefer.

## Step-by-step deploy

1. Push this folder to a GitHub repo (or run `vercel` from the CLI directly
   in this folder — either works).
2. In Vercel: **New Project → Import** your repo. Framework preset: "Other".
   `vercel.json` already points the build output at `docs/`, so no
   configuration is needed — it's static + serverless functions as-is.
   (This deploys the whole site again, on Vercel, in parallel with GitHub
   Pages — you'd end up choosing one as your real domain.)
3. In your new Vercel project → **Settings → Environment Variables**, add:

   | Variable | Value | Required? |
   |---|---|---|
   | `RESEND_API_KEY` | from your Resend dashboard | Yes, for email |
   | `LEAD_TO_EMAIL` | `emmanueloluwafemi456@gmail.com` (default if unset) | No |
   | `RESEND_FROM_EMAIL` | e.g. `Store Audit <audit@yourdomain.com>` once you verify a domain in Resend. Until then it falls back to Resend's shared `onboarding@resend.dev` sender, which works immediately but is less deliverable long-term. | No (has a fallback) |

4. In your Vercel project → **Storage → Create Database → KV**, then connect
   it to this project. Vercel automatically injects `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` for you — nothing to copy/paste.

   *(If you'd rather use a standalone Upstash Redis database instead, set
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` yourself — the
   code accepts either naming convention.)*

5. Deploy. Vercel gives you a `*.vercel.app` URL (or attach your own domain
   in Settings → Domains).

**Until steps 3–4 are done**, the audit page still works end-to-end for
visitors (real crawling, real scores, real findings) — only the final
"submit my details" step will honestly tell the visitor it couldn't go
through, instead of pretending it succeeded. Nothing fakes success.

## Verifying it after deploy

(Assumes you've restored the frontend page per the note above — otherwise
there's no UI to test this from yet.)

1. Visit `your-domain/#free-store-audit`.
2. Enter a real Shopify store URL and click "Analyze My Store →". You
   should see real, varying scores — try two different real stores and
   confirm the numbers differ (proof it's not hardcoded).
3. Try an obviously invalid entry (e.g. `not a url`) — should show
   "Please enter a valid Shopify store URL."
4. Submit the "Get My Full Audit" form with a real name/email — you should
   receive an email at your configured address within a few seconds,
   containing the store domain, all category scores, coverage %, and top
   findings.
5. Click "Book a Strategy Call →" on the success screen — confirm it opens
   `https://calendly.com/emmanueldigitals/30min` in a new tab.

## How the audit actually works (so you can explain it to prospects)

For a submitted URL, the backend:
- Validates and normalizes it, and rejects anything that isn't a safe
  public `http(s)` address (no localhost, internal IPs, cloud metadata
  endpoints, etc. — see `lib/ssrf-guard.js`).
- Fetches the homepage, `robots.txt`, and `sitemap.xml`.
- Looks for a `/products/` link on the homepage (or via one collection
  page as a fallback) and fetches one product page if found.
- Extracts ~50 concrete, observable signals from that HTML (title/meta/
  headings/alt text/structured data, nav/search/footer/policy links,
  reviews/guarantee/FAQ/offer text, price/add-to-cart/variants/
  description on the product page, etc.) — see `lib/signal-extraction.js`.
- Scores 7 categories from weighted checks against those signals, and
  reports **"LIMITED DATA"** instead of a number for any category where
  too little could actually be observed — see `lib/scoring.js`.
- Generates the "Top Opportunities" list only from checks that were
  *confirmed* false — never from an inconclusive check.

Nothing is invented. If a check can't be evaluated, it contributes
nothing to the score rather than being guessed.

## Known V1 limitations (by design, not bugs)

- **Mobile scoring** is based only on the responsive `<meta viewport>`
  markup — there's no real device/browser rendering test (no PageSpeed/
  Lighthouse API key is configured). The results page never claims a real
  device test happened.
- **One product page** is analyzed per audit (not the whole catalog), to
  keep each audit fast and within serverless function time limits.
- **Lead score integrity**: the "submit for full audit" form forwards the
  scores the visitor's browser already received from `/api/audit` rather
  than re-crawling. For a public lead-gen form this is a reasonable
  trade-off, but a technically sophisticated visitor could in theory tamper
  with the numbers before submitting. If that ever matters to you, the
  clean fix is to have `/api/audit` cache its result server-side under a
  short-lived ID and have `/api/lead` look it up by that ID instead of
  trusting the client payload — noted here for a V2, not implemented now
  to keep V1 minimal per your brief.
- **No AI summarization** is wired in (no AI API key was available/
  requested). All findings are deterministic and rule-based. If you want
  AI-written summaries of the *already-collected* facts later, that's a
  small addition to `lib/scoring.js`'s output — it should never be given
  license to invent data itself.
- **Admin view**: there's no dashboard UI. Leads are queryable via
  `lib/store.js`'s `listLeads()` — you already get the email for every
  submission regardless, per your own requirement.

## Rate limits (already implemented, active once KV is configured)

- 8 audits / hour / IP address
- 10 lead or manual-review submissions / day / IP address

If KV isn't configured yet, these fail *open* (requests are still
allowed) rather than breaking the feature — but that means abuse
protection isn't actually active until you complete step 4 above.

## Running the test suite yourself

```
npm install
npm test
```

188 tests covering SSRF protection (blocked IP ranges, DNS-rebinding
defense, protocol/port validation), HTML signal extraction, the scoring
engine (including the "not enough data" paths), the full crawl
orchestration, rate limiting, email formatting, and every API handler's
input validation and error paths.
