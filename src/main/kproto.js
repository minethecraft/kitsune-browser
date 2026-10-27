'use strict';
// kitsune:// protocol handler. Must be registered on EVERY session (default + each tab partition).
const fs = require('fs');
const path = require('path');
const S = require('./state');
const { net } = require('electron');
const { pathToFileURL } = require('url');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const PAGES = new Set(['newtab', 'settings', 'history', 'bookmarks', 'downloads', 'anime', 'about', 'error', 'setup', 'updates', 'backgrounds', 'studio', 'passwords', 'community']);

const MEDIA = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
/** Serve a profile file with HTTP Range support (needed for <video> seeking / looping). */
function serveRange(f, req) {
  const size = fs.statSync(f).size, type = MEDIA[path.extname(f).toLowerCase()] || 'application/octet-stream';
  const h = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
  let start = 0, end = size - 1, status = 200;
  if (m && (m[1] || m[2])) {
    if (m[1] === '') { start = Math.max(0, size - +m[2]); } else { start = +m[1]; if (m[2] !== '') end = Math.min(size - 1, +m[2]); }
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'content-range': 'bytes */' + size } });
    status = 206; h['content-range'] = `bytes ${start}-${end}/${size}`;
  }
  h['content-length'] = String(end - start + 1);
  const rs = fs.createReadStream(f, { start, end });
  return new Response(require('stream').Readable.toWeb(rs), { status, headers: h });
}

async function handler(req) {
  try {
    const u = new URL(req.url); const host = u.hostname;
    let rel;
    if (host === 'bg' || host === 'snd') {   // user media: served from the profile folder, with Range support for video
      const name = decodeURIComponent(u.pathname.replace(/^\//, '')); const f = host === 'bg' ? require('./backgrounds').filePath(name) : require('./sounds').filePath(name);
      if (!f) return new Response('Not found', { status: 404 });
      return serveRange(f, req);
    }
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
