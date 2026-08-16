'use strict';

const { runAudit } = require('../lib/audit-engine');
const { checkRateLimit, clientIp } = require('../lib/rate-limit');

const RATE_LIMIT = { route: 'audit', limit: 8, windowSeconds: 3600 }; // 8 audits/hour/IP
const MAX_URL_LENGTH = 2048;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ status: 'METHOD_NOT_ALLOWED', message: 'Use POST.' });
  }

  const ip = clientIp(req);
  const rl = await checkRateLimit(ip, RATE_LIMIT);
  if (!rl.allowed) {
    return res.status(429).json({
      status: 'RATE_LIMITED',
      message: "You've reached the audit limit for now. Please try again in a little while.",
      resetInSeconds: rl.resetInSeconds,
    });
  }

  const body = req.body || {};
  const storeUrl = typeof body.storeUrl === 'string' ? body.storeUrl : '';

  if (!storeUrl) {
    return res.status(200).json({ status: 'INVALID_URL', message: 'Please enter a valid Shopify store URL.' });
  }
  if (storeUrl.length > MAX_URL_LENGTH) {
    return res.status(200).json({ status: 'INVALID_URL', message: 'Please enter a valid Shopify store URL.' });
  }

  try {
    const result = await runAudit(storeUrl);

    // Translate internal statuses into the professional, specific
    // error copy the spec calls for — never a generic/fake success.
    if (result.status === 'INVALID_URL' || result.status === 'BLOCKED_HOST') {
      return res.status(200).json({ status: result.status, message: 'Please enter a valid Shopify store URL.' });
    }
    if (result.status === 'UNREACHABLE') {
      return res.status(200).json({ status: result.status, message: "We couldn't access this store right now. Please check the URL and try again." });
    }
    if (result.status === 'CRAWL_BLOCKED') {
      return res.status(200).json({ status: result.status, message: 'This store is currently preventing automated analysis. You can still request a manual review.' });
    }

    // status === 'OK'
    return res.status(200).json(result);
  } catch (e) {
    console.error('audit.js unexpected error:', e);
    return res.status(500).json({ status: 'ERROR', message: 'Something went wrong while analyzing this store. Please try again.' });
  }
};
