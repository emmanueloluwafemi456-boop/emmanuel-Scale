'use strict';

/**
 * Deterministic, weighted scoring for the Free Store Audit.
 *
 * Every check below is a pure function of the aggregated signals object
 * produced by the orchestrator in audit-engine.js. Each check returns:
 *   true   -> the positive signal was observed
 *   false  -> the signal was checked for and confirmed absent
 *   null   -> inconclusive / not applicable (NOT counted as a failure)
 *
 * A category's score is the weighted pass-rate across only its
 * evaluable (non-null) checks. If fewer than MIN_EVALUABLE_RATIO of a
 * category's total weight was evaluable, the category is reported as
 * LIMITED_DATA instead of a fabricated number.
 */

const MIN_EVALUABLE_RATIO = 0.5;

function ratioAtLeast(count, total, ratio) {
  if (!total || total <= 0) return null;
  return count / total >= ratio;
}

function hasReasonableLength(str, min, max) {
  if (str == null) return false;
  const len = String(str).trim().length;
  if (len === 0) return false;
  return len >= min && len <= max;
}

function atLeastTwoOf(...bools) {
  return bools.filter(Boolean).length >= 2;
}

/* ---------------------------------------------------------------- */
/* Check registries, one array per category. Weights sum to 100.     */
/* ---------------------------------------------------------------- */

