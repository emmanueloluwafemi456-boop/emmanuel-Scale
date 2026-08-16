'use strict';

/**
 * Pure HTML signal extraction. No network I/O happens in this file —
 * every function here takes an already-fetched HTML string (or a cheerio
 * object) and returns plain observations. This is what makes the audit
 * engine's scoring logic unit-testable without a network connection.
 */

const cheerio = require('cheerio');

const REVIEW_APP_HINTS = ['judge.me', 'loox', 'yotpo', 'stamped.io', 'okendo', 'reviews.io', 'trustpilot', 'ryviu', 'ali-reviews'];

function textOf($, sel) {
  const t = $(sel).first().text();
  return t ? t.trim() : '';
}

function attrOf($, sel, attr) {
  const v = $(sel).first().attr(attr);
  return v ? String(v).trim() : '';
}

function bodyText($) {
  // Strip script/style before reading text so we don't match keywords
  // hidden inside JS blobs (e.g. an app's config JSON mentioning "sale").
  const $clone = $.root().clone();
  $clone.find('script, style, noscript').remove();
  return $clone.text().replace(/\s+/g, ' ').trim();
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

/**
 * Extracts site-wide / homepage-level signals from a parsed page.
 * Safe to call on any page (homepage, collection, product) — product-
 * specific extraction happens separately in extractProductSignals.
 */
function extractPageSignals(html, pageUrl) {
  const $ = cheerio.load(html);
  const body = bodyText($);
  const rawHtml = $.html();
  const host = hostnameOf(pageUrl);

  const imgs = $('img');
  const imgTotal = imgs.length;
  let imgWithAlt = 0;
  imgs.each((_, el) => {
    const alt = $(el).attr('alt');
    if (alt && alt.trim().length > 0) imgWithAlt++;
  });

  const headings = $('h1, h2, h3');
  let emptyHeadings = 0;
  headings.each((_, el) => {
    if (!$(el).text().trim()) emptyHeadings++;
  });

  const internalLinks = new Set();
  const productLinks = new Set();
  const collectionLinks = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    let abs;
    try {
      abs = new URL(href, pageUrl).toString();
    } catch (e) {
      return;
    }
    const linkHost = hostnameOf(abs);
    if (!host || linkHost === host) {
      internalLinks.add(abs);
      if (/\/products\//.test(abs)) productLinks.add(abs.split('?')[0]);
      if (/\/collections\//.test(abs)) collectionLinks.add(abs.split('?')[0]);
    }
  });

  const linkTextBlob = $('a')
    .map((_, el) => $(el).text())
    .get()
    .join(' ')
    .toLowerCase();

  const hasSearch =
    $('input[type="search"]').length > 0 ||
    $('form[action*="/search"]').length > 0 ||
    $('[name*="search" i]').length > 0 ||
    /\bsearch\b/i.test(linkTextBlob);

  const navPresent = $('nav').length > 0 || $('header a').length >= 3;
  const footerPresent = $('footer').length > 0;
  const footerLinksCount = $('footer a').length;

  const hasMailto = $('a[href^="mailto:"]').length > 0;
  const contactLinkPresent = hasMailto || /\/pages\/contact|\bcontact us\b|\bcontact\b/i.test(linkTextBlob);

  const policyPattern = (re) => $('a').filter((_, el) => re.test($(el).attr('href') || '') || re.test($(el).text() || '')).length > 0;
  const privacyPolicy = policyPattern(/privacy/i);
  const termsPolicy = policyPattern(/terms/i);
  const shippingPolicy = policyPattern(/shipping/i);
  const returnsPolicy = policyPattern(/refund|return/i);

  const ctaPattern = /\b(shop now|buy now|add to cart|shop the sale|get yours|shop all|shop collection)\b/i;
  const ctaButtonsCount = $('a, button')
    .filter((_, el) => ctaPattern.test($(el).text() || ''))
    .length;

  const reviewAppScript = $('script[src]')
    .map((_, el) => $(el).attr('src') || '')
    .get()
    .some((src) => REVIEW_APP_HINTS.some((hint) => src.toLowerCase().includes(hint)));

  const structuredDataBlocks = $('script[type="application/ld+json"]');
  let hasAggregateRating = false;
  let hasProductSchema = false;
  structuredDataBlocks.each((_, el) => {
    const raw = $(el).contents().text();
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      items.forEach((item) => {
        const type = item && (item['@type'] || '');
        const typeStr = Array.isArray(type) ? type.join(',') : String(type || '');
        if (/aggregaterating/i.test(JSON.stringify(item))) hasAggregateRating = true;
        if (/product/i.test(typeStr)) hasProductSchema = true;
      });
    } catch (e) {
      // ignore malformed JSON-LD, not fatal to the audit
    }
  });

  const reviewsSignal = reviewAppScript || hasAggregateRating || /\b\d(\.\d)?\s*(out of 5|stars?)\b/i.test(body) || /\breviews?\b/i.test(linkTextBlob);

  const socialLinks = $('a[href*="instagram.com"], a[href*="facebook.com"], a[href*="tiktok.com"], a[href*="x.com"], a[href*="twitter.com"]').length > 0;

  return {
    pageUrl,
    title: textOf($, 'title'),
    metaDescription: attrOf($, 'meta[name="description"]', 'content'),
    canonical: attrOf($, 'link[rel="canonical"]', 'href'),
    viewport: attrOf($, 'meta[name="viewport"]', 'content'),
    metaRobots: attrOf($, 'meta[name="robots"]', 'content'),
    h1Count: $('h1').length,
    emptyHeadingsCount: emptyHeadings,
    imgTotal,
    imgWithAlt,
    structuredDataPresent: structuredDataBlocks.length > 0,
    hasProductSchema,
    internalLinksCount: internalLinks.size,
    internalLinks: Array.from(internalLinks).slice(0, 50),
    productLinks: Array.from(productLinks),
    collectionLinks: Array.from(collectionLinks),
    navPresent,
    hasSearch,
    footerPresent,
    footerLinksCount,
    contactLinkPresent,
    privacyPolicy,
    termsPolicy,
    shippingPolicy,
    returnsPolicy,
    ctaButtonsCount,
    reviewsSignal,
    hasAggregateRating,
    guaranteeSignal: /\bmoney[\s-]?back\b|\bguarantee(d)?\b|\brisk[\s-]?free\b/i.test(body),
    shippingInfoSignal: /\bfree shipping\b|\bshipping (info|policy|rates|calculated)\b/i.test(body),
    faqSignal: /\bfaqs?\b|\bfrequently asked\b/i.test(body) || headings.filter((_, el) => /faq|frequently asked/i.test($(el).text())).length > 0,
    offerSignal: /(\d{1,2}%\s?off)|\bsale\b|\bdiscount\b|\bcoupon\b|\bpromo code\b/i.test(body),
    subscriptionSignal: /subscribe\s?(&|and)\s?save|\bsubscription\b/i.test(body),
    bundleSignal: /\bbundle\b|frequently bought together|complete the (look|set)/i.test(body),
    socialLinks,
    bodyTextLength: body.length,
    htmlLength: rawHtml.length,
  };
}

