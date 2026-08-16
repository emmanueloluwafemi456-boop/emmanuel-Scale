'use strict';

const { checkRateLimit, clientIp } = require('../lib/rate-limit');
const { saveLead } = require('../lib/store');
const { sendLeadNotification } = require('../lib/email');

const RATE_LIMIT = { route: 'manual-review', limit: 10, windowSeconds: 86400 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const reason = String(body.reason || '').trim().slice(0, 300);

  if (!name || !EMAIL_RE.test(email) || !storeUrl) {
    return res.status(200).json({ status: 'INVALID_INPUT', message: 'Please fill in your name, a valid email, and the store URL.' });
  }

  let storeDomain = storeUrl;
  try {
    storeDomain = new URL(storeUrl.startsWith('http') ? storeUrl : 'https://' + storeUrl).hostname.replace(/^www\./, '');
  } catch (e) {
    /* keep raw storeUrl as fallback label */
  }

  const saveResult = await saveLead({ name, email, storeUrl, storeDomain, goal: reason || 'Not sure', audit: null, submissionType: 'manual-review' });

  let emailed = false;
  try {
    await sendLeadNotification({ storeDomain, name, email, goal: reason, audit: null, submissionType: 'manual-review' });
    emailed = true;
  } catch (e) {
    console.error('manual-review.js email send failed:', e);
  }

  if (!saveResult.persisted && !emailed) {
    return res.status(200).json({
      status: 'SUBMIT_FAILED',
      message: "We couldn't submit your request right now. Please try again in a moment, or reach out directly.",
    });
  }

  return res.status(200).json({ status: 'RECEIVED', persisted: saveResult.persisted, emailed, leadId: saveResult.record.id });
};
