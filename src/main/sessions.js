'use strict';
// Per-session privacy plumbing: tracker blocking, HTTPS-only upgrades, GPC/DNT, permissions, downloads.
const { dialog } = require('electron');
const S = require('./state');
const adblock = require('./adblock');

const done = new WeakSet();
const httpsExceptions = new Set();
const upgraded = new Map(); // upgraded https url -> original http url

const isLocalHost = h => h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.test') ||
  /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || !h.includes('.');

const ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'speaker-selection', 'storage-access', 'top-level-storage-access', 'keyboardLock', 'window-management']);
const ASK = new Set(['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'clipboard-read', 'display-capture']);
const asking = new Map();

async function askPermission(origin, perm) {
  const key = origin + '|' + perm;
  if (asking.has(key)) return asking.get(key);
  const label = { media: 'use your camera or microphone', geolocation: 'know your location', notifications: 'show notifications', midi: 'use MIDI devices', midiSysex: 'use MIDI devices', 'clipboard-read': 'read your clipboard', 'display-capture': 'capture your screen' }[perm] || perm;
  const p = dialog.showMessageBox({
    type: 'question', buttons: ['Allow', 'Block'], defaultId: 1, cancelId: 1, title: 'Permission request',
    message: `${origin} wants to ${label}.`, checkboxLabel: 'Remember my choice for this site', checkboxChecked: false
  }).then(r => {
    const allow = r.response === 0;
    if (r.checkboxChecked) { S.get().sitePerms[key] = allow; S.patch({ sitePerms: S.get().sitePerms }); }
    asking.delete(key); return allow;
  });
  asking.set(key, p);
  return p;
}

function setup(ses, hooks) {
  if (done.has(ses)) return;
  done.add(ses);
  try { ses.protocol.handle('kitsune', require('./kproto').handler); } catch (_) { /* already registered (default session) */ }

  ses.webRequest.onBeforeRequest((d, cb) => {
    const s = S.get();
    try {
      if (d.resourceType === 'mainFrame' && s.httpsOnly && d.url.startsWith('http://')) {
        const u = new URL(d.url);
        if (!isLocalHost(u.hostname) && !httpsExceptions.has(u.hostname)) {
          u.protocol = 'https:';
          const target = u.toString();
          upgraded.set(target, d.url);
          return cb({ redirectURL: target });
        }
      }
      if (adblock.shouldBlock(d.url, d.resourceType, s.blocker)) {
        if (hooks.blocked) hooks.blocked(d.webContentsId);
        return cb({ cancel: true });
      }
    } catch (_) { /* fall through */ }
    cb({});
  });

  ses.webRequest.onBeforeSendHeaders((d, cb) => {
    if (S.get().sendGPC) { d.requestHeaders['Sec-GPC'] = '1'; d.requestHeaders['DNT'] = '1'; }
    cb({ requestHeaders: d.requestHeaders });
  });

  ses.setPermissionRequestHandler((wc, perm, cb, details) => {
    if (ALLOW.has(perm)) return cb(true);
    if (!ASK.has(perm)) return cb(false);
    let origin = 'This site';
    try { origin = new URL(details.requestingUrl || wc.getURL()).origin; } catch (_) {}
    const saved = S.get().sitePerms[origin + '|' + perm];
    if (saved !== undefined) return cb(saved);
    askPermission(origin, perm).then(cb, () => cb(false));
  });

  ses.on('will-download', (e, item, wc) => { if (hooks.download) hooks.download(item, wc); });
}

module.exports = { setup, httpsExceptions, upgraded };
