'use strict';
// kitsune:// protocol handler. Must be registered on EVERY session (default + each tab partition).
const fs = require('fs');
const path = require('path');
const S = require('./state');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const PAGES = new Set(['newtab', 'settings', 'history', 'bookmarks', 'downloads', 'anime', 'about', 'error']);

async function handler(req) {
  try {
    const u = new URL(req.url); const host = u.hostname;
    let rel;
    if (host === 'ui') rel = path.join('ui', u.pathname);
    else if (host === 'assets') rel = path.join('pages', 'assets', u.pathname);
    else if (PAGES.has(host)) rel = path.join('pages', host + '.html');
    else return new Response('Not found', { status: 404 });
    const file = path.normalize(path.join(S.SRC, rel));
    if (!file.startsWith(S.SRC)) return new Response('Forbidden', { status: 403 });
    const buf = await fs.promises.readFile(file);
    return new Response(buf, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' } });
  } catch (_) { return new Response('Not found', { status: 404 }); }
}
module.exports = { handler };
