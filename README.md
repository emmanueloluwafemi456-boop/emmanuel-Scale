# Emmanuel Scale — Growth OS

The portfolio site for Emmanuel's Shopify growth agency: a single-page
dark-mode site with service pages, case studies, and an interactive
growth calculator.

**Hosted on GitHub Pages, no build step:** the entire site is one
self-contained `docs/index.html` (React + Tailwind, loaded from CDN,
JSX compiled in-browser by Babel Standalone). There's no bundler, no
`dist/` folder, and nothing to compile — what's in `docs/index.html`
is exactly what ships.

## Folder structure

```
docs/               The entire site — this is what GitHub Pages serves
  index.html            Single-file React app (all pages, all components)
  favicon.svg, .ico, *.png, site.webmanifest

api/, lib/          A dormant Vercel serverless backend (not currently
                        deployed — see "About the Free Store Audit
                        backend" below). GitHub Pages never serves these.
test/               188 tests for that backend, plus a local dev server
vercel.json         Config for if the Vercel backend is ever redeployed
package.json        The only dependency (cheerio) is used by api/*.js
```

## Deploying (GitHub Pages)

1. Push this repo to GitHub (or upload the files through the GitHub
   web UI — no git required).
2. In the repo: **Settings → Pages**.
3. Under **"Build and deployment" → Source**, choose **"Deploy from a
   branch"**.
4. Branch: **main** (or whichever branch has this code), Folder:
   **`/docs`**.
5. Save. GitHub gives you a live URL — typically
   `https://<username>.github.io/<repo-name>/` — within a minute or two.

That's it. Everything on the site (all pages, the growth calculator,
the application form) runs entirely client-side or talks to a
third-party service directly from the browser, so plain static hosting
is all it needs.

## About the Free Store Audit backend

Earlier this project included a fully automated "Free Store Audit"
tool — it would actually crawl a submitted Shopify store and generate
real, live SEO/CRO/trust scores. That required a real server, which
GitHub Pages can't provide, so that page has been removed from the
live site (its CTAs now point to the application form in `#contact`
instead, which still works — see below).

The backend code that powered it hasn't been deleted, only disconnected
— it's sitting dormant in `api/` and `lib/`, fully tested (188 tests,
`npm test`). If you ever want that feature live again, it can be
redeployed on Vercel (or similar) without rebuilding anything; see
**SETUP.md** for the full walkthrough.

## The application form still works without any backend

The "Apply For Free Growth Audit" form in the Contact section submits
directly to [Web3Forms](https://web3forms.com) — a third-party API
called straight from the browser. It needs no server of your own, so
it works exactly the same on GitHub Pages as anywhere else.

## Local development

Just open `docs/index.html` directly in a browser, or serve the
`docs/` folder with any static file server. Note it loads
React/Tailwind/Babel from public CDNs, so normal internet access is
needed to render it.

If you also want to run/test the dormant backend locally:
```
npm install
npm run dev
```
starts a local server on `http://localhost:5311` serving `docs/` and
routing `/api/*` to the real function handlers, mimicking Vercel's
routing convention.

## Testing

```
npm test
```
Runs the 188 backend tests (SSRF protection, HTML signal extraction,
scoring, end-to-end audit orchestration, rate limiting, email
formatting, API validation). These test the dormant `api/`/`lib/`
backend, not the live GitHub Pages site — the live site has no backend
to test.

## Notes

- `chats/` and `project/` (if present) are archival design-handoff
  material from this site's original build and aren't part of the
  deployed app.
- Hash-based routing (`#zesto`, `#cro-optimization`, etc.) means every
  route is just `docs/index.html` loaded once, with the right page
  resolved client-side from the URL fragment — no server-side routing
  config needed, which is exactly why plain static hosting works here.
