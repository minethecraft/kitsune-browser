'use strict';
// Anonymous usage counts for the Kitsune download site's statistics page.
// Sent: a random install id, app version, OS, edition, and simple counters (tabs opened, bookmark count, session length).
// Never sent: URLs, page titles, history, bookmarks' contents, or anything you type. Turn it off in Settings → Privacy.
const crypto = require('crypto');
const { app, net } = require('electron');
const S = require('./state');
const demo = require('./demo');

let sid = '', pend = { tabs: 0 }, timer = null, t0 = 0, closing = false;
const enabled = () => S.get().telemetry !== false && !demo.on;
const server = () => String(S.get().accountServer || '').replace(/\/+$/, '');

function clientId() {
  let id = S.get().clientId;
  if (!/^[0-9a-f]{32}$/.test(id || '')) { id = crypto.randomBytes(16).toString('hex'); S.patch({ clientId: id }); }
  return id;
}

function post(ev, extra) {
  if (!enabled() || !server()) return Promise.resolve(false);
  const B = require('./browser');
  const body = Object.assign({
    ev, cid: clientId(), sid, v: app.getVersion(), os: process.platform, arch: process.arch, ed: S.EDITION,
    tabs: pend.tabs, bm: S.bookmarks().data.items.length, win: B.wins.size, up: Math.round((Date.now() - t0) / 1000)
  }, extra || {});
  const sent = pend.tabs; pend.tabs = 0;
  return new Promise(resolve => {
    try {
      const req = net.request({ method: 'POST', url: server() + '/api/ping' });
      req.setHeader('Content-Type', 'application/json');
      const to = setTimeout(() => { try { req.abort(); } catch (_) {} pend.tabs += sent; resolve(false); }, 4000);
      req.on('response', res => { clearTimeout(to); res.on('data', () => {}); res.on('end', () => resolve(res.statusCode < 300)); if (res.statusCode >= 300) pend.tabs += sent; });
      req.on('error', () => { clearTimeout(to); pend.tabs += sent; resolve(false); });
      req.end(JSON.stringify(body));
    } catch (_) { pend.tabs += sent; resolve(false); }
  });
}

function start() {
  if (demo.on) return;
  sid = crypto.randomBytes(8).toString('hex'); t0 = Date.now();
  setTimeout(() => post('open'), 3000);
  timer = setInterval(() => post('beat'), 2.5 * 60 * 1000); timer.unref();
}
/** Called while quitting: one last "close" ping, but never keep the user waiting more than ~1s. */
function stop() {
  if (closing || !sid) return Promise.resolve();
  closing = true; clearInterval(timer);
  return Promise.race([post('close'), new Promise(r => setTimeout(r, 1000))]);
}
const countTab = () => { pend.tabs++; };

module.exports = { start, stop, countTab };
