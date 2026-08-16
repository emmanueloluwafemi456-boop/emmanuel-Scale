'use strict';

/**
 * Minimal local dev server that mimics Vercel's routing convention
 * (static files + /api/*.js handlers) closely enough to exercise the
 * real frontend + real backend together in this sandbox, without
 * needing an actual Vercel deployment. Not used in production.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..');
const STATIC_ROOT = path.join(ROOT, 'docs');
const PORT = process.env.DEV_PORT || 5311;

const apiHandlers = {
  '/api/audit': require(path.join(ROOT, 'api/audit.js')),
  '/api/lead': require(path.join(ROOT, 'api/lead.js')),
  '/api/manual-review': require(path.join(ROOT, 'api/manual-review.js')),
};

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, 'http://localhost');
  const pathname = parsed.pathname;

  if (apiHandlers[pathname]) {
    const rawBody = await readBody(req);
    let body = {};
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch (e) {
      /* leave body as {} on parse failure */
    }
    const vercelReq = { method: req.method, headers: req.headers, body, socket: req.socket };
    const vercelRes = {
      _status: 200,
      status(code) {
        this._status = code;
        return this;
      },
      json(obj) {
        res.writeHead(this._status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      },
      setHeader(k, v) {
        res.setHeader(k, v);
      },
    };
    try {
      await apiHandlers[pathname](vercelReq, vercelRes);
    } catch (e) {
      console.error('handler crashed:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ERROR', message: 'Server error.' }));
    }
    return;
  }

  // Static file serving — serves index.html and its assets from /docs,
  // exactly like Vercel would for the static parts of this project.
  // (Note: index.html loads React/Babel/Tailwind from public CDNs, so
  // this requires normal internet access to render in a browser — it's
  // only the /api/* routes above that run fully locally.)
  const filePath = pathname === '/' ? '/index.html' : pathname;
  const fullPath = path.join(STATIC_ROOT, filePath);
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('not found: ' + filePath);
      return;
    }
    const ext = path.extname(fullPath);
    const type = {
      '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
      '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
      '.webmanifest': 'application/manifest+json', '.json': 'application/json',
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('dev-server listening on http://localhost:' + PORT);
});