const CHECKS = {
  technical: [
    { id: 'https', weight: 20, label: 'Served over HTTPS', evaluate: (a) => (a.https == null ? null : a.https) },
    { id: 'statusOk', weight: 15, label: 'Homepage responds successfully', evaluate: (a) => (a.homepageStatus == null ? null : a.homepageStatus === 200) },
    { id: 'title', weight: 10, label: 'Title tag present and reasonably sized', evaluate: (a) => (a.homepage ? hasReasonableLength(a.homepage.title, 10, 70) : null) },
    { id: 'metaDescription', weight: 10, label: 'Meta description present and reasonably sized', evaluate: (a) => (a.homepage ? hasReasonableLength(a.homepage.metaDescription, 50, 160) : null) },
    { id: 'canonical', weight: 8, label: 'Canonical tag present', evaluate: (a) => (a.homepage ? a.homepage.canonical.length > 0 : null) },
    { id: 'viewportPresent', weight: 8, label: 'Responsive viewport tag present', evaluate: (a) => (a.homepage ? /width\s*=\s*device-width/i.test(a.homepage.viewport) : null) },
    { id: 'headingStructure', weight: 8, label: 'Clean heading structure', evaluate: (a) => (a.homepage ? a.homepage.h1Count >= 1 && a.homepage.h1Count <= 2 && a.homepage.emptyHeadingsCount === 0 : null) },
    { id: 'imgAlt', weight: 8, label: 'Most images have alt text', evaluate: (a) => (a.homepage ? ratioAtLeast(a.homepage.imgWithAlt, a.homepage.imgTotal, 0.7) : null) },
    { id: 'structuredData', weight: 5, label: 'Structured data present', evaluate: (a) => (a.homepage ? a.homepage.structuredDataPresent : null) },
    { id: 'robotsTxt', weight: 4, label: 'robots.txt reachable', evaluate: (a) => a.robotsTxtOk },
    { id: 'sitemapXml', weight: 4, label: 'sitemap.xml reachable', evaluate: (a) => a.sitemapOk },
  ],
  seo: [
    { id: 'seoTitle', weight: 15, label: 'Title tag present and reasonably sized', evaluate: (a) => (a.homepage ? hasReasonableLength(a.homepage.title, 10, 70) : null) },
    { id: 'seoMetaDescription', weight: 15, label: 'Meta description present and reasonably sized', evaluate: (a) => (a.homepage ? hasReasonableLength(a.homepage.metaDescription, 50, 160) : null) },
    { id: 'seoHeadingStructure', weight: 12, label: 'Exactly one H1', evaluate: (a) => (a.homepage ? a.homepage.h1Count === 1 : null) },
    { id: 'seoCanonical', weight: 10, label: 'Canonical tag present', evaluate: (a) => (a.homepage ? a.homepage.canonical.length > 0 : null) },
    { id: 'seoStructuredData', weight: 10, label: 'Structured data present', evaluate: (a) => (a.homepage ? a.homepage.structuredDataPresent : null) },
    { id: 'seoRobotsTxt', weight: 8, label: 'robots.txt reachable', evaluate: (a) => a.robotsTxtOk },
    { id: 'seoSitemapXml', weight: 8, label: 'sitemap.xml reachable', evaluate: (a) => a.sitemapOk },
    { id: 'seoImgAlt', weight: 10, label: 'Most images have alt text', evaluate: (a) => (a.homepage ? ratioAtLeast(a.homepage.imgWithAlt, a.homepage.imgTotal, 0.7) : null) },
    { id: 'seoIndexable', weight: 12, label: 'Homepage is indexable', evaluate: (a) => (a.homepage ? !/noindex/i.test(a.homepage.metaRobots) : null) },
  ],
  ux: [
    { id: 'navPresent', weight: 15, label: 'Primary navigation present', evaluate: (a) => (a.homepage ? a.homepage.navPresent : null) },
    { id: 'searchPresent', weight: 10, label: 'Site search available', evaluate: (a) => (a.homepage ? a.homepage.hasSearch : null) },
    { id: 'collectionsFound', weight: 15, label: 'Product collections discoverable', evaluate: (a) => (a.homepage ? a.homepage.collectionLinks.length > 0 : null) },
    { id: 'footerPresent', weight: 10, label: 'Footer present', evaluate: (a) => (a.homepage ? a.homepage.footerPresent : null) },
    { id: 'footerLinksCount', weight: 10, label: 'Footer provides useful navigation', evaluate: (a) => (a.homepage ? a.homepage.footerLinksCount >= 4 : null) },
    { id: 'contactLinkPresentUx', weight: 15, label: 'Contact information findable', evaluate: (a) => (a.homepage ? a.homepage.contactLinkPresent : null) },
    { id: 'policyLinksPresent', weight: 15, label: 'Key policy pages linked', evaluate: (a) => (a.homepage ? atLeastTwoOf(a.homepage.privacyPolicy, a.homepage.termsPolicy, a.homepage.shippingPolicy, a.homepage.returnsPolicy) : null) },
    { id: 'ctaVisibleUx', weight: 10, label: 'Primary CTA visible on homepage', evaluate: (a) => (a.homepage ? a.homepage.ctaButtonsCount > 0 : null) },
  ],
  cro: [
    { id: 'ctaVisibleCro', weight: 12, label: 'Primary CTA visible', evaluate: (a) => (a.homepage ? a.homepage.ctaButtonsCount > 0 : null) },
    { id: 'reviewsSignalCro', weight: 18, label: 'Reviews / social proof visible', evaluate: (a) => (a.homepage ? a.homepage.reviewsSignal : null) },
    { id: 'guaranteeSignal', weight: 10, label: 'Guarantee / risk-reversal messaging', evaluate: (a) => (a.homepage ? a.homepage.guaranteeSignal : null) },
    { id: 'shippingInfoSignal', weight: 10, label: 'Shipping information visible', evaluate: (a) => (a.homepage ? a.homepage.shippingInfoSignal : null) },
    { id: 'faqSignal', weight: 10, label: 'FAQ content present', evaluate: (a) => (a.homepage ? a.homepage.faqSignal : null) },
    { id: 'offerSignal', weight: 8, label: 'Offer / promo messaging present', evaluate: (a) => (a.homepage ? a.homepage.offerSignal : null) },
    { id: 'subscriptionSignal', weight: 8, label: 'Subscription option surfaced (where relevant)', evaluate: (a) => (a.homepage ? a.homepage.subscriptionSignal : null) },
    { id: 'bundleSignal', weight: 8, label: 'Bundle / cross-sell messaging present', evaluate: (a) => (a.homepage ? a.homepage.bundleSignal : null) },
    { id: 'addToCartOnProduct', weight: 16, label: 'Add-to-cart clearly available on product page', evaluate: (a) => (a.productPage ? a.productPage.addToCartPresent : null) },
  ],
  product: [
    { id: 'priceSignal', weight: 18, label: 'Price clearly displayed', evaluate: (a) => (a.productPage ? a.productPage.priceSignal : null) },
    { id: 'addToCartPresent', weight: 20, label: 'Add-to-cart action present', evaluate: (a) => (a.productPage ? a.productPage.addToCartPresent : null) },
    { id: 'variantSelector', weight: 10, label: 'Variant selection available (where relevant)', evaluate: (a) => (a.productPage ? a.productPage.variantSelector : null) },
    { id: 'imagesCount', weight: 12, label: 'Multiple product images', evaluate: (a) => (a.productPage ? a.productPage.imagesCount >= 2 : null) },
    { id: 'descriptionLength', weight: 15, label: 'Substantive product description', evaluate: (a) => (a.productPage ? a.productPage.descriptionLength >= 150 : null) },
    { id: 'productReviewsSignal', weight: 15, label: 'Reviews visible on product page', evaluate: (a) => (a.productPage ? a.productPage.reviewsSignal : null) },
    { id: 'crossSellPresent', weight: 10, label: 'Cross-sell / related products shown', evaluate: (a) => (a.productPage ? a.productPage.crossSellPresent : null) },
  ],
  mobile: [
    { id: 'viewportPresent', weight: 70, label: 'Responsive viewport tag present', evaluate: (a) => (a.homepage ? /width\s*=\s*device-width/i.test(a.homepage.viewport) : null) },
    { id: 'viewportInitialScale', weight: 30, label: 'Viewport scale configured', evaluate: (a) => (a.homepage ? /initial-scale/i.test(a.homepage.viewport) : null) },
  ],
  trust: [
    { id: 'reviewsSignalTrust', weight: 20, label: 'Reviews / ratings visible', evaluate: (a) => (a.homepage ? a.homepage.reviewsSignal : null) },
    { id: 'contactLinkPresentTrust', weight: 15, label: 'Contact information findable', evaluate: (a) => (a.homepage ? a.homepage.contactLinkPresent : null) },
    { id: 'shippingPolicy', weight: 12, label: 'Shipping policy linked', evaluate: (a) => (a.homepage ? a.homepage.shippingPolicy : null) },
    { id: 'returnsPolicy', weight: 15, label: 'Return / refund policy linked', evaluate: (a) => (a.homepage ? a.homepage.returnsPolicy : null) },
    { id: 'privacyPolicy', weight: 12, label: 'Privacy policy linked', evaluate: (a) => (a.homepage ? a.homepage.privacyPolicy : null) },
    { id: 'termsPolicy', weight: 8, label: 'Terms of service linked', evaluate: (a) => (a.homepage ? a.homepage.termsPolicy : null) },
    { id: 'guaranteeSignalTrust', weight: 10, label: 'Guarantee messaging present', evaluate: (a) => (a.homepage ? a.homepage.guaranteeSignal : null) },
    { id: 'httpsTrust', weight: 8, label: 'Secure (HTTPS) connection', evaluate: (a) => (a.https == null ? null : a.https) },
  ],
};

