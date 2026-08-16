'use strict';

const assert = require('assert');
const { buildLeadEmail, isConfigured } = require('../lib/email');

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

console.log('=== buildLeadEmail ===');
const audit = {
  timestamp: '2026-08-15T12:00:00.000Z',
  overallScore: 74,
  coverage: 82,
  categoryScores: {
    ux: { score: 82 }, cro: { score: 68 }, product: { score: null }, mobile: { score: 71 },
    trust: { score: 79 }, technical: { score: 84 }, seo: { score: 73 },
  },
  findings: [
    { priority: 'HIGH', category: 'PRODUCT', issue: 'Weak benefit communication' },
    { priority: 'MEDIUM', category: 'TRUST', issue: 'No guarantee messaging found' },
  ],
};

const { subject, text, html } = buildLeadEmail({
  storeDomain: 'example.com',
  name: 'Jane Doe',
  email: 'jane@example.com',
  goal: 'Conversion rate',
  audit,
  submissionType: 'audit',
});

check('subject matches exact spec format', () => assert.strictEqual(subject, 'NEW FREE STORE AUDIT — example.com'));
check('text includes NEW STORE AUDIT LEAD header', () => assert.ok(text.includes('NEW STORE AUDIT LEAD')));
check('text includes store domain', () => assert.ok(text.includes('example.com')));
check('text includes name', () => assert.ok(text.includes('Jane Doe')));
check('text includes email', () => assert.ok(text.includes('jane@example.com')));
check('text includes goal', () => assert.ok(text.includes('Conversion rate')));
check('text includes overall score', () => assert.ok(text.includes('Overall Store Health:\n74')));
check('text includes UX score', () => assert.ok(text.includes('UX:\n82')));
check('text includes CRO score', () => assert.ok(text.includes('CRO:\n68')));
check('text shows LIMITED DATA for null product score (not fabricated)', () => assert.ok(text.includes('Product:\nLIMITED DATA')));
check('text includes mobile/trust/technical/seo scores', () => {
  assert.ok(text.includes('Mobile:\n71'));
  assert.ok(text.includes('Trust:\n79'));
  assert.ok(text.includes('Technical:\n84'));
  assert.ok(text.includes('SEO:\n73'));
});
check('text includes audit coverage', () => assert.ok(text.includes('AUDIT COVERAGE:\n82%')));
check('text includes numbered top opportunities', () => assert.ok(text.includes('1. [HIGH] (PRODUCT) Weak benefit communication')));
check('text includes second finding', () => assert.ok(text.includes('2. [MEDIUM] (TRUST) No guarantee messaging found')));
check('text includes audit timestamp', () => assert.ok(text.includes('AUDIT TIMESTAMP:\n2026-08-15T12:00:00.000Z')));
check('html is escaped (no raw <script> possible from name field)', () => {
  const { html: htmlXss } = buildLeadEmail({ storeDomain: 'x.com', name: '<script>alert(1)</script>', email: 'a@b.com', goal: '', audit, submissionType: 'audit' });
  assert.ok(!htmlXss.includes('<script>alert'));
  assert.ok(htmlXss.includes('&lt;script&gt;'));
});

console.log('=== manual review submission type ===');
const manual = buildLeadEmail({ storeDomain: 'noaudit.com', name: 'Bob', email: 'bob@noaudit.com', goal: 'Not sure', audit: null, submissionType: 'manual-review' });
check('subject still uses the store domain', () => assert.strictEqual(manual.subject, 'NEW FREE STORE AUDIT — noaudit.com'));
check('text flags manual review request', () => assert.ok(manual.text.includes('MANUAL REVIEW REQUEST')));
check('handles missing audit gracefully with LIMITED DATA everywhere, no crash', () => {
  assert.ok(manual.text.includes('UX:\nLIMITED DATA'));
  assert.ok(manual.text.includes('Overall Store Health:\nN/A'));
});

console.log('=== isConfigured ===');
check('false when RESEND_API_KEY unset', () => {
  delete process.env.RESEND_API_KEY;
  assert.strictEqual(isConfigured(), false);
});
check('true when RESEND_API_KEY set', () => {
  process.env.RESEND_API_KEY = 'test_key_123';
  assert.strictEqual(isConfigured(), true);
  delete process.env.RESEND_API_KEY;
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
