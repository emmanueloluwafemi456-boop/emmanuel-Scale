'use strict';

/**
 * SSRF-safe outbound fetcher for the Free Store Audit engine.
 *
 * This module is the single choke point through which the audit engine is
 * allowed to reach the public internet. Every other module in this backend
 * must go through `safeFetch` / `safeFetchText` rather than calling
 * `fetch`/`http`/`https` directly, so all outbound requests inherit the
 * same protections.
 *
 * Protections implemented:
 *  - Protocol allowlist: only http:// and https://
 *  - Port allowlist: only default 80/443 (or explicit :80/:443)
 *  - Hostname blocklist: localhost, .local, .internal, etc.
 *  - DNS resolution is validated BEFORE connecting, and the *same*
 *    validated IP is what the socket actually connects to (via a custom
 *    `lookup` passed to Node's http/https), which closes the classic
 *    "DNS rebinding" hole where a hostname resolves to a safe IP at
 *    check-time and a private IP at connect-time.
 *  - Private / loopback / link-local / reserved / CGNAT IPv4 and IPv6
 *    ranges are rejected for every hop, including redirects.
 *  - Redirects are followed manually (max 3), re-validating the target
 *    URL and its resolved IP each time — never trusts a redirect blindly.
 *  - Connect + total response timeout.
 *  - Response size cap enforced on the actual byte stream (not just a
 *    trusted Content-Length header).
 */

const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');

const DEFAULT_TIMEOUT_MS = 6000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2MB per fetched page
const DEFAULT_MAX_REDIRECTS = 3;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_PORTS = new Set(['', '80', '443']);

const BLOCKED_HOSTNAME_SUFFIXES = ['.local', '.internal', '.localhost', '.corp', '.home', '.lan'];
const BLOCKED_HOSTNAMES = new Set(['localhost']);

function ipv4ToLong(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inCidr(ipLong, base, maskBits) {
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (ipLong & mask) === (base & mask);
}

const IPV4_BLOCKED_RANGES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved
].map(([ip, bits]) => [ipv4ToLong(ip), bits]);

function isPrivateIPv4(ip) {
  const long = ipv4ToLong(ip);
  if (long === null) return true; // fail closed on unparseable input
  return IPV4_BLOCKED_RANGES.some(([base, bits]) => inCidr(long, base, bits));
}

function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 — validate the embedded IPv4 address instead.
    const mapped = normalized.split(':').pop();
    if (net.isIPv4(mapped)) return isPrivateIPv4(mapped);
  }
  if (normalized.startsWith('fe80:') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true; // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local (fc00::/7)
  return false;
}

function isBlockedIP(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // unknown format — fail closed
}

function isBlockedHostname(hostname) {
  const h = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suf) => h.endsWith(suf))) return true;
  if (net.isIP(h)) return isBlockedIP(h);
  return false;
}

class SsrfError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SsrfError';
    this.code = code || 'SSRF_BLOCKED';
  }
}

/**
 * Validates a URL string is a safe, well-formed http(s) URL and returns
 * a normalized URL object. Throws SsrfError otherwise.
 */
function validateUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (e) {
    throw new SsrfError('That does not look like a valid URL.', 'INVALID_URL');
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfError('Only http:// and https:// URLs are supported.', 'BAD_PROTOCOL');
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new SsrfError('Non-standard ports are not supported.', 'BAD_PORT');
  }
  if (isBlockedHostname(url.hostname)) {
    throw new SsrfError('This host cannot be analyzed.', 'BLOCKED_HOST');
  }
  return url;
}

/**
 * Resolves a hostname to a safe IP, rejecting private/reserved ranges.
 * Returns the first safe IP found (v4 preferred), or throws.
 */
function resolveSafe(hostname) {
  return new Promise((resolve, reject) => {
    if (net.isIP(hostname)) {
      if (isBlockedIP(hostname)) return reject(new SsrfError('This host cannot be analyzed.', 'BLOCKED_HOST'));
      return resolve({ address: hostname, family: net.isIPv6(hostname) ? 6 : 4 });
    }
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return reject(new SsrfError('This store could not be reached (DNS lookup failed).', 'DNS_FAIL'));
      if (!addresses || addresses.length === 0) return reject(new SsrfError('This store could not be reached (no DNS records).', 'DNS_FAIL'));
      const blocked = addresses.filter((a) => isBlockedIP(a.address));
      if (blocked.length > 0) {
        return reject(new SsrfError('This host resolves to a non-public address and cannot be analyzed.', 'BLOCKED_HOST'));
      }
      const preferred = addresses.find((a) => a.family === 4) || addresses[0];
      resolve(preferred);
    });
  });
}