/**
 * Scores every category from the aggregated signals object.
 * Returns { ux: {score, coverageRatio, checks}, ... } — score is a
 * 0-100 integer, or null (with limitedData:true) when there wasn't
 * enough evaluable data.
 */
function scoreCategories(agg) {
  const result = {};

  Object.keys(CHECKS).forEach((category) => {
    const checks = CHECKS[category];
    const totalWeight = checks.reduce((s, c) => s + c.weight, 0);

    // PRODUCT is a special case: if we never found/fetched a product
    // page at all, don't run the threshold math — go straight to the
    // exact "limited data" messaging the spec calls for.
    if (category === 'product' && !agg.productPage) {
      result.product = {
        score: null,
        limitedData: true,
        reason: "Limited data — we couldn't reliably identify a product page to analyze.",
        checks: checks.map((c) => ({ id: c.id, label: c.label, result: null })),
      };
      return;
    }

    let evaluableWeight = 0;
    let passedWeight = 0;
    const checkResults = [];

    checks.forEach((c) => {
      const r = c.evaluate(agg);
      checkResults.push({ id: c.id, label: c.label, result: r });
      if (r === true || r === false) {
        evaluableWeight += c.weight;
        if (r === true) passedWeight += c.weight;
      }
    });

    const coverageRatio = totalWeight > 0 ? evaluableWeight / totalWeight : 0;

    if (coverageRatio < MIN_EVALUABLE_RATIO) {
      result[category] = {
        score: null,
        limitedData: true,
        reason: 'LIMITED DATA — not enough of this store could be reliably analyzed for this category.',
        coverageRatio,
        checks: checkResults,
      };
    } else {
      const score = Math.round((passedWeight / evaluableWeight) * 100);
      result[category] = {
        score,
        limitedData: false,
        coverageRatio,
        checks: checkResults,
      };
    }
  });

  return result;
}

