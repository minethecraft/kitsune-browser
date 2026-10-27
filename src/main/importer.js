'use strict';
// Import from other browsers: bookmarks, history and cookies (Chrome, Edge, Brave, Opera, Vivaldi, Chromium, Firefox).
// Passwords are intentionally NOT imported. Cookies are decrypted locally and never leave this computer.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { session } = require('electron');
const S = require('./state');

const home = os.homedir();
const P = process.platform;
const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
const mac = (...a) => path.join(home, 'Library', 'Application Support', ...a);

// kind: chromium | firefox. keychain = macOS Keychain service/account
const BROWSERS = [
  { id: 'chrome', name: 'Google Chrome', kind: 'chromium', keychain: ['Chrome Safe Storage', 'Chrome'], dirs: { win32: path.join(local, 'Google', 'Chrome', 'User Data'), darwin: mac('Google', 'Chrome'), linux: path.join(home, '.config', 'google-chrome') } },
  { id: 'edge', name: 'Microsoft Edge', kind: 'chromium', keychain: ['Microsoft Edge Safe Storage', 'Microsoft Edge'], dirs: { win32: path.join(local, 'Microsoft', 'Edge', 'User Data'), darwin: mac('Microsoft Edge'), linux: path.join(home, '.config', 'microsoft-edge') } },
  { id: 'brave', name: 'Brave', kind: 'chromium', keychain: ['Brave Safe Storage', 'Brave'], dirs: { win32: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'), darwin: mac('BraveSoftware', 'Brave-Browser'), linux: path.join(home, '.config', 'BraveSoftware', 'Brave-Browser') } },
  { id: 'opera', name: 'Opera', kind: 'chromium', flat: true, keychain: ['Opera Safe Storage', 'Opera'], dirs: { win32: path.join(appdata, 'Opera Software', 'Opera Stable'), darwin: mac('com.operasoftware.Opera'), linux: path.join(home, '.config', 'opera') } },
  { id: 'operagx', name: 'Opera GX', kind: 'chromium', flat: true, keychain: ['Opera Safe Storage', 'Opera'], dirs: { win32: path.join(appdata, 'Opera Software', 'Opera GX Stable'), darwin: mac('com.operasoftware.OperaGX') } },
  { id: 'vivaldi', name: 'Vivaldi', kind: 'chromium', keychain: ['Vivaldi Safe Storage', 'Vivaldi'], dirs: { win32: path.join(local, 'Vivaldi', 'User Data'), darwin: mac('Vivaldi'), linux: path.join(home, '.config', 'vivaldi') } },
  { id: 'chromium', name: 'Chromium', kind: 'chromium', keychain: ['Chromium Safe Storage', 'Chromium'], dirs: { win32: path.join(local, 'Chromium', 'User Data'), darwin: mac('Chromium'), linux: path.join(home, '.config', 'chromium') } },
  { id: 'firefox', name: 'Firefox', kind: 'firefox', dirs: { win32: path.join(appdata, 'Mozilla', 'Firefox', 'Profiles'), darwin: mac('Firefox', 'Profiles'), linux: path.join(home, '.mozilla', 'firefox') } }
];

const exists = p => { try { fs.accessSync(p); return true; } catch (_) { return false; } };
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } };

function profilesOf(b, dir) {
  if (b.kind === 'firefox') {
    try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && exists(path.join(dir, d.name, 'places.sqlite'))).map(d => ({ id: d.name, name: d.name.replace(/^[a-z0-9]{8}\./, ''), path: path.join(dir, d.name) })); } catch (_) { return []; }
  }
  if (b.flat) return exists(path.join(dir, 'Bookmarks')) || exists(path.join(dir, 'History')) ? [{ id: '.', name: 'Default', path: dir }] : [];
  const ls = readJson(path.join(dir, 'Local State')); const cache = (ls && ls.profile && ls.profile.info_cache) || {};
  const out = [];
  try { for (const d of fs.readdirSync(dir, { withFileTypes: true })) if (d.isDirectory() && (d.name === 'Default' || /^Profile \d+$/.test(d.name)) && exists(path.join(dir, d.name, 'Preferences'))) out.push({ id: d.name, name: (cache[d.name] && cache[d.name].name) || d.name, path: path.join(dir, d.name) }); } catch (_) {}
  return out;
}