/**
 * Extracts product-page-specific signals. Call only on pages that were
 * fetched from a discovered /products/ URL.
 */
function extractProductSignals(html, pageUrl) {
  const $ = cheerio.load(html);
  const body = bodyText($);

  const priceSignal = /[$£€]\s?\d[\d,.]*/.test(body) || $('[itemprop="price"], meta[property="product:price:amount"]').length > 0;
  const compareAtSignal = $('s, del, [class*="compare" i]').length > 0 && /[$£€]\s?\d[\d,.]*/.test($('s, del, [class*="compare" i]').text());
  const variantSelector = $('select').length > 0 || $('[role="radiogroup"]').length > 0 || $('[class*="variant" i], [name*="variant" i]').length > 0;
  const addToCartPresent =
    $('form[action*="/cart/add"]').length > 0 ||
    $('button, input[type="submit"]')
      .filter((_, el) => /add to cart|add to bag/i.test($(el).text() || $(el).attr('value') || ''))
      .length > 0;
  const buyNowPresent = /\bbuy it now\b|\bbuy now\b/i.test(body);
  const imgs = $('img').length;
  const crossSellPresent = /you may also like|related products|pairs well|complete the look|frequently bought together/i.test(body);

  const descCandidates = ['.product-description', '[class*="product-description" i]', '[class*="product__description" i]', 'main', 'article'];
  let descriptionLength = 0;
  for (const sel of descCandidates) {
    const t = $(sel).first().text().trim();
    if (t.length > descriptionLength) descriptionLength = t.length;
  }

  const h1 = textOf($, 'h1');

  return {
    pageUrl,
    productTitle: h1 || textOf($, 'title'),
    priceSignal,
    compareAtSignal,
    variantSelector,
    addToCartPresent,
    buyNowPresent,
    imagesCount: imgs,
    descriptionLength,
    crossSellPresent,
    reviewsSignal: /\breviews?\b/i.test(body) || $('script[src]').map((_, el) => $(el).attr('src') || '').get().some((src) => REVIEW_APP_HINTS.some((h) => src.toLowerCase().includes(h))),
  };
}

module.exports = {
  extractPageSignals,
  extractProductSignals,
  hostnameOf,
  bodyText,
};