/** Weighted overall score across only the categories that have real data. */
function computeOverallScore(categoryScores) {
  const CATEGORY_WEIGHTS = { ux: 15, cro: 20, product: 20, mobile: 10, trust: 15, technical: 12, seo: 8 };
  let weightSum = 0;
  let scoreSum = 0;
  Object.keys(categoryScores).forEach((cat) => {
    const c = categoryScores[cat];
    if (c.score != null) {
      const w = CATEGORY_WEIGHTS[cat] || 0;
      weightSum += w;
      scoreSum += c.score * w;
    }
  });
  if (weightSum === 0) return null;
  return Math.round(scoreSum / weightSum);
}

/** % of all defined checks (across all categories) that returned real data. */
function computeCoverage(categoryScores) {
  let total = 0;
  let evaluated = 0;
  Object.keys(categoryScores).forEach((cat) => {
    categoryScores[cat].checks.forEach((c) => {
      total++;
      if (c.result === true || c.result === false) evaluated++;
    });
  });
  if (total === 0) return 0;
  return Math.round((evaluated / total) * 100);
}

/* ---------------------------------------------------------------- */
/* Findings: only generated for checks that returned a CONFIRMED     */
/* false (i.e. we actually observed the issue) — never for null.     */
/* ---------------------------------------------------------------- */