/** Which browsers + profiles exist on this computer. */
function detect() {
  const out = [];
  for (const b of BROWSERS) {
    const dir = b.dirs[P]; if (!dir || !exists(dir)) continue;
    const profiles = profilesOf(b, dir); if (profiles.length) out.push({ id: b.id, name: b.name, kind: b.kind, profiles });
  }
  return out;
}

// ---------------------------------------------------------------- sqlite helpers (node:sqlite, copy first because browsers lock their DBs)
function openCopy(src, tmpName) {
  const { DatabaseSync } = require('node:sqlite');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimp-')); const dst = path.join(dir, tmpName);
  try { fs.copyFileSync(src, dst); } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error('Could not read ' + path.basename(src) + ' — close that browser and try again.'); }
  for (const ext of ['-wal', '-shm']) if (exists(src + ext)) { try { fs.copyFileSync(src + ext, dst + ext); } catch (_) {} }
  const db = new DatabaseSync(dst, { readOnly: true });
  return { db, close() { try { db.close(); } catch (_) {} fs.rmSync(dir, { recursive: true, force: true }); } };
}
// Chromium stores times as ~1.3e16 microseconds (> 2^53), which node:sqlite refuses to return as a Number, so read BigInts and narrow them.
const rows = (h, sql) => { try { const st = h.db.prepare(sql); st.setReadBigInts(true); return st.all().map(r => { const o = {}; for (const k in r) o[k] = typeof r[k] === 'bigint' ? Number(r[k]) : r[k]; return o; }); } catch (_) { return []; } };

// ---------------------------------------------------------------- bookmarks
function chromiumBookmarks(profile) {
  const j = readJson(path.join(profile.path, 'Bookmarks')); if (!j || !j.roots) return [];
  const out = [];
  const walk = (n, bar) => { if (!n) return; if (n.type === 'url' && /^https?:/.test(n.url)) out.push({ title: n.name || n.url, url: n.url, bar }); for (const c of n.children || []) walk(c, bar); };
  walk(j.roots.bookmark_bar, true); walk(j.roots.other, false); walk(j.roots.synced, false);
  return out;
}
function firefoxBookmarks(profile) {
  const h = openCopy(path.join(profile.path, 'places.sqlite'), 'places.sqlite');
  try {
    const bar = rows(h, "SELECT id FROM moz_bookmarks WHERE guid='toolbar_____'")[0];
    return rows(h, "SELECT b.parent AS parent, b.title AS title, p.url AS url FROM moz_bookmarks b JOIN moz_places p ON p.id=b.fk WHERE b.type=1 AND p.url LIKE 'http%'")
      .map(r => ({ title: r.title || r.url, url: r.url, bar: !!bar && r.parent === bar.id }));
  } finally { h.close(); }
}

// ---------------------------------------------------------------- history
function chromiumHistory(profile) {
  const h = openCopy(path.join(profile.path, 'History'), 'History');
  try { return rows(h, "SELECT url, title, visit_count, last_visit_time FROM urls WHERE url LIKE 'http%' ORDER BY last_visit_time DESC LIMIT 4000")
    .map(r => ({ url: r.url, title: r.title || r.url, visits: Number(r.visit_count) || 1, time: Math.round((Number(r.last_visit_time) / 1000) - 11644473600000) })); } finally { h.close(); }
}
function firefoxHistory(profile) {
  const h = openCopy(path.join(profile.path, 'places.sqlite'), 'places.sqlite');
  try { return rows(h, "SELECT url, title, visit_count, last_visit_date FROM moz_places WHERE url LIKE 'http%' AND last_visit_date IS NOT NULL ORDER BY last_visit_date DESC LIMIT 4000")
    .map(r => ({ url: r.url, title: r.title || r.url, visits: Number(r.visit_count) || 1, time: Math.round(Number(r.last_visit_date) / 1000) })); } finally { h.close(); }
}

