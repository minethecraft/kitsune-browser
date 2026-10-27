'use strict';
// Password vault: AES-256-GCM, key from the master password via scrypt (N=2^15). Nothing is stored unencrypted and the
// master password / key only live in memory while unlocked. Includes RFC 6238 verification codes (TOTP).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, clipboard, powerMonitor } = require('electron');
const S = require('./state');

const file = () => path.join(app.getPath('userData'), 'vault.json');
const KDF = { N: 1 << 15, r: 8, p: 1 };
const deriveKey = (pw, salt, k) => crypto.scryptSync(String(pw).normalize('NFKC'), salt, 32, { N: k.N, r: k.r, p: k.p, maxmem: 128 * 1024 * 1024 });
const seal = (key, obj) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'); };
const open = (key, b64) => { const b = Buffer.from(b64, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key, b.slice(0, 12)); d.setAuthTag(b.slice(12, 28)); return JSON.parse(Buffer.concat([d.update(b.slice(28)), d.final()]).toString('utf8')); };

let disk = null, key = null, data = null, timer = null, listeners = [];
const read = () => { if (disk) return disk; try { disk = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch (_) { disk = null; } return disk; };
const persist = () => { const o = { v: 1, kdf: disk.kdf, salt: disk.salt, blob: seal(key, data) }; const t = file() + '.tmp'; fs.writeFileSync(t, JSON.stringify(o), { mode: 0o600 }); fs.renameSync(t, file()); disk = o; };
const emit = () => listeners.forEach(f => { try { f(status()); } catch (_) {} });
const status = () => ({ exists: !!read(), unlocked: !!key, count: key ? data.entries.length : 0 });

function touch() { clearTimeout(timer); const m = S.get().vaultAutoLock; if (key && m > 0) timer = setTimeout(lock, m * 60000); }
function lock() { key = null; data = null; clearTimeout(timer); pending.clear(); emit(); }
function create(master) {
  if (read()) throw new Error('A vault already exists.'); if (String(master).length < 10) throw new Error('Use at least 10 characters for the master password.');
  const salt = crypto.randomBytes(16); key = deriveKey(master, salt, KDF); data = { entries: [], never: [] };
  disk = { v: 1, kdf: KDF, salt: salt.toString('base64'), blob: '' }; persist(); touch(); emit(); return status();
}
function unlock(master) {
  const d = read(); if (!d) throw new Error('No vault yet.');
  const k = deriveKey(master, Buffer.from(d.salt, 'base64'), d.kdf);
  try { data = open(k, d.blob); key = k; } catch (_) { throw new Error('Wrong master password.'); }
  data.never = data.never || []; touch(); emit(); return status();
}
function changeMaster(oldPw, newPw) {
  const d = read(); const k = deriveKey(oldPw, Buffer.from(d.salt, 'base64'), d.kdf); try { open(k, d.blob); } catch (_) { throw new Error('Current master password is wrong.'); }
  if (String(newPw).length < 10) throw new Error('Use at least 10 characters.'); const salt = crypto.randomBytes(16); key = deriveKey(newPw, salt, KDF); disk = { v: 1, kdf: KDF, salt: salt.toString('base64'), blob: '' }; persist(); touch();
}
const need = () => { if (!key) throw new Error('The vault is locked.'); touch(); };

// ---------------------------------------------------------------- TOTP (RFC 6238)
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(s) { s = String(s).toUpperCase().replace(/[\s=-]/g, ''); let bits = '', out = []; for (const ch of s) { const v = B32.indexOf(ch); if (v < 0) throw new Error('That isn’t a valid setup key.'); bits += v.toString(2).padStart(5, '0'); } for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function parseTotp(input) {
  input = String(input || '').trim(); if (!input) return null;
  if (/^otpauth:/i.test(input)) { const u = new URL(input); if (u.hostname.toLowerCase() !== 'totp') throw new Error('Only time-based (TOTP) codes are supported.'); const p = u.searchParams; const secret = p.get('secret'); if (!secret) throw new Error('No secret in that link.'); b32decode(secret);
    return { secret: secret.replace(/[\s=-]/g, '').toUpperCase(), algo: ['SHA1', 'SHA256', 'SHA512'].includes((p.get('algorithm') || 'SHA1').toUpperCase()) ? (p.get('algorithm') || 'SHA1').toUpperCase() : 'SHA1', digits: [6, 7, 8].includes(+p.get('digits')) ? +p.get('digits') : 6, period: [15, 30, 60].includes(+p.get('period')) ? +p.get('period') : 30, issuer: p.get('issuer') || decodeURIComponent(u.pathname.replace(/^\//, '')).split(':')[0] || '' }; }
  b32decode(input); return { secret: input.replace(/[\s=-]/g, '').toUpperCase(), algo: 'SHA1', digits: 6, period: 30 };
}
function totpAt(t, now) {
  const step = Math.floor((now == null ? Date.now() : now) / 1000 / t.period); const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac(t.algo.toLowerCase(), b32decode(t.secret)).update(msg).digest(); const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** t.digits).padStart(t.digits, '0');
}
const code = e => { if (!e.totp) return null; const now = Date.now(); return { code: totpAt(e.totp, now), left: e.totp.period - Math.floor(now / 1000) % e.totp.period, period: e.totp.period, digits: e.totp.digits }; };

// ---------------------------------------------------------------- strength + generator
function strength(pw) {
  if (!pw) return 0; let pool = 0; if (/[a-z]/.test(pw)) pool += 26; if (/[A-Z]/.test(pw)) pool += 26; if (/\d/.test(pw)) pool += 10; if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  let bits = pw.length * Math.log2(pool || 1); if (/(.)\1{2,}/.test(pw)) bits -= 8; if (/^(password|123456|qwerty|letmein|admin|welcome|iloveyou)/i.test(pw)) bits = Math.min(bits, 18); if (/(0123|1234|2345|abcd|qwer)/i.test(pw)) bits -= 8;
  return bits < 36 ? 1 : bits < 52 ? 2 : bits < 70 ? 3 : 4;   // weak / fair / good / strong
}
function generate(o) {
  o = o || {}; const len = Math.max(8, Math.min(128, o.length | 0 || 20)); let sets = [];
  const amb = /[Il1O0o]/g; const pick = s => o.noAmbiguous ? s.replace(amb, '') : s;
  if (o.lower !== false) sets.push(pick('abcdefghijklmnopqrstuvwxyz')); if (o.upper !== false) sets.push(pick('ABCDEFGHIJKLMNOPQRSTUVWXYZ')); if (o.digits !== false) sets.push(pick('0123456789')); if (o.symbols !== false) sets.push('!@#$%^&*()-_=+[]{};:,.?');
  if (!sets.length) sets = [pick('abcdefghijklmnopqrstuvwxyz')]; const all = sets.join(''); const out = sets.map(s => s[crypto.randomInt(s.length)]);
  while (out.length < len) out.push(all[crypto.randomInt(all.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [out[i], out[j]] = [out[j], out[i]]; } return out.join('');
}

// ---------------------------------------------------------------- site matching
const TWO = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.jp', 'ne.jp', 'or.jp', 'com.br', 'co.in', 'co.nz', 'com.mx', 'co.kr', 'com.cn', 'com.tw', 'com.sg']);
const hostOf = u => { try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : 'https://' + u).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return ''; } };
const baseOf = h => { const p = h.split('.'); if (p.length <= 2 || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return h; const l2 = p.slice(-2).join('.'); return TWO.has(l2) ? p.slice(-3).join('.') : l2; };
const sameSite = (a, b) => { const x = hostOf(a), y = hostOf(b); return !!x && !!y && (x === y || baseOf(x) === baseOf(y)); };
const exactHost = (a, b) => hostOf(a) === hostOf(b);

// ---------------------------------------------------------------- CRUD
const meta = e => ({ id: e.id, title: e.title, url: e.url, user: e.user, fav: !!e.fav, hasPass: !!e.pass, hasTotp: !!e.totp, strength: e.pass ? strength(e.pass) : 0, updated: e.updated, created: e.created, note: !!e.notes, issuer: e.totp && e.totp.issuer || '' });
function list() { need(); const seen = {}; for (const e of data.entries) if (e.pass) seen[e.pass] = (seen[e.pass] || 0) + 1; return data.entries.map(e => Object.assign(meta(e), { reused: !!(e.pass && seen[e.pass] > 1) })); }
const get = id => { need(); const e = data.entries.find(x => x.id === id); if (!e) throw new Error('Not found'); return Object.assign({}, e, { totp: e.totp ? Object.assign({}, e.totp) : null }); };
function save(o) {
  need(); const now = Date.now(); let e = o.id && data.entries.find(x => x.id === o.id); const isNew = !e;
  if (isNew) { if (data.entries.length >= 5000) throw new Error('Vault is full (5,000 items).'); e = { id: 'p' + now.toString(36) + crypto.randomBytes(3).toString('hex'), created: now, history: [] }; data.entries.push(e); }
  const t = o.totpInput !== undefined ? (o.totpInput ? parseTotp(o.totpInput) : null) : e.totp;
  if (!isNew && typeof o.pass === 'string' && o.pass !== e.pass && e.pass) { e.history = [{ pass: e.pass, t: e.updated || now }].concat(e.history || []).slice(0, 5); }
  Object.assign(e, { title: String(o.title != null ? o.title : e.title || '').slice(0, 120), url: String(o.url != null ? o.url : e.url || '').slice(0, 500), user: String(o.user != null ? o.user : e.user || '').slice(0, 200), pass: o.pass != null ? String(o.pass).slice(0, 500) : e.pass || '', notes: String(o.notes != null ? o.notes : e.notes || '').slice(0, 5000), fav: o.fav != null ? !!o.fav : !!e.fav, totp: t, updated: now });
  if (!e.title) e.title = hostOf(e.url) || e.user || 'Untitled'; persist(); emit(); return meta(e);
}
function remove(id) { need(); data.entries = data.entries.filter(e => e.id !== id); persist(); emit(); }
const totps = () => { need(); const out = {}; for (const e of data.entries) if (e.totp) out[e.id] = code(e); return out; };

// ---------------------------------------------------------------- import / export (CSV)
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false; text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) { const c = text[i]; if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x !== '')) rows.push(row); row = []; } else cur += c; }
  row.push(cur); if (row.some(x => x !== '')) rows.push(row); return rows;
}
function importCsv(text) {
  need(); const rows = parseCsv(String(text)); if (rows.length < 2) throw new Error('That file looks empty.');
  const hd = rows[0].map(h => h.trim().toLowerCase()); const col = (...names) => { for (const n of names) { const i = hd.indexOf(n); if (i >= 0) return i; } return -1; };
  const iu = col('url', 'login_uri', 'origin', 'website', 'login url'), iname = col('name', 'title'), iuser = col('username', 'login_username', 'user', 'login'), ipw = col('password', 'login_password'), inote = col('note', 'notes', 'extra'), itotp = col('totp', 'login_totp', 'otpauth', 'one-time password', 'otp');
  if (ipw < 0 && itotp < 0) throw new Error('Couldn’t find a password column. Export from Chrome, Edge, Firefox, Bitwarden or 1Password as CSV.');
  let added = 0, dup = 0, skipped = 0;
  for (const r of rows.slice(1)) {
    const url = iu >= 0 ? r[iu] || '' : '', user = iuser >= 0 ? r[iuser] || '' : '', pass = ipw >= 0 ? r[ipw] || '' : ''; let totp = null; try { totp = itotp >= 0 && r[itotp] ? r[itotp] : null; if (totp) parseTotp(totp); } catch (_) { totp = null; }
    if (!pass && !totp) { skipped++; continue; }
    if (data.entries.some(e => exactHost(e.url, url) && e.user === user && e.pass === pass)) { dup++; continue; }
    save({ title: iname >= 0 ? r[iname] : '', url, user, pass, notes: inote >= 0 ? r[inote] : '', totpInput: totp }); added++;
  }
  return { added, duplicates: dup, skipped };
}
function exportCsv(master) {
  need(); const d = read(); try { open(deriveKey(master, Buffer.from(d.salt, 'base64'), d.kdf), d.blob); } catch (_) { throw new Error('Wrong master password.'); }
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  return ['name,url,username,password,note,totp'].concat(data.entries.map(e => [e.title, e.url, e.user, e.pass, e.notes, e.totp ? `otpauth://totp/${encodeURIComponent(e.title)}?secret=${e.totp.secret}&issuer=${encodeURIComponent(e.totp.issuer || e.title)}&algorithm=${e.totp.algo}&digits=${e.totp.digits}&period=${e.totp.period}` : ''].map(q).join(','))).join('\r\n');
}

// ---------------------------------------------------------------- page-facing helpers (autofill)
const pending = new Map();      // webContents id -> { url, user, pass, t }
const matchesFor = url => key ? data.entries.filter(e => (e.pass || e.totp) && e.url && sameSite(e.url, url)).sort((a, b) => (exactHost(b.url, url) - exactHost(a.url, url)) || (b.updated - a.updated)) : [];
const pageList = url => { touch(); return matchesFor(url).map(e => ({ id: e.id, title: e.title, user: e.user, hasPass: !!e.pass, hasTotp: !!e.totp, exact: exactHost(e.url, url) })); };
const pageFill = (url, id, what) => { touch(); const e = matchesFor(url).find(x => x.id === id); if (!e) throw new Error('No match'); return what === 'code' ? (e.totp ? { code: code(e).code } : null) : { user: e.user, pass: e.pass }; };
function capture(wcId, url, user, pass) {
  if (!key || !S.get().vaultOffer) { if (key || !read()) return; }
  if (!pass || pass.length > 300) return; const h = hostOf(url); if (data && data.never.includes(baseOf(h))) return;
  if (data) { const ex = data.entries.find(e => exactHost(e.url, url) && e.user === user); if (ex && ex.pass === pass) return; }
  pending.set(wcId, { url, user: user || '', pass, t: Date.now(), update: !!(data && data.entries.some(e => exactHost(e.url, url) && e.user === user)) });
}
function pendingFor(wcId) { const p = pending.get(wcId); if (!p) return null; if (Date.now() - p.t > 120000) { pending.delete(wcId); return null; } return { host: hostOf(p.url), user: p.user, update: p.update, locked: !key }; }
function pendingSave(wcId) { need(); const p = pending.get(wcId); if (!p) return null; pending.delete(wcId); const ex = data.entries.find(e => exactHost(e.url, p.url) && e.user === p.user); return save({ id: ex && ex.id, url: ex ? ex.url : p.url.replace(/^(https?:\/\/[^/]+).*/, '$1/'), user: p.user, pass: p.pass }); }
const pendingDrop = (wcId, never) => { const p = pending.get(wcId); pending.delete(wcId); if (never && p && key) { data.never.push(baseOf(hostOf(p.url))); persist(); } };

function copy(id, field) {
  need(); const e = data.entries.find(x => x.id === id); if (!e) throw new Error('Not found'); const v = field === 'pass' ? e.pass : field === 'user' ? e.user : field === 'code' ? (e.totp ? code(e).code : '') : '';
  if (!v) return false; clipboard.writeText(v); const stamp = v; if (field !== 'user') setTimeout(() => { try { if (clipboard.readText() === stamp) clipboard.clear(); } catch (_) {} }, 30000); return true;
}
function init() { try { powerMonitor.on('lock-screen', lock); powerMonitor.on('suspend', lock); } catch (_) {} }
module.exports = { init, status, create, unlock, lock, changeMaster, list, get, save, remove, totps, generate, strength, importCsv, exportCsv, parseTotp, totpAt, pageList, pageFill, capture, pendingFor, pendingSave, pendingDrop, copy, hostOf, sameSite, onStatus: f => listeners.push(f), _t: { b32decode, parseCsv, baseOf } };