const FINDING_TEMPLATES = {
  https: { priority: 'HIGH', category: 'TECHNICAL', issue: 'Store is not served over HTTPS', why: 'Browsers actively warn visitors on non-secure pages, which damages trust and can block checkout entirely on modern browsers.', recommendation: 'Enable HTTPS across the entire storefront (Shopify provides this by default on all plans) and ensure there are no mixed-content warnings.' },
  addToCartOnProduct: { priority: 'HIGH', category: 'CRO', issue: 'No clear add-to-cart action detected on the product page', why: 'If the purchase action is not immediately obvious, visitors who are ready to buy can hesitate or leave.', recommendation: 'Make sure the add-to-cart / buy-now button is prominent, above the fold, and unambiguous on every product page.' },
  addToCartPresent: { priority: 'HIGH', category: 'PRODUCT', issue: 'No add-to-cart action detected on the product page', why: 'This is the single most important element on a product page — without a clear path to purchase, traffic to this page cannot convert.', recommendation: 'Verify the add-to-cart button renders correctly and is not being blocked by a script error or theme issue.' },
  priceSignal: { priority: 'HIGH', category: 'PRODUCT', issue: 'Price was not clearly detected on the product page', why: 'Visitors need to see the price without extra effort to make a purchase decision.', recommendation: 'Confirm price is rendered directly in the page HTML and is visible without requiring a variant selection first.' },
  reviewsSignalCro: { priority: 'HIGH', category: 'CRO', issue: 'No visible customer reviews or ratings detected', why: 'Social proof is one of the strongest conversion levers in ecommerce; visitors without evidence of prior purchases are less likely to trust and buy.', recommendation: 'Add a reviews app (e.g. Judge.me, Loox, or Shopify Product Reviews) and surface ratings on both the homepage and product pages.' },
  productReviewsSignal: { priority: 'MEDIUM', category: 'PRODUCT', issue: 'No reviews visible on the product page', why: 'Reviews at the point of decision reduce purchase hesitation more effectively than reviews elsewhere on the site.', recommendation: 'Surface star ratings and review snippets directly on the product page, near the price and add-to-cart button.' },
  descriptionLength: { priority: 'HIGH', category: 'PRODUCT', issue: 'Weak benefit communication', why: 'The product page does not make the primary customer benefit immediately obvious near the purchase decision area.', recommendation: 'Strengthen the value proposition and make the key benefits easier to scan before the purchase CTA.' },
  guaranteeSignal: { priority: 'MEDIUM', category: 'TRUST', issue: 'No guarantee or risk-reversal messaging found', why: 'Guarantees lower the perceived risk of a first purchase, which matters most for visitors unfamiliar with the brand.', recommendation: 'Add a clear guarantee (e.g. a money-back or satisfaction guarantee) near the CTA and in the footer.' },
  returnsPolicy: { priority: 'MEDIUM', category: 'TRUST', issue: 'No return or refund policy link found', why: 'A visible returns policy is one of the top trust signals for first-time ecommerce buyers.', recommendation: 'Link a clear returns/refund policy from the footer and reference it near the add-to-cart button.' },
  shippingInfoSignal: { priority: 'MEDIUM', category: 'CRO', issue: 'Shipping information is not clearly visible', why: 'Unclear shipping costs or timelines are one of the most common causes of cart abandonment.', recommendation: 'Surface shipping cost and estimated delivery time on the product page or in a persistent header/announcement bar.' },
  faqSignal: { priority: 'LOW', category: 'CRO', issue: 'No FAQ section detected', why: 'FAQs pre-empt common objections that would otherwise stop a visitor from completing checkout.', recommendation: 'Add a short FAQ section addressing shipping, returns, sizing/fit, and product care where relevant.' },
  collectionsFound: { priority: 'MEDIUM', category: 'UX', issue: 'Product collections were not easily discoverable from the homepage', why: 'If visitors cannot quickly browse by category, they are more likely to leave before finding a product to buy.', recommendation: 'Make sure collection/category links are present in the main navigation and easy to find from the homepage.' },
  searchPresent: { priority: 'LOW', category: 'UX', issue: 'No site search was detected', why: 'Visitors who know what they want but cannot search for it often leave rather than browse manually.', recommendation: 'Add a visible search icon or bar in the header.' },
  contactLinkPresentTrust: { priority: 'MEDIUM', category: 'TRUST', issue: 'No clear contact information was found', why: 'Visible contact details reassure visitors that a real business is behind the store.', recommendation: 'Add a contact page or visible contact details (email, form, or phone) in the header or footer.' },
  imgAlt: { priority: 'LOW', category: 'TECHNICAL', issue: 'Most images are missing alt text', why: 'Missing alt text hurts accessibility and image SEO, and is an easy technical fix.', recommendation: 'Add descriptive alt text to product and homepage images.' },
  metaDescription: { priority: 'MEDIUM', category: 'SEO', issue: 'Meta description is missing or poorly sized', why: 'The meta description is often the first thing a potential customer reads in search results before clicking through.', recommendation: 'Write a unique, compelling meta description (roughly 50-160 characters) for the homepage and key pages.' },
  ctaVisibleUx: { priority: 'MEDIUM', category: 'UX', issue: 'No clear primary call-to-action detected on the homepage', why: 'Visitors need an obvious next step; without one, homepage traffic disperses instead of converting.', recommendation: 'Add a clear, prominent CTA (e.g. "Shop Now") above the fold on the homepage.' },
  bundleSignal: { priority: 'LOW', category: 'CRO', issue: 'No bundle or cross-sell messaging detected', why: 'Bundles and cross-sells are a low-effort way to increase average order value.', recommendation: 'Consider surfacing a simple bundle or "frequently bought together" offer on product pages.' },
};

/**
 * Builds the Top Opportunities list: only from checks that were
 * CONFIRMED false, sorted HIGH -> MEDIUM -> LOW, deduplicated by issue.
 */
function generateFindings(categoryScores, limit) {
  const priorityRank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const findings = [];
  const seenIssues = new Set();

  Object.keys(categoryScores).forEach((cat) => {
    categoryScores[cat].checks.forEach((c) => {
      if (c.result !== false) return;
      const tmpl = FINDING_TEMPLATES[c.id];
      if (!tmpl) return;
      if (seenIssues.has(tmpl.issue)) return;
      seenIssues.add(tmpl.issue);
      findings.push({ ...tmpl });
    });
  });

  findings.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
  return findings.slice(0, limit || 6);
}

module.exports = {
  CHECKS,
  scoreCategories,
  computeOverallScore,
  computeCoverage,
  generateFindings,
};
