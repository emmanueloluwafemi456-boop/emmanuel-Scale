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

(async () => {
  // Ensure no KV env vars are set for this test run, so we exercise the
  // fail-open path deterministically without needing a real Upstash DB.
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const { checkRateLimit, clientIp } = require('../lib/rate-limit');

  console.log('=== rate-limit: fails open when KV is not configured ===');
  await check('allowed=true when unconfigured', async () => {
    const r = await checkRateLimit('1.2.3.4', { route: 'audit', limit: 5, windowSeconds: 3600 });
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.configured, false);
  });

  console.log('=== clientIp ===');
  await check('reads x-forwarded-for', () => {
    const ip = clientIp({ headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }, socket: {} });
    assert.strictEqual(ip, '9.9.9.9');
  });
  await check('falls back to socket.remoteAddress', () => {
    const ip = clientIp({ headers: {}, socket: { remoteAddress: '5.5.5.5' } });
    assert.strictEqual(ip, '5.5.5.5');
  });
  await check('falls back to "unknown"', () => {
    const ip = clientIp({ headers: {}, socket: {} });
    assert.strictEqual(ip, 'unknown');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
