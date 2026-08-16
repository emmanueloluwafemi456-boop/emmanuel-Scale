'use strict';

/**
 * Minimal client for Upstash Redis's REST API. Deliberately dependency-
 * free (plain fetch) since this is the only Redis operation surface the
 * audit backend needs: INCR/EXPIRE for rate limiting, RPUSH/LRANGE for
 * the lead log.
 *
 * Works with either:
 *   - Vercel KV (env vars KV_REST_API_URL / KV_REST_API_TOKEN), or
 *   - a standalone Upstash Redis database (UPSTASH_REDIS_REST_URL /
 *     UPSTASH_REDIS_REST_TOKEN)
 * since Vercel KV is Upstash under the hood and exposes the same REST
 * contract. See SETUP.md for how to provision either one.
 */

function getConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token, configured: Boolean(url && token) };
}

async function command(args) {
  const { url, token, configured } = getConfig();
  if (!configured) {
    const err = new Error('KV store is not configured (missing KV_REST_API_URL/TOKEN or UPSTASH_REDIS_REST_URL/TOKEN).');
    err.code = 'KV_NOT_CONFIGURED';
    throw err;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('KV command failed (' + res.status + '): ' + text.slice(0, 200));
  }
  const data = await res.json();
  if (data && data.error) throw new Error('KV error: ' + data.error);
  return data ? data.result : null;
}

function isConfigured() {
  return getConfig().configured;
}

async function incr(key) {
  return command(['INCR', key]);
}

async function expire(key, seconds) {
  return command(['EXPIRE', key, String(seconds)]);
}

async function get(key) {
  return command(['GET', key]);
}

async function set(key, value, exSeconds) {
  if (exSeconds) return command(['SET', key, value, 'EX', String(exSeconds)]);
  return command(['SET', key, value]);
}

async function rpush(key, value) {
  return command(['RPUSH', key, value]);
}

async function lrange(key, start, stop) {
  return command(['LRANGE', key, String(start), String(stop)]);
}

async function ltrim(key, start, stop) {
  return command(['LTRIM', key, String(start), String(stop)]);
}

module.exports = { isConfigured, incr, expire, get, set, rpush, lrange, ltrim };