// ---------------------------------------------------------------- cookies
function ps(script) { return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 20000 }).trim(); }

function chromiumKeys(b, userDataDir) {
  const keys = {};
  if (P === 'win32') {
    const ls = readJson(path.join(userDataDir, 'Local State')); const enc = ls && ls.os_crypt && ls.os_crypt.encrypted_key; if (!enc) return keys;
    const blob = Buffer.from(enc, 'base64').slice(5).toString('base64');
    const raw = ps(`Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${blob}'),$null,'CurrentUser'))`);
    keys.gcm = Buffer.from(raw, 'base64');
  } else if (P === 'darwin') {
    try { const pw = execFileSync('security', ['find-generic-password', '-w', '-s', b.keychain[0], '-a', b.keychain[1]], { encoding: 'utf8', timeout: 60000 }).trim(); keys.cbc = crypto.pbkdf2Sync(pw, 'saltysalt', 1003, 16, 'sha1'); } catch (_) { /* user denied Keychain */ }
  } else {
    keys.cbc = crypto.pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1');         // v10
    for (const app of ['chrome', 'chromium', 'brave', 'vivaldi', 'opera']) {      // v11 (keyring)
      try { const pw = execFileSync('secret-tool', ['lookup', 'application', app], { encoding: 'utf8', timeout: 5000 }).trim(); if (pw) { keys.cbc11 = crypto.pbkdf2Sync(pw, 'saltysalt', 1, 16, 'sha1'); break; } } catch (_) {}
    }
  }
  return keys;
}
function decryptChromium(buf, keys, strip) {
  if (!buf || !buf.length) return '';
  const tag = buf.slice(0, 3).toString('latin1');
  try {
    if ((tag === 'v10' || tag === 'v11') && keys.gcm) {
      const iv = buf.slice(3, 15), data = buf.slice(15, buf.length - 16), t = buf.slice(buf.length - 16);
      const d = crypto.createDecipheriv('aes-256-gcm', keys.gcm, iv); d.setAuthTag(t);
      const out = Buffer.concat([d.update(data), d.final()]); return (strip ? out.slice(32) : out).toString('utf8');
    }
    if (tag === 'v10' || tag === 'v11') {
      const key = tag === 'v11' && keys.cbc11 ? keys.cbc11 : keys.cbc; if (!key) return null;
      const d = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
      const out = Buffer.concat([d.update(buf.slice(3)), d.final()]); return (strip ? out.slice(32) : out).toString('utf8');
    }
    if (tag === 'v20') return null; // Chrome app-bound encryption: cannot be read outside Chrome
  } catch (_) { return null; }
  return null;
}
const SS = { '-1': 'unspecified', 0: 'no_restriction', 1: 'lax', 2: 'strict' };
function chromiumCookies(b, profile) {
  const dbPath = [path.join(profile.path, 'Network', 'Cookies'), path.join(profile.path, 'Cookies')].find(exists); if (!dbPath) return { cookies: [], skipped: 0 };
  const userDataDir = b.flat ? profile.path : path.dirname(profile.path);
  const keys = chromiumKeys(b, userDataDir);
  const h = openCopy(dbPath, 'Cookies');
  try {
    const ver = Number((rows(h, "SELECT value FROM meta WHERE key='version'")[0] || {}).value) || 0; const strip = ver >= 24;
    const cookies = []; let skipped = 0;
    for (const r of rows(h, 'SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies')) {
      let v = r.value;
      if (!v && r.encrypted_value && r.encrypted_value.length) { v = decryptChromium(Buffer.from(r.encrypted_value), keys, strip); if (v === null) { skipped++; continue; } }
      cookies.push({ host: r.host_key, name: r.name, value: v || '', path: r.path || '/', expires: Number(r.expires_utc) ? Math.round(Number(r.expires_utc) / 1e6 - 11644473600) : 0, secure: !!r.is_secure, httpOnly: !!r.is_httponly, sameSite: SS[r.samesite] || 'unspecified' });
    }
    return { cookies, skipped };
  } finally { h.close(); }
}
function firefoxCookies(profile) {
  const p = path.join(profile.path, 'cookies.sqlite'); if (!exists(p)) return { cookies: [], skipped: 0 };
  const h = openCopy(p, 'cookies.sqlite');
  try { return { skipped: 0, cookies: rows(h, 'SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies').map(r => ({ host: r.host, name: r.name, value: r.value, path: r.path || '/', expires: Number(r.expiry) > 1e11 ? Math.round(Number(r.expiry) / 1000) : Number(r.expiry), secure: !!r.isSecure, httpOnly: !!r.isHttpOnly, sameSite: { 0: 'no_restriction', 1: 'lax', 2: 'strict' }[r.sameSite] || 'unspecified' })) }; } finally { h.close(); }
}

