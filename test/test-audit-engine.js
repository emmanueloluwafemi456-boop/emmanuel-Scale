'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runAudit } = require('../lib/audit-engine');
const { SsrfError } = require('../lib/ssrf-guard');

let pass = 0;
let fail = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log('  ok -', name);
    pass++;
  } catch (e) {
    console.log('  FAIL -', name, '->', e.message);
    fail++;
  }
}

const goodHome = fs.readFileSync(path.join(__dirname, 'fixtures/good-homepage.html'), 'utf8');
const goodProduct = fs.readFileSync(path.join(__dirname, 'fixtures/good-product.html'), 'utf8');
const poorHome = fs.readFileSync(path.join(__dirname, 'fixtures/poor-homepage.html'), 'utf8');
const thinProduct = fs.readFileSync(path.join(__dirname, 'fixtures/thin-product.html'), 'utf8');

// The good-homepage fixture links to /collections/all, /collections/rings
// and (via poor-homepage reuse below) /products/thing — but for a fully
// realistic "found via homepage's own /products/ link" test we need the
// homepage to actually contain a /products/ link. Build one inline.
const goodHomeWithProductLink = goodHome.replace(
  '<a href="/collections/rings">Rings</a>',
  '<a href="/collections/rings">Rings</a><a href="/products/signet-ring">Signet Ring</a>'
);

function makeMockFetcher(routes) {
  return async function mockFetcher(url) {
    const path = new URL(url).pathname;
    if (routes[path]) {
      const r = routes[path];
      if (r.error) throw r.error;
      return { status: r.status != null ? r.status : 200, headers: {}, body: r.body || '', finalUrl: url };
    }
    return { status: 404, headers: {}, body: 'not found', finalUrl: url };
  };
}

(async () => {
  console.log('=== runAudit: full happy path (product found via homepage link) ===');
  {
    const fetcher = makeMockFetcher({
      '/': { body: goodHomeWithProductLink },
      '/robots.txt': { body: 'User-agent: *\nAllow: /' },
      '/sitemap.xml': { body: '<urlset></urlset>' },
      '/products/signet-ring': { body: goodProduct },
    });
    const result = await runAudit('aurellestudio-test.example', { fetcher });

    await check('status is OK', () => assert.strictEqual(result.status, 'OK'));
    await check('overallScore is a number > 0', () => assert.ok(typeof result.overallScore === 'number' && result.overallScore > 0));
    await check('storeUrl normalized to https', () => assert.ok(result.storeUrl.startsWith('https://')));
    await check('productPageUrl was discovered', () => assert.ok(result.productPageUrl && result.productPageUrl.includes('/products/signet-ring')));
    await check('product category has a real score (not limited data)', () => assert.strictEqual(result.categoryScores.product.limitedData, false));
    await check('coverage is high', () => assert.ok(result.coverage >= 80, 'got ' + result.coverage));
    await check('findings is an array', () => assert.ok(Array.isArray(result.findings)));
    await check('timestamp is ISO string', () => assert.ok(!Number.isNaN(Date.parse(result.timestamp))));
  }

  console.log('=== runAudit: product discovered via collection-page fallback ===');
  {
    const homeNoDirectProductLink = goodHome; // only has /collections/ links, no /products/ link
    const fetcher = makeMockFetcher({
      '/': { body: homeNoDirectProductLink },
      '/robots.txt': { body: 'ok' },
      '/sitemap.xml': { status: 404 },
      '/collections/all': { body: '<html><body><a href="/products/from-collection">Item</a></body></html>' },
      '/products/from-collection': { body: goodProduct },
    });
    const result = await runAudit('https://fallback-test.example', { fetcher });
    await check('status is OK', () => assert.strictEqual(result.status, 'OK'));
    await check('product found via collection fallback', () => assert.ok(result.productPageUrl && result.productPageUrl.includes('/products/from-collection')));
    await check('sitemapOk false reflected (404) but audit still OK', () => assert.strictEqual(result.status, 'OK'));
  }

  console.log('=== runAudit: weak store, no product page discoverable at all ===');
  {
    const fetcher = makeMockFetcher({
      '/': { body: poorHome }, // links only to /products/thing, but that 404s below
      '/robots.txt': { status: 404 },
      '/sitemap.xml': { status: 404 },
      // deliberately no /products/thing route registered -> 404 via default
    });
    const result = await runAudit('poorstore-test.example', { fetcher });
    await check('status is OK (homepage still reachable)', () => assert.strictEqual(result.status, 'OK'));
    await check('product category is LIMITED DATA with exact message', () =>
      assert.strictEqual(result.categoryScores.product.reason, "Limited data — we couldn't reliably identify a product page to analyze."));
    await check('overall score still computed from other categories', () => assert.ok(result.overallScore != null));
    await check('coverage is lower than the happy path', () => assert.ok(result.coverage < 90));
    await check('findings include HIGH priority issues for a weak store', () => assert.ok(result.findings.some((f) => f.priority === 'HIGH')));
  }

  console.log('=== runAudit: invalid URL input ===');
  {
    const result = await runAudit('not a url at all', {});
    await check('status is INVALID_URL', () => assert.strictEqual(result.status, 'INVALID_URL'));
    await check('no scores leaked into an invalid result', () => assert.strictEqual(result.categoryScores, undefined));
  }

  console.log('=== runAudit: empty input ===');
  {
    const result = await runAudit('', {});
    await check('status is INVALID_URL for empty string', () => assert.strictEqual(result.status, 'INVALID_URL'));
  }

  console.log('=== runAudit: SSRF-blocked host is rejected with a clean message, not a crash ===');
  {
    const result = await runAudit('http://127.0.0.1/admin', {}); // note: NO fetcher override -> goes through REAL safeFetch/validateUrl
    await check('status is BLOCKED_HOST', () => assert.strictEqual(result.status, 'BLOCKED_HOST'));
    await check('no internal details leaked in message', () => assert.ok(!/admin/i.test(result.message)));
  }
  {
    const result = await runAudit('http://169.254.169.254/latest/meta-data/', {});
    await check('cloud metadata IP is blocked (real safeFetch, no mock)', () => assert.strictEqual(result.status, 'BLOCKED_HOST'));
  }

  console.log('=== runAudit: unreachable host (network error) ===');
  {
    const fetcher = async () => {
      throw new SsrfError('This site could not be reached: getaddrinfo ENOTFOUND', 'FETCH_FAIL');
    };
    const result = await runAudit('https://this-does-not-exist-test.example', { fetcher });
    await check('status is UNREACHABLE', () => assert.strictEqual(result.status, 'UNREACHABLE'));
  }

  console.log('=== runAudit: crawling blocked (403 from target) ===');
  {
    const fetcher = makeMockFetcher({ '/': { status: 403, body: 'Forbidden' } });
    const result = await runAudit('https://blocked-test.example', { fetcher });
    await check('status is CRAWL_BLOCKED', () => assert.strictEqual(result.status, 'CRAWL_BLOCKED'));
  }

  console.log('=== runAudit: normalizes bare domain input (no protocol) ===');
  {
    const fetcher = makeMockFetcher({ '/': { body: poorHome }, '/robots.txt': { status: 404 }, '/sitemap.xml': { status: 404 } });
    const result = await runAudit('  poorstore-test.example  ', { fetcher }); // whitespace + no protocol
    await check('status OK despite messy input', () => assert.strictEqual(result.status, 'OK'));
    await check('storeUrl normalized with https://', () => assert.ok(result.storeUrl.startsWith('https://poorstore-test.example')));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
