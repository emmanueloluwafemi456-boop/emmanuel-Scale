'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { extractPageSignals, extractProductSignals } = require('../lib/signal-extraction');

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

console.log('=== extractPageSignals: good homepage ===');
const good = extractPageSignals(goodHome, 'https://aurellestudio-test.example/');
check('title extracted', () => assert.strictEqual(good.title, 'Aurelle Studio — Modern Everyday Jewelry'));
check('metaDescription extracted', () => assert.ok(good.metaDescription.includes('Aurelle Studio')));
check('canonical extracted', () => assert.strictEqual(good.canonical, 'https://aurellestudio-test.example/'));
check('viewport extracted', () => assert.ok(good.viewport.includes('width=device-width')));
check('h1Count === 1', () => assert.strictEqual(good.h1Count, 1));
check('structuredDataPresent true', () => assert.strictEqual(good.structuredDataPresent, true));
check('navPresent true', () => assert.strictEqual(good.navPresent, true));
check('hasSearch true', () => assert.strictEqual(good.hasSearch, true));
check('footerPresent true', () => assert.strictEqual(good.footerPresent, true));
check('footerLinksCount >= 4', () => assert.ok(good.footerLinksCount >= 4, 'got ' + good.footerLinksCount));
check('contactLinkPresent true (mailto)', () => assert.strictEqual(good.contactLinkPresent, true));
check('privacyPolicy true', () => assert.strictEqual(good.privacyPolicy, true));
check('termsPolicy true', () => assert.strictEqual(good.termsPolicy, true));
check('shippingPolicy true', () => assert.strictEqual(good.shippingPolicy, true));
check('returnsPolicy true', () => assert.strictEqual(good.returnsPolicy, true));
check('ctaButtonsCount > 0', () => assert.ok(good.ctaButtonsCount > 0));
check('reviewsSignal true (judge.me script)', () => assert.strictEqual(good.reviewsSignal, true));
check('guaranteeSignal true', () => assert.strictEqual(good.guaranteeSignal, true));
check('shippingInfoSignal true', () => assert.strictEqual(good.shippingInfoSignal, true));
check('faqSignal true', () => assert.strictEqual(good.faqSignal, true));
check('offerSignal true (20% off)', () => assert.strictEqual(good.offerSignal, true));
check('subscriptionSignal true', () => assert.strictEqual(good.subscriptionSignal, true));
check('bundleSignal true', () => assert.strictEqual(good.bundleSignal, true));
check('socialLinks true', () => assert.strictEqual(good.socialLinks, true));
check('collectionLinks found', () => assert.ok(good.collectionLinks.length >= 2, 'got ' + good.collectionLinks.length));
check('imgWithAlt === imgTotal (1 img, has alt)', () => assert.strictEqual(good.imgWithAlt, good.imgTotal));

console.log('=== extractPageSignals: poor homepage ===');
const poor = extractPageSignals(poorHome, 'https://poorstore-test.example/');
check('title is minimal', () => assert.strictEqual(poor.title, 'x'));
check('metaDescription empty', () => assert.strictEqual(poor.metaDescription, ''));
check('canonical empty', () => assert.strictEqual(poor.canonical, ''));
check('viewport empty -> device-width check fails', () => assert.ok(!/width=device-width/i.test(poor.viewport)));
check('h1Count === 0', () => assert.strictEqual(poor.h1Count, 0));
check('structuredDataPresent false', () => assert.strictEqual(poor.structuredDataPresent, false));
check('navPresent false', () => assert.strictEqual(poor.navPresent, false));
check('hasSearch false', () => assert.strictEqual(poor.hasSearch, false));
check('footerPresent false', () => assert.strictEqual(poor.footerPresent, false));
check('contactLinkPresent false', () => assert.strictEqual(poor.contactLinkPresent, false));
check('privacyPolicy false', () => assert.strictEqual(poor.privacyPolicy, false));
check('reviewsSignal false', () => assert.strictEqual(poor.reviewsSignal, false));
check('guaranteeSignal false', () => assert.strictEqual(poor.guaranteeSignal, false));
check('productLinks found (1 product link)', () => assert.strictEqual(poor.productLinks.length, 1));
check('imgWithAlt === 0 (no alt attrs)', () => assert.strictEqual(poor.imgWithAlt, 0));
check('imgTotal === 2', () => assert.strictEqual(poor.imgTotal, 2));

console.log('=== extractProductSignals: good product page ===');
const goodP = extractProductSignals(goodProduct, 'https://aurellestudio-test.example/products/signet-ring');
check('productTitle extracted', () => assert.strictEqual(goodP.productTitle, 'Aurelle Signet Ring'));
check('priceSignal true', () => assert.strictEqual(goodP.priceSignal, true));
check('compareAtSignal true', () => assert.strictEqual(goodP.compareAtSignal, true));
check('variantSelector true', () => assert.strictEqual(goodP.variantSelector, true));
check('addToCartPresent true (form action)', () => assert.strictEqual(goodP.addToCartPresent, true));
check('buyNowPresent true', () => assert.strictEqual(goodP.buyNowPresent, true));
check('imagesCount === 3', () => assert.strictEqual(goodP.imagesCount, 3));
check('descriptionLength >= 150', () => assert.ok(goodP.descriptionLength >= 150, 'got ' + goodP.descriptionLength));
check('crossSellPresent true', () => assert.strictEqual(goodP.crossSellPresent, true));
check('reviewsSignal true', () => assert.strictEqual(goodP.reviewsSignal, true));

console.log('=== extractProductSignals: thin product page ===');
const thinP = extractProductSignals(thinProduct, 'https://poorstore-test.example/products/item');
check('priceSignal false', () => assert.strictEqual(thinP.priceSignal, false));
check('addToCartPresent false', () => assert.strictEqual(thinP.addToCartPresent, false));
check('variantSelector false', () => assert.strictEqual(thinP.variantSelector, false));
check('descriptionLength small', () => assert.ok(thinP.descriptionLength < 150));
check('crossSellPresent false', () => assert.strictEqual(thinP.crossSellPresent, false));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