async function applyCookies(cookies) {
  const ses = session.fromPartition('persist:main'); let ok = 0; const now = Date.now() / 1000;
  for (let i = 0; i < cookies.length; i += 50) {
    await Promise.all(cookies.slice(i, i + 50).map(async c => {
      if (c.expires && c.expires < now) return;
      const domainCookie = c.host.startsWith('.'); const host = c.host.replace(/^\./, '');
      const d = { url: `${c.secure ? 'https' : 'http'}://${host}${c.path}`, name: c.name, value: c.value, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, expirationDate: c.expires || now + 7 * 86400 };
      if (domainCookie) d.domain = c.host;
      try { await ses.cookies.set(d); ok++; } catch (_) {}
    }));
  }
  return ok;
}

/** opts: { browser, profile, bookmarks, history, cookies } -> counts */
async function run(opts) {
  const b = BROWSERS.find(x => x.id === opts.browser); if (!b) throw new Error('Unknown browser');
  const dir = b.dirs[P]; const profile = profilesOf(b, dir).find(p => p.id === opts.profile) || profilesOf(b, dir)[0]; if (!profile) throw new Error('Profile not found');
  const res = { bookmarks: 0, history: 0, cookies: 0, cookiesSkipped: 0, notes: [] };
  if (opts.bookmarks) {
    const list = b.kind === 'firefox' ? firefoxBookmarks(profile) : chromiumBookmarks(profile); const st = S.bookmarks(); const have = new Set(st.data.items.map(x => x.url));
    for (const x of list) if (!have.has(x.url)) { have.add(x.url); st.data.items.push({ id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: x.title, url: x.url, added: Date.now(), bar: x.bar }); res.bookmarks++; }
    st.save();
  }
  if (opts.history) {
    const list = b.kind === 'firefox' ? firefoxHistory(profile) : chromiumHistory(profile); const st = S.history(); const have = new Map(st.data.items.map(x => [x.url, x]));
    for (const x of list) { const e = have.get(x.url); if (e) { e.visits += x.visits; e.time = Math.max(e.time, x.time); } else { const n = { url: x.url, title: x.title, time: x.time, visits: x.visits }; st.data.items.push(n); have.set(x.url, n); res.history++; } }
    st.data.items.sort((a, c) => a.time - c.time); st.save();
  }
  if (opts.cookies) {
    const r = b.kind === 'firefox' ? firefoxCookies(profile) : chromiumCookies(b, profile);
    res.cookies = await applyCookies(r.cookies); res.cookiesSkipped = r.skipped;
    if (r.skipped) res.notes.push(`${r.skipped} cookies could not be decrypted (newer Chrome versions lock some cookies to Chrome itself). Sign in again on those sites.`);
  }
  return res;
}

module.exports = { detect, run, _t: { decryptChromium, chromiumKeys, chromiumCookies, firefoxCookies, chromiumBookmarks, firefoxBookmarks } };
