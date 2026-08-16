'use strict';

/**
 * Lead persistence. Stores each submitted lead as a JSON blob in a
 * capped Redis list (via lib/kv.js) — intentionally the smallest
 * durable storage that satisfies "don't rely on temporary frontend
 * state" without standing up a full database/schema for a V1.
 *
 * If no KV store is configured, `saveLead` still returns successfully
 * (never blocks the visitor-facing flow) but flags `persisted: false`
 * so the API layer knows to note it in logs — the EMAIL notification
 * (lib/email.js) is the guaranteed record either way.
 */

const kv = require('./kv');

const LEADS_KEY = 'audit:leads';
const MAX_LEADS_KEPT = 500; // simple cap so the list doesn't grow unbounded on a free-tier KV

async function saveLead(lead) {
  const record = {
    id: 'lead_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    savedAt: new Date().toISOString(),
    ...lead,
  };

  if (!kv.isConfigured()) {
    return { persisted: false, record };
  }

  try {
    await kv.rpush(LEADS_KEY, JSON.stringify(record));
    await kv.ltrim(LEADS_KEY, -MAX_LEADS_KEPT, -1);
    return { persisted: true, record };
  } catch (e) {
    return { persisted: false, record, error: e.message };
  }
}

async function listLeads(limit) {
  if (!kv.isConfigured()) return [];
  const n = limit || 100;
  const raw = await kv.lrange(LEADS_KEY, -n, -1);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => {
      try {
        return JSON.parse(s);
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean)
    .reverse();
}

module.exports = { saveLead, listLeads };