/**
 * Performs a single safe HTTP(S) GET/HEAD, pinning the connection to a
 * pre-validated IP address (defeats DNS-rebinding). Does NOT follow
 * redirects itself — callers use `safeFetch` for that.
 */
function rawSafeRequest(url, { method = 'GET', timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    resolveSafe(url.hostname)
      .then((resolved) => {
        const lib = url.protocol === 'https:' ? https : http;
        const req = lib.request(
          {
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method,
            timeout: timeoutMs,
            headers: {
              'User-Agent': 'ScaleGrowthOS-StoreAuditBot/1.0 (+https://scale-growth-os.example/audit)',
              Accept: 'text/html,application/xhtml+xml',
              ...headers,
            },
            // Pin the DNS resolution we already validated — this is the
            // key line that prevents DNS-rebinding SSRF: whatever the
            // hostname resolves to *now*, we ignore, and connect to the
            // address we already checked is safe.
            // Node's Happy-Eyeballs autoselection (default since Node 18/20)
            // invokes custom `lookup` functions in two different shapes
            // depending on internal options, so we must support both:
            // legacy single-address callback (err, address, family) and
            // the newer "all" mode callback (err, [{address, family}]).
            lookup: (_hostname, lookupOpts, cb) => {
              if (lookupOpts && lookupOpts.all) {
                cb(null, [{ address: resolved.address, family: resolved.family }]);
              } else {
                cb(null, resolved.address, resolved.family);
              }
            },
            autoSelectFamily: false,
          },
          (res) => {
            const status = res.statusCode || 0;
            const location = res.headers.location;

            if (status >= 300 && status < 400 && location) {
              res.resume(); // drain
              return resolve({ redirect: true, location, status });
            }

            const chunks = [];
            let total = 0;
            let aborted = false;

            res.on('data', (chunk) => {
              if (aborted) return;
              total += chunk.length;
              if (total > maxBytes) {
                aborted = true;
                req.destroy();
                return reject(new SsrfError('Response too large.', 'TOO_LARGE'));
              }
              chunks.push(chunk);
            });
            res.on('end', () => {
              if (aborted) return;
              resolve({
                redirect: false,
                status,
                headers: res.headers,
                body: Buffer.concat(chunks).toString('utf8'),
              });
            });
            res.on('error', (err) => {
              if (!aborted) reject(err);
            });
          }
        );

        req.on('timeout', () => {
          req.destroy();
          reject(new SsrfError('The site took too long to respond.', 'TIMEOUT'));
        });
        req.on('error', (err) => {
          reject(new SsrfError('This site could not be reached: ' + err.message, 'FETCH_FAIL'));
        });
        req.end();
      })
      .catch(reject);
  });
}

/**
 * Safe GET with manual, re-validated redirect following.
 * Returns { status, headers, body, finalUrl } or throws SsrfError.
 */
async function safeFetch(rawUrl, opts = {}) {
  let url = validateUrl(rawUrl);
  const maxRedirects = opts.maxRedirects != null ? opts.maxRedirects : DEFAULT_MAX_REDIRECTS;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const result = await rawSafeRequest(url, opts);
    if (!result.redirect) {
      return { status: result.status, headers: result.headers, body: result.body, finalUrl: url.toString() };
    }
    if (hop === maxRedirects) {
      throw new SsrfError('Too many redirects.', 'TOO_MANY_REDIRECTS');
    }
    const nextUrl = new URL(result.location, url); // resolves relative redirects
    url = validateUrl(nextUrl.toString()); // re-validate every hop
  }
  throw new SsrfError('Too many redirects.', 'TOO_MANY_REDIRECTS');
}

/** Convenience: fetch and return just the body text, or null on failure. */
async function safeFetchTextOrNull(rawUrl, opts = {}) {
  try {
    const res = await safeFetch(rawUrl, opts);
    if (res.status >= 200 && res.status < 300) return res;
    return null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  SsrfError,
  validateUrl,
  isBlockedHostname,
  isBlockedIP,
  isPrivateIPv4,
  isPrivateIPv6,
  resolveSafe,
  safeFetch,
  safeFetchTextOrNull,
};
