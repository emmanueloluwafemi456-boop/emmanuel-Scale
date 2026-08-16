'use strict';

/**
 * Simple fixed-window per-identifier rate limiter backed by the KV
 * store. If no KV store is configured yet, this fails OPEN (requests
 * are allowed) rather than breaking the audit feature entirely — but it
 * flags `configured: false` so the API layer can log that abuse
 * protection isn't actually active yet. See SETUP.md.
 */

const kv = require('./kv');

async function checkRateLimit(identifier, { route, limit, windowSeconds }) {
  if (!kv.isConfigured()) {
    return { allowed: true, configured: false, remaining: limit, resetInSeconds: windowSeconds };
  }

  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = 'ratelimit:' + route + ':' + identifier + ':' + bucket;

  try {
    const count = await kv.incr(key);
    if (count === 1) {
      await kv.expire(key, windowSeconds);
    }
    const allowed = count <= limit;
    return {
      allowed,
      configured: true,
      remaining: Math.max(0, limit - count),
      resetInSeconds: windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds),
    };
  } catch (e) {
    // If the KV store is briefly unavailable, don't take down the whole
    // feature over a rate-limit check — fail open and let the request
    // through. This is a deliberate availability-over-strictness choice
    // appropriate for a lead-gen tool (not a payments/security system).
    return { allowed: true, configured: true, degraded: true, remaining: limit, resetInSeconds: windowSeconds };
  }
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = { checkRateLimit, clientIp };
