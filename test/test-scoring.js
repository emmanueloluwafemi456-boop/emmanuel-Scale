'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { extractPageSignals, extractProductSignals } = require('../lib/signal-extraction');
const { scoreCategories, computeOverallScore, computeCoverage, generateFindings } = require('../lib/scoring');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ok -', name);
    pass++;
  } catch (e) {
    console.log('  FAIL -', name, '->', e.message);
    fail++;
  }
}

const goodHome = fs.readFileSync(path.join(__dirname, 'fixtures/good-homepage.html'), 'utf8');
const poorHome = fs.readFileSync(path.join(__dirname, 'fixtures/poor-homepage.html'), 'utf8');
const goodProduct = fs.readFileSync(path.join(__dirname, 'fixtures/good-product.html'), 'utf8');
const thinProduct = fs.readFileSync(path.join(__dirname, 'fixtures/thin-product.html'), 'utf8');

const goodHomeSignals = extractPageSignals(goodHome, 'https://aurellestudio-test.example/');
const poorHomeSignals = extractPageSignals(poorHome, 'https://poorstore-test.example/');
const goodProductSignals = extractProductSignals(goodProduct, 'https://aurellestudio-test.example/products/signet-ring');
const thinProductSignals = extractProductSignals(thinProduct, 'https://poorstore-test.example/products/item');

console.log('=== scoreCategories: strong store (all signals present) ===');
const strongAgg = {
  homepage: goodHomeSignals,
  https: true,
  homepageStatus: 200,
  robotsTxtOk: true,
  sitemapOk: true,
  productPage: goodProductSignals,
};
const strongScores = scoreCategories(strongAgg);

check('technical score is high (>= 85)', () => assert.ok(strongScores.technical.score >= 85, 'got ' + strongScores.technical.score));
check('technical not limited data', () => assert.strictEqual(strongScores.technical.limitedData, false));
check('cro score is high (>= 80)', () => assert.ok(strongScores.cro.score >= 80, 'got ' + strongScores.cro.score));
check('product score is high (>= 80)', () => assert.ok(strongScores.product.score >= 80, 'got ' + strongScores.product.score));
check('trust score is high (>= 80)', () => assert.ok(strongScores.trust.score >= 80, 'got ' + strongScores.trust.score));
check('ux score is high (>= 80)', () => assert.ok(strongScores.ux.score >= 80, 'got ' + strongScores.ux.score));
check('mobile score is 100 (both viewport checks pass)', () => assert.strictEqual(strongScores.mobile.score, 100));
check('all scores are 0-100 integers', () => {
  Object.values(strongScores).forEach((c) => {
    if (c.score != null) {
      assert.ok(Number.isInteger(c.score));
      assert.ok(c.score >= 0 && c.score <= 100);
    }
  });
});

const strongOverall = computeOverallScore(strongScores);
check('overall score computed and high', () => assert.ok(strongOverall >= 80, 'got ' + strongOverall));

const strongCoverage = computeCoverage(strongScores);
check('coverage is high for a fully-crawled strong store', () => assert.ok(strongCoverage >= 90, 'got ' + strongCoverage));

const strongFindings = generateFindings(strongScores);
check('few or no findings for a strong store', () => assert.ok(strongFindings.length <= 2, 'got ' + strongFindings.length + ': ' + JSON.stringify(strongFindings.map((f) => f.issue))));

console.log('=== scoreCategories: weak store ===');
const weakAgg = {
  homepage: poorHomeSignals,
  https: false,
  homepageStatus: 200,
  robotsTxtOk: false,
  sitemapOk: false,
  productPage: thinProductSignals,
};
const weakScores = scoreCategories(weakAgg);

check('technical score is low (<= 40)', () => assert.ok(weakScores.technical.score <= 40, 'got ' + weakScores.technical.score));
check('cro score is low (<= 40)', () => assert.ok(weakScores.cro.score <= 40, 'got ' + weakScores.cro.score));
check('product score is low (<= 40)', () => assert.ok(weakScores.product.score <= 40, 'got ' + weakScores.product.score));
check('trust score is low (<= 40)', () => assert.ok(weakScores.trust.score <= 40, 'got ' + weakScores.trust.score));

const weakFindings = generateFindings(weakScores);
check('many findings for a weak store', () => assert.ok(weakFindings.length >= 4, 'got ' + weakFindings.length));
check('findings sorted HIGH first', () => {
  const ranks = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  for (let i = 1; i < weakFindings.length; i++) {
    assert.ok(ranks[weakFindings[i - 1].priority] <= ranks[weakFindings[i].priority]);
  }
});
check('https finding present for non-https weak store', () => assert.ok(weakFindings.some((f) => f.issue.includes('HTTPS'))));
check('every finding has priority/category/issue/why/recommendation', () => {
  weakFindings.forEach((f) => {
    assert.ok(f.priority && f.category && f.issue && f.why && f.recommendation);
  });
});

console.log('=== product page not found -> exact LIMITED DATA message, no fabricated score ===');
const noProductAgg = {
  homepage: goodHomeSignals,
  https: true,
  homepageStatus: 200,
  robotsTxtOk: true,
  sitemapOk: true,
  productPage: null,
};
const noProductScores = scoreCategories(noProductAgg);
check('product score is null', () => assert.strictEqual(noProductScores.product.score, null));
check('product limitedData true', () => assert.strictEqual(noProductScores.product.limitedData, true));
check('exact reason text matches spec', () => assert.strictEqual(noProductScores.product.reason, "Limited data — we couldn't reliably identify a product page to analyze."));
check('overall score excludes product category weighting when null (still computes from others)', () => {
  const overall = computeOverallScore(noProductScores);
  assert.ok(overall != null && overall > 0);
});

console.log('=== fully unreachable page (homepage null) -> every category limited data, no crash ===');
const emptyAgg = { homepage: null, https: null, homepageStatus: null, robotsTxtOk: null, sitemapOk: null, productPage: null };
const emptyScores = scoreCategories(emptyAgg);
check('all categories are limitedData/null', () => {
  Object.values(emptyScores).forEach((c) => assert.strictEqual(c.score, null));
});
check('overall score is null when nothing evaluable', () => assert.strictEqual(computeOverallScore(emptyScores), null));
check('coverage is 0 when nothing evaluable', () => assert.strictEqual(computeCoverage(emptyScores), 0));
check('no findings generated from an empty audit (no false confirmations)', () => assert.strictEqual(generateFindings(emptyScores).length, 0));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
