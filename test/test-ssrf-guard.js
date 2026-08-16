'use strict';

const assert = require('assert');
const {
  isPrivateIPv4,
  isPrivateIPv6,
  isBlockedHostname,
  validateUrl,
  resolveSafe,
  safeFetch,
  SsrfError,
} = require('../lib/ssrf-guard');

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

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log('  ok -', name);
    pass++;
  } catch (e) {
    console.log('  FAIL -', name, '->', e.message);
    fail++;
  }
}

console.log('=== isPrivateIPv4 ===');
check('10.0.0.1 is private', () => assert.strictEqual(isPrivateIPv4('10.0.0.1'), true));
check('192.168.1.1 is private', () => assert.strictEqual(isPrivateIPv4('192.168.1.1'), true));
check('172.16.0.5 is private', () => assert.strictEqual(isPrivateIPv4('172.16.0.5'), true));
check('172.32.0.5 is NOT private (outside 172.16/12)', () => assert.strictEqual(isPrivateIPv4('172.32.0.5'), false));
check('127.0.0.1 is private (loopback)', () => assert.strictEqual(isPrivateIPv4('127.0.0.1'), true));
check('169.254.169.254 is private (cloud metadata!)', () => assert.strictEqual(isPrivateIPv4('169.254.169.254'), true));
check('0.0.0.0 is private', () => assert.strictEqual(isPrivateIPv4('0.0.0.0'), true));
check('100.64.0.1 is private (CGNAT)', () => assert.strictEqual(isPrivateIPv4('100.64.0.1'), true));
check('8.8.8.8 is public', () => assert.strictEqual(isPrivateIPv4('8.8.8.8'), false));
check('1.1.1.1 is public', () => assert.strictEqual(isPrivateIPv4('1.1.1.1'), false));
check('93.184.216.34 (example.com) is public', () => assert.strictEqual(isPrivateIPv4('93.184.216.34'), false));

console.log('=== isPrivateIPv6 ===');
check('::1 is private (loopback)', () => assert.strictEqual(isPrivateIPv6('::1'), true));
check('fe80::1 is private (link-local)', () => assert.strictEqual(isPrivateIPv6('fe80::1'), true));
check('fc00::1 is private (unique local)', () => assert.strictEqual(isPrivateIPv6('fc00::1'), true));
check('2001:4860:4860::8888 is public (google dns)', () => assert.strictEqual(isPrivateIPv6('2001:4860:4860::8888'), false));

console.log('=== isBlockedHostname ===');
check('localhost is blocked', () => assert.strictEqual(isBlockedHostname('localhost'), true));
check('foo.local is blocked', () => assert.strictEqual(isBlockedHostname('foo.local'), true));
check('foo.internal is blocked', () => assert.strictEqual(isBlockedHostname('foo.internal'), true));
check('127.0.0.1 as hostname is blocked', () => assert.strictEqual(isBlockedHostname('127.0.0.1'), true));
check('169.254.169.254 as hostname is blocked', () => assert.strictEqual(isBlockedHostname('169.254.169.254'), true));
check('[::1] as hostname is blocked', () => assert.strictEqual(isBlockedHostname('::1'), true));
check('example.com is not blocked', () => assert.strictEqual(isBlockedHostname('example.com'), false));
check('myshopify.com is not blocked', () => assert.strictEqual(isBlockedHostname('somestore.myshopify.com'), false));

console.log('=== validateUrl ===');
check('rejects file://', () => assert.throws(() => validateUrl('file:///etc/passwd'), SsrfError));
check('rejects javascript:', () => assert.throws(() => validateUrl('javascript:alert(1)'), SsrfError));
check('rejects ftp://', () => assert.throws(() => validateUrl('ftp://example.com'), SsrfError));
check('rejects malformed URL', () => assert.throws(() => validateUrl('not a url'), SsrfError));
check('rejects non-standard port', () => assert.throws(() => validateUrl('http://example.com:8080'), SsrfError));
check('rejects localhost', () => assert.throws(() => validateUrl('http://localhost/'), SsrfError));
check('rejects 127.0.0.1', () => assert.throws(() => validateUrl('http://127.0.0.1/'), SsrfError));
check('rejects 169.254.169.254 (cloud metadata)', () => assert.throws(() => validateUrl('http://169.254.169.254/'), SsrfError));
check('accepts https://example.com', () => assert.doesNotThrow(() => validateUrl('https://example.com')));
check('accepts https://example.com:443 (explicit default port)', () => assert.doesNotThrow(() => validateUrl('https://example.com:443')));
check('accepts http://example.com', () => assert.doesNotThrow(() => validateUrl('http://example.com')));

(async () => {
  console.log('=== resolveSafe (DNS-rebinding style checks) ===');
  await checkAsync('resolveSafe rejects literal 127.0.0.1', async () => {
    await assert.rejects(() => resolveSafe('127.0.0.1'), SsrfError);
  });
  await checkAsync('resolveSafe rejects literal 10.0.0.5', async () => {
    await assert.rejects(() => resolveSafe('10.0.0.5'), SsrfError);
  });
  await checkAsync('resolveSafe rejects literal 169.254.169.254', async () => {
    await assert.rejects(() => resolveSafe('169.254.169.254'), SsrfError);
  });

  console.log('=== safeFetch happy path (against the one host this sandbox can reach) ===');
  await checkAsync('safeFetch can GET https://registry.npmjs.org/', async () => {
    const res = await safeFetch('https://registry.npmjs.org/');
    assert.ok(res.status >= 200 && res.status < 500, 'expected a valid HTTP status, got ' + res.status);
    assert.ok(typeof res.body === 'string' && res.body.length > 0, 'expected a non-empty body');
  });

  console.log('=== safeFetch failure paths ===');
  await checkAsync('safeFetch rejects a blocked host before any network call', async () => {
    await assert.rejects(() => safeFetch('http://127.0.0.1/admin'), SsrfError);
  });
  await checkAsync('safeFetch rejects an unreachable domain gracefully', async () => {
    await assert.rejects(() => safeFetch('https://this-domain-should-not-exist-audit-test-xyz123.invalid/'), SsrfError);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
