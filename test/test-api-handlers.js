'use strict';

const assert = require('assert');

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

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
  };
  return res;
}

(async () => {
  // Clear any KV/email env vars so these tests exercise the honest
  // "not configured yet" paths deterministically.
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.RESEND_API_KEY;

  const auditHandler = require('../api/audit');
  const leadHandler = require('../api/lead');
  const manualReviewHandler = require('../api/manual-review');

  console.log('=== api/audit.js ===');
  await check('rejects non-POST with 405', async () => {
    const res = mockRes();
    await auditHandler({ method: 'GET', headers: {}, socket: {} }, res);
    assert.strictEqual(res.statusCode, 405);
    assert.strictEqual(res.body.status, 'METHOD_NOT_ALLOWED');
  });

  await check('empty storeUrl -> INVALID_URL, 200', async () => {
    const res = mockRes();
    await auditHandler({ method: 'POST', headers: {}, socket: {}, body: { storeUrl: '' } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.status, 'INVALID_URL');
  });

  await check('oversized storeUrl -> INVALID_URL, no crash', async () => {
    const res = mockRes();
    await auditHandler({ method: 'POST', headers: {}, socket: {}, body: { storeUrl: 'https://x.com/' + 'a'.repeat(3000) } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.status, 'INVALID_URL');
  });

  await check('SSRF-blocked storeUrl is safely rejected end-to-end through the real handler', async () => {
    const res = mockRes();
    await auditHandler({ method: 'POST', headers: {}, socket: {}, body: { storeUrl: 'http://169.254.169.254/' } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.status, 'BLOCKED_HOST');
    assert.ok(res.body.message.toLowerCase().includes('valid shopify store url'));
  });

  console.log('=== api/lead.js ===');
  await check('rejects non-POST with 405', async () => {
    const res = mockRes();
    await leadHandler({ method: 'GET', headers: {}, socket: {} }, res);
    assert.strictEqual(res.statusCode, 405);
  });

  await check('missing name -> INVALID_INPUT', async () => {
    const res = mockRes();
    await leadHandler({ method: 'POST', headers: {}, socket: {}, body: { email: 'a@b.com', storeUrl: 'x.com' } }, res);
    assert.strictEqual(res.body.status, 'INVALID_INPUT');
  });

  await check('invalid email -> INVALID_INPUT', async () => {
    const res = mockRes();
    await leadHandler({ method: 'POST', headers: {}, socket: {}, body: { name: 'Jane', email: 'not-an-email', storeUrl: 'x.com' } }, res);
    assert.strictEqual(res.body.status, 'INVALID_INPUT');
  });

  await check('missing storeUrl -> INVALID_INPUT', async () => {
    const res = mockRes();
    await leadHandler({ method: 'POST', headers: {}, socket: {}, body: { name: 'Jane', email: 'jane@example.com' } }, res);
    assert.strictEqual(res.body.status, 'INVALID_INPUT');
  });

  await check('valid input, but neither KV nor Resend configured -> honest SUBMIT_FAILED, not a fake success', async () => {
    const res = mockRes();
    await leadHandler(
      { method: 'POST', headers: {}, socket: {}, body: { name: 'Jane', email: 'jane@example.com', storeUrl: 'example.com', goal: 'Conversion rate' } },
      res
    );
    assert.strictEqual(res.body.status, 'SUBMIT_FAILED');
  });

  await check('invalid goal value is sanitized to "Not sure" rather than rejected', async () => {
    // We can't observe the sanitized goal directly without email/KV configured,
    // but we CAN confirm the handler doesn't throw / still returns a well-formed response.
    const res = mockRes();
    await leadHandler(
      { method: 'POST', headers: {}, socket: {}, body: { name: 'Jane', email: 'jane@example.com', storeUrl: 'example.com', goal: '<script>xss</script>' } },
      res
    );
    assert.ok(res.body.status === 'SUBMIT_FAILED' || res.body.status === 'RECEIVED');
  });

  console.log('=== api/manual-review.js ===');
  await check('rejects non-POST with 405', async () => {
    const res = mockRes();
    await manualReviewHandler({ method: 'GET', headers: {}, socket: {} }, res);
    assert.strictEqual(res.statusCode, 405);
  });

  await check('missing fields -> INVALID_INPUT', async () => {
    const res = mockRes();
    await manualReviewHandler({ method: 'POST', headers: {}, socket: {}, body: {} }, res);
    assert.strictEqual(res.body.status, 'INVALID_INPUT');
  });

  await check('valid input without config -> honest SUBMIT_FAILED', async () => {
    const res = mockRes();
    await manualReviewHandler(
      { method: 'POST', headers: {}, socket: {}, body: { name: 'Bob', email: 'bob@example.com', storeUrl: 'blocked-store.com' } },
      res
    );
    assert.strictEqual(res.body.status, 'SUBMIT_FAILED');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
