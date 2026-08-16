'use strict';

const { checkRateLimit, clientIp } = require('../lib/rate-limit');
const { saveLead } = require('../lib/store');
const { sendLeadNotification } = require('../lib/email');

const RATE_LIMIT = { route: 'lead', limit: 10, windowSeconds: 86400 }; // 10 submissions/day/IP
const GOAL_OPTIONS = ['Conversion rate', 'Product pages', 'Store design', 'Mobile experience', 'Sales / revenue', 'Offer strategy', 'Not sure'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clamp0to100(n) {
  if (n == null) return null;
  const v = Number(n);
  if (Number.isNaN(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Re-clamps a client-supplied audit payload so obviously-malformed or
 *  out-of-range values can't reach the email/store untouched. This is a
 *  sanity check, not a full re-verification of the audit (the frontend
 *  simply forwards the result it already received from /api/audit). */
function sanitizeAudit(audit) {
  if (!audit || typeof audit !== 'object') return null;
  const categories = ['ux', 'cro', 'product', 'mobile', 'trust', 'technical', 'seo'];
  const categoryScores = {};
  categories.forEach((cat) => {
    const c = audit.categoryScores && audit.categoryScores[cat];
    categoryScores[cat] = { score: c ? clamp0to100(c.score) : null };
  });
  const findings = Array.isArray(audit.findings)
    ? audit.findings.slice(0, 8).map((f) => ({
        priority: ['HIGH', 'MEDIUM', 'LOW'].includes(f && f.priority) ? f.priority : 'LOW',
        category: String((f && f.category) || '').slice(0, 40),
        issue: String((f && f.issue) || '').slice(0, 200),
      }))
    : [];
  return {
    timestamp: typeof audit.timestamp === 'string' ? audit.timestamp : new Date().toISOString(),
    overallScore: clamp0to100(audit.overallScore),
    coverage: audit.coverage != null ? clamp0to100(audit.coverage) : null,
    categoryScores,
    findings,
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ status: 'METHOD_NOT_ALLOWED', message: 'Use POST.' });
  }

  const ip = clientIp(req);
  const rl = await checkRateLimit(ip, RATE_LIMIT);
  if (!rl.allowed) {
    return res.status(429).json({ status: 'RATE_LIMITED', message: 'Too many submissions from this connection. Please try again later.' });
  }

  const body = req.body || {};
  const name = String(body.name || '').trim().slice(0, 120);
  const email = String(body.email || '').trim().slice(0, 200);
  const storeUrl = String(body.storeUrl || '').trim().slice(0, 2048);
  const goal = GOAL_OPTIONS.includes(body.goal) ? body.goal : 'Not sure';

  if (!name || !EMAIL_RE.test(email) || !storeUrl) {
    return res.status(200).json({ status: 'INVALID_INPUT', message: 'Please fill in your name, a valid email, and the store URL.' });
  }

  let storeDomain = storeUrl;
  try {
    storeDomain = new URL(storeUrl.startsWith('http') ? storeUrl : 'https://' + storeUrl).hostname.replace(/^www\./, '');
  } catch (e) {
    /* keep raw storeUrl as fallback label */
  }

  const audit = sanitizeAudit(body.audit);

  const saveResult = await saveLead({ name, email, storeUrl, storeDomain, goal, audit, submissionType: 'audit' });

  let emailed = false;
  let emailError = null;
  try {
    await sendLeadNotification({ storeDomain, name, email, goal, audit, submissionType: 'audit' });
    emailed = true;
  } catch (e) {
    emailError = e.message;
    console.error('lead.js email send failed:', e);
  }

  if (!saveResult.persisted && !emailed) {
    return res.status(200).json({
      status: 'SUBMIT_FAILED',
      message: "We couldn't submit your request right now. Please try again in a moment, or reach out directly.",
    });
  }

  return res.status(200).json({
    status: 'RECEIVED',
    persisted: saveResult.persisted,
    emailed,
    leadId: saveResult.record.id,
  });
};
