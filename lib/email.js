'use strict';

/**
 * Transactional email via Resend's HTTP API (https://resend.com). Chosen
 * as the smallest-footprint option: a single POST call, no SMTP setup,
 * generous free tier. See SETUP.md for how to get an API key.
 *
 * The API key is read only from process.env.RESEND_API_KEY — it is
 * never sent to or referenced from the browser/frontend.
 */

const DEFAULT_TO = 'emmanueloluwafemi456@gmail.com';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatScore(v) {
  return v == null ? 'LIMITED DATA' : String(v);
}

/** Builds the plain-text + HTML body for a new audit lead, per the spec's exact section layout. */
function buildLeadEmail({ storeDomain, name, email, goal, audit, submissionType }) {
  const cs = (audit && audit.categoryScores) || {};
  const overall = audit ? formatScore(audit.overallScore) : 'N/A';
  const coverage = audit && audit.coverage != null ? audit.coverage + '%' : 'N/A';
  const findings = (audit && audit.findings) || [];

  const findingsText = findings.length
    ? findings.map((f, i) => `${i + 1}. [${f.priority}] (${f.category}) ${f.issue}`).join('\n')
    : 'No automated findings available for this submission.';

  const subject = 'NEW FREE STORE AUDIT — ' + storeDomain;

  const text = `NEW STORE AUDIT LEAD${submissionType === 'manual-review' ? ' (MANUAL REVIEW REQUEST)' : ''}

Store:
${storeDomain}

Name:
${name || 'Not provided'}

Email:
${email}

Primary goal:
${goal || 'Not provided'}

Overall Store Health:
${overall}

UX:
${formatScore(cs.ux && cs.ux.score)}

CRO:
${formatScore(cs.cro && cs.cro.score)}

Product:
${formatScore(cs.product && cs.product.score)}

Mobile:
${formatScore(cs.mobile && cs.mobile.score)}

Trust:
${formatScore(cs.trust && cs.trust.score)}

Technical:
${formatScore(cs.technical && cs.technical.score)}

SEO:
${formatScore(cs.seo && cs.seo.score)}

AUDIT COVERAGE:
${coverage}

TOP OPPORTUNITIES:

${findingsText}

AUDIT TIMESTAMP:
${(audit && audit.timestamp) || new Date().toISOString()}
`;

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.6;max-width:560px;">
      <h2 style="margin:0 0 16px;">New Store Audit Lead${submissionType === 'manual-review' ? ' — Manual Review Request' : ''}</h2>
      <p><strong>Store:</strong> ${escapeHtml(storeDomain)}<br>
      <strong>Name:</strong> ${escapeHtml(name || 'Not provided')}<br>
      <strong>Email:</strong> ${escapeHtml(email)}<br>
      <strong>Primary goal:</strong> ${escapeHtml(goal || 'Not provided')}</p>
      <p><strong>Overall Store Health:</strong> ${escapeHtml(overall)}</p>
      <table cellpadding="4" style="border-collapse:collapse;">
        <tr><td>UX</td><td><strong>${escapeHtml(formatScore(cs.ux && cs.ux.score))}</strong></td></tr>
        <tr><td>CRO</td><td><strong>${escapeHtml(formatScore(cs.cro && cs.cro.score))}</strong></td></tr>
        <tr><td>Product</td><td><strong>${escapeHtml(formatScore(cs.product && cs.product.score))}</strong></td></tr>
        <tr><td>Mobile</td><td><strong>${escapeHtml(formatScore(cs.mobile && cs.mobile.score))}</strong></td></tr>
        <tr><td>Trust</td><td><strong>${escapeHtml(formatScore(cs.trust && cs.trust.score))}</strong></td></tr>
        <tr><td>Technical</td><td><strong>${escapeHtml(formatScore(cs.technical && cs.technical.score))}</strong></td></tr>
        <tr><td>SEO</td><td><strong>${escapeHtml(formatScore(cs.seo && cs.seo.score))}</strong></td></tr>
      </table>
      <p><strong>Audit Coverage:</strong> ${escapeHtml(coverage)}</p>
      <p><strong>Top Opportunities:</strong></p>
      <pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(findingsText)}</pre>
      <p style="color:#666;font-size:12px;">Audit timestamp: ${escapeHtml((audit && audit.timestamp) || new Date().toISOString())}</p>
    </div>
  `;

  return { subject, text, html };
}

async function sendLeadNotification({ storeDomain, name, email, goal, audit, submissionType }) {
  if (!isConfigured()) {
    const err = new Error('Email is not configured (missing RESEND_API_KEY).');
    err.code = 'EMAIL_NOT_CONFIGURED';
    throw err;
  }

  const to = process.env.LEAD_TO_EMAIL || DEFAULT_TO;
  const from = process.env.RESEND_FROM_EMAIL || 'Emmanuel Scale Growth OS Audit <onboarding@resend.dev>';
  const { subject, text, html } = buildLeadEmail({ storeDomain, name, email, goal, audit, submissionType });

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: email || undefined,
      subject,
      text,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error('Resend API error (' + res.status + '): ' + body.slice(0, 300));
    err.code = 'EMAIL_SEND_FAILED';
    throw err;
  }

  return res.json();
}

module.exports = { isConfigured, buildLeadEmail, sendLeadNotification };
