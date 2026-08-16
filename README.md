# Emmanuel Scale — Growth OS

The portfolio site for Emmanuel's Shopify growth agency: a single-page
dark-mode site with service pages, case studies, an interactive growth
calculator, and a real, functional **Free Shopify Store Audit** tool
backed by serverless functions.

**Live architecture, no build step:** the frontend is one self-contained
`public/index.html` (React + Tailwind, loaded from CDN, JSX compiled
in-browser by Babel Standalone). The backend is a handful of small
Vercel serverless functions in `api/`. There's no bundler, no `dist/`
folder, and nothing to compile — what you see in `public/index.html`
is exactly what ships.

## Folder structure

```
public/            The entire static site — deploy target
  index.html          Single-file React app (all pages, all components)
  favicon.svg, .ico, *.png, site.webmanifest

api/                Vercel serverless functions
  audit.js             POST — crawls a store URL, returns real audit scores
  lead.js               POST — saves + emails a "get my full audit" submission
  manual-review.js      POST — saves + emails a "review manually" request

lib/                The actual audit engine used by api/*.js
  ssrf-guard.js         SSRF-safe fetcher (blocks private IPs, pins DNS, etc.)
  signal-extraction.js  Pure HTML → signals parser (cheerio, no network I/O)
  scoring.js             Deterministic 0–100 scoring across 7 categories
  audit-engine.js        Orchestrates a full audit end to end
  email.js                Resend integration for lead-notification emails
  kv.js, store.js, rate-limit.js   Upstash/Vercel KV client, lead log, rate limits

test/               188 dependency-free tests + a local dev server
  run-all.js             Test runner (npm test)
  dev-server.js           Local server emulating Vercel's routing (npm run dev)
  fixtures/               Sample HTML used by the signal-extraction tests

vercel.json         Deployment config (output dir, function timeouts)
package.json        The only dependency is cheerio, used by api/*.js
.env.example         Every environment variable the backend reads
SETUP.md            Full deployment walkthrough with a step-by-step checklist
```

## Local development

```
npm install
npm run dev
```

This starts a local server on `http://localhost:5311` that serves
`public/` and routes `/api/*` to the real function handlers — the same
routing convention Vercel uses. Note that `public/index.html` still
loads React/Tailwind/Babel from public CDNs, so normal internet access
is required to render it in a browser; only the `/api/*` routes run
fully locally.

## Testing

```
npm test
```

Runs all 188 tests (SSRF protection, HTML signal extraction, scoring,
end-to-end audit orchestration, rate limiting, email formatting, and
every API handler's validation/error paths). No test framework
dependency — plain Node `assert`, run via `test/run-all.js`.

## Deploying to Vercel

1. Push this repo to GitHub.
2. In Vercel: **New Project → Import** this repo. Framework preset:
   **Other**. No build command needed to change — `vercel.json` already
   points `outputDirectory` at `public/`.
3. Add the environment variables listed in `.env.example` under
   **Settings → Environment Variables** (at minimum `RESEND_API_KEY` to
   enable the audit lead-notification emails).
4. For rate limiting and lead persistence, add a KV database via
   **Storage → Create Database → KV** — Vercel injects the two required
   env vars automatically.
5. Deploy.

The site works even before steps 3–4 are done — the audit tool still
runs real crawls and real scoring; only the final "submit" step will
honestly report that it couldn't go through, rather than faking
success. See **SETUP.md** for the full walkthrough, a post-deploy
verification checklist, and how the audit engine works under the hood.

## Notes

- `chats/` and `project/` are archival design-handoff material from
  this site's original build and aren't part of the deployed app.
- Hash-based routing (`#free-store-audit`, `#zesto`, etc.) means there's
  no server-side routing/rewrite config to maintain — every route is a
  plain static `public/index.html` load, resolved client-side.
