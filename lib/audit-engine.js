'use strict';

/**
 * Orchestrates a full store audit: this is the only place that combines
 * network I/O with the pure signal extraction / scoring modules. Kept
 * deliberately thin — all the actual analysis logic lives in
 * signal-extraction.js and scoring.js so it can be unit-tested without a
 * network connection.
 *
 * `runAudit(rawStoreUrl, deps)` accepts an optional `deps.fetcher`
 * override purely so tests can inject a deterministic fake fetcher
 * (see test/test-audit-engine.js). In production, `api/audit.js` never
 * passes `deps`, so the real SSRF-safe `safeFetch` is always what
 * actually talks to the internet.
 */

const { safeFetch, validateUrl, SsrfError } = require('./ssrf-guard');
const { extractPageSignals, extractProductSignals } = require('./signal-extraction');
const { scoreCategories, computeOverallScore, computeCoverage, generateFindings } = require('./scoring');

const MAX_PRODUCT_PAGES = 2;
const PAGE_TIMEOUT_MS = 6000;

/** Normalizes user input like "mystore.com" or "www.mystore.com " into a full https URL. */
function normalizeStoreUrl(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new SsrfError('Please enter a store URL.', 'EMPTY_URL');
  }
  let s = raw.trim();
  if (!s) throw new SsrfError('Please enter a store URL.', 'EMPTY_URL');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const url = validateUrl(s); // throws SsrfError on anything unsafe/malformed
  return url.toString();
}

async function tryPath(fetcher, baseUrl, pathname) {
  try {
    const target = new URL(pathname, baseUrl).toString();
    const res = await fetcher(target, { timeoutMs: 4000, maxBytes: 512 * 1024 });
    return res.status >= 200 && res.status < 300;
  } catch (e) {
    return false;
  }
}

/**
 * Runs the full audit for a normalized store URL. Never throws for
 * ordinary reachability problems — those are represented in the
 * returned object's `status` field so the API layer can produce a
 * clean, specific error message instead of a 500.
 */
async function runAudit(rawStoreUrl, deps) {
  const fetcher = (deps && deps.fetcher) || safeFetch;
  const timestamp = new Date().toISOString();
  let storeUrl;
  try {
    storeUrl = normalizeStoreUrl(rawStoreUrl);
  } catch (e) {
    const status = e instanceof SsrfError && e.code === 'BLOCKED_HOST' ? 'BLOCKED_HOST' : 'INVALID_URL';
    return { status, message: e.message, timestamp };
  }

  const host = new URL(storeUrl).hostname.replace(/^www\./, '');

  // 1. Homepage — this is required; everything else is best-effort.
  let homepageRes;
  try {
    homepageRes = await fetcher(storeUrl, { timeoutMs: PAGE_TIMEOUT_MS });
  } catch (e) {
    if (e instanceof SsrfError && e.code === 'BLOCKED_HOST') {
      return { status: 'BLOCKED_HOST', message: e.message, timestamp, storeUrl };
    }
    return { status: 'UNREACHABLE', message: e.message || 'This store could not be reached.', timestamp, storeUrl };
  }

  if (homepageRes.status === 403 || homepageRes.status === 999) {
    return { status: 'CRAWL_BLOCKED', message: 'This store is currently preventing automated analysis.', timestamp, storeUrl };
  }
  if (homepageRes.status >= 400) {
    return { status: 'UNREACHABLE', message: 'This store returned an error page (HTTP ' + homepageRes.status + ').', timestamp, storeUrl };
  }

  const homepageSignals = extractPageSignals(homepageRes.body, homepageRes.finalUrl);
  const isHttps = new URL(homepageRes.finalUrl).protocol === 'https:';

  // 2. robots.txt / sitemap.xml — best effort, run in parallel.
  const [robotsTxtOk, sitemapOk] = await Promise.all([
    tryPath(fetcher, homepageRes.finalUrl, '/robots.txt'),
    tryPath(fetcher, homepageRes.finalUrl, '/sitemap.xml'),
  ]);

  // 3. Discover + fetch a limited number of product pages.
  const candidateProductLinks = homepageSignals.productLinks.slice(0, MAX_PRODUCT_PAGES);
  let productPage = null;
  let productPageUrl = null;
  const pageErrors = [];

  for (const link of candidateProductLinks) {
    try {
      const res = await fetcher(link, { timeoutMs: PAGE_TIMEOUT_MS });
      if (res.status >= 200 && res.status < 300) {
        productPage = extractProductSignals(res.body, res.finalUrl);
        productPageUrl = res.finalUrl;
        break; // one good product page is enough for v1
      }
    } catch (e) {
      pageErrors.push({ url: link, error: e.message });
    }
  }

  // If none of the homepage's own /products/ links worked, try one
  // discovered collection page as a fallback path to find a product.
  if (!productPage && homepageSignals.collectionLinks.length > 0) {
    try {
      const collectionUrl = homepageSignals.collectionLinks[0];
      const res = await fetcher(collectionUrl, { timeoutMs: PAGE_TIMEOUT_MS });
      if (res.status >= 200 && res.status < 300) {
        const collectionSignals = extractPageSignals(res.body, res.finalUrl);
        const fallbackLink = collectionSignals.productLinks[0];
        if (fallbackLink) {
          const pRes = await fetcher(fallbackLink, { timeoutMs: PAGE_TIMEOUT_MS });
          if (pRes.status >= 200 && pRes.status < 300) {
            productPage = extractProductSignals(pRes.body, pRes.finalUrl);
            productPageUrl = pRes.finalUrl;
          }
        }
      }
    } catch (e) {
      pageErrors.push({ url: 'collection-fallback', error: e.message });
    }
  }

  const agg = {
    homepage: homepageSignals,
    https: isHttps,
    homepageStatus: homepageRes.status,
    robotsTxtOk,
    sitemapOk,
    productPage,
    productPageUrl,
  };

  const categoryScores = scoreCategories(agg);
  const overallScore = computeOverallScore(categoryScores);
  const coverage = computeCoverage(categoryScores);
  const findings = generateFindings(categoryScores, 6);

  return {
    status: 'OK',
    timestamp,
    storeUrl: homepageRes.finalUrl,
    storeHost: host,
    overallScore,
    coverage,
    categoryScores,
    findings,
    productPageUrl,
    pageErrors,
  };
}

module.exports = { runAudit, normalizeStoreUrl };
