'use strict';
// Account + sync client. Talks to the Kitsune site's /api/auth and /api/sync (own accounts, no third party).
// Strategy: per collection, compare a content hash with the last synced hash.
//   only local changed -> push; only remote changed -> pull; both -> merge (union for lists, newest for settings).
const crypto = require('crypto');
const { net } = require('electron');
const S = require('./state');
const secure = require('./secure');
const storage = require('./storage');

const meta = () => (meta._s || (meta._s = storage.open('sync-meta', { rev: 0, hashes: {}, last: 0, error: '' })));
const NO_SYNC = new Set(['downloadDir', 'nimbusServer', 'nimbusModel', 'aiMode', 'aiOpen', 'aiPageContext', 'tmdbKey', 'accountServer', 'accountEmail', 'syncOn', 'syncWhat', 'sitePerms', 'setupDone', 'vpnOn', 'vpnActive', 'vpnProfiles', 'vpnBypass', 'vpnWebrtc', 'vpnFreeInit', 'kirokuConnected', 'kirokuUrl', 'extensions', 'customThemes', 'pins', 'containers']);
const hash = o => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex');
let timer = null, running = false, listeners = [];
const status = { signedIn: false, email: '', syncing: false, last: 0, error: '' };

const server = () => (S.get().accountServer || '').replace(/\/+$/, '');
async function api(method, p, body, token) {
  let res;
  try { res = await net.fetch(server() + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch (_) { throw new Error('Cannot reach ' + server()); }
  const t = await res.text(); let d = {}; try { d = t ? JSON.parse(t) : {}; } catch (_) {}
  if (!res.ok) { const e = new Error(d.error || 'Server answered HTTP ' + res.status); e.status = res.status; throw e; }
  return d;
}

function collect() {
  const s = S.get(), w = s.syncWhat || {}, out = {};
  if (w.bookmarks) out.bookmarks = S.bookmarks().data.items.map(b => ({ title: b.title, url: b.url, bar: !!b.bar, added: b.added }));
  if (w.settings) { const o = {}; for (const k of Object.keys(s)) if (!NO_SYNC.has(k)) o[k] = s[k]; out.settings = o; }
  if (w.pins) out.pins = { pins: s.pins, containers: s.containers };
  if (w.themes) out.themes = { customThemes: s.customThemes, theme: s.theme };
  if (w.history) out.history = S.history().data.items.slice(-1500).map(h => ({ url: h.url, title: h.title, time: h.time, visits: h.visits }));
  if (w.extensions) out.extensions = (s.extensions || []).filter(e => e.id).map(e => ({ id: e.id, name: e.name }));
  return out;
}
function applyRemote(c, data, mode) { // mode: 'replace' | 'merge'
  if (c === 'bookmarks') {
    const st = S.bookmarks(); const have = new Map(st.data.items.map(b => [b.url, b]));
    if (mode === 'replace') st.data.items = [];
    const base = mode === 'replace' ? new Map() : have;
    for (const b of data) if (!base.has(b.url)) { st.data.items.push({ id: 'b' + Math.random().toString(36).slice(2, 9), title: b.title, url: b.url, bar: !!b.bar, added: b.added || Date.now() }); base.set(b.url, 1); }
    st.save(); require('./browser').broadcast('bookmarks');
  } else if (c === 'settings') { const o = {}; for (const k of Object.keys(data)) if (!NO_SYNC.has(k)) o[k] = data[k]; S.patch(o); }
  else if (c === 'pins') {
    if (mode === 'merge') { const have = new Set((S.get().pins || []).map(p => p.url)); S.patch({ pins: (S.get().pins || []).concat((data.pins || []).filter(p => !have.has(p.url))), containers: data.containers || S.get().containers }); }
    else S.patch({ pins: data.pins || [], containers: data.containers || S.get().containers });
  } else if (c === 'themes') {
    const have = new Set((S.get().customThemes || []).map(t => t.id));
    S.patch({ customThemes: (S.get().customThemes || []).concat((data.customThemes || []).filter(t => !have.has(t.id))) });
    if (mode === 'replace' && data.theme) S.patch({ theme: data.theme });
  } else if (c === 'history') {
    const st = S.history(); const have = new Map(st.data.items.map(h => [h.url, h]));
    for (const h of data) { const e = have.get(h.url); if (e) { e.time = Math.max(e.time, h.time); e.visits = Math.max(e.visits, h.visits); } else { const n = { url: h.url, title: h.title, time: h.time, visits: h.visits }; st.data.items.push(n); have.set(h.url, n); } }
    st.data.items.sort((a, b) => a.time - b.time); st.save();
  } else if (c === 'extensions') { try { require('./extensions').ensureIds(data); } catch (_) {} }
}

async function syncNow() {
  if (running) return; const token = secure.get('accountToken'); if (!token || !S.get().syncOn) return;
  running = true; status.syncing = true; emit();
  try {
    const m = meta().data; const local = collect(); const remote = await api('GET', '/api/sync', undefined, token);
    const rd = remote.data || {}; const remoteChanged = remote.rev !== m.rev; const merged = {};
    for (const c of Object.keys(local)) {
      const lh = hash(local[c]); const localChanged = lh !== m.hashes[c];
      const r = rd[c];
      if (r === undefined) { merged[c] = local[c]; continue; }                         // nothing remote yet
      if (!remoteChanged && !localChanged) { merged[c] = local[c]; continue; }
      if (remoteChanged && !localChanged) { applyRemote(c, r, 'replace'); merged[c] = r; continue; }
      if (!remoteChanged && localChanged) { merged[c] = local[c]; continue; }
      applyRemote(c, r, 'merge'); merged[c] = collect()[c];                              // both changed
    }
    for (const c of Object.keys(rd)) if (!(c in merged) && (S.get().syncWhat || {})[c === 'themes' ? 'themes' : c]) merged[c] = rd[c];
    const out = await api('PUT', '/api/sync', { baseRev: remote.rev, data: Object.assign({}, rd, merged) }, token);
    const fresh = collect(); m.rev = out.rev; m.hashes = {}; for (const c of Object.keys(fresh)) m.hashes[c] = hash(fresh[c]); m.last = Date.now(); m.error = ''; meta().save();
    status.last = m.last; status.error = '';
  } catch (e) {
    status.error = e.message; if (e.status === 401) { secure.set('accountToken', ''); status.signedIn = false; status.error = 'Signed out — please sign in again.'; }
  } finally { running = false; status.syncing = false; emit(); }
}
function schedule() { clearTimeout(timer); timer = setTimeout(() => { syncNow(); }, 20000); }
function emit() { for (const f of listeners) try { f(Object.assign({}, status)); } catch (_) {} }

async function auth(kind, email, password) {
  const d = await api('POST', '/api/auth/' + kind, { email, password });
  secure.set('accountToken', d.token); S.patch({ accountEmail: d.email || email, syncOn: true }); status.signedIn = true; status.email = d.email || email;
  meta().data.rev = 0; meta().data.hashes = {}; meta().save();
  syncNow(); return { ok: true, email: status.email };
}
async function signOut() { const t = secure.get('accountToken'); secure.set('accountToken', ''); try { if (t) await api('POST', '/api/auth/logout', {}, t); } catch (_) {} status.signedIn = false; status.email = ''; S.patch({ accountEmail: '' }); emit(); }
async function deleteAccount(password) { const t = secure.get('accountToken'); await api('POST', '/api/auth/delete', { password }, t); secure.set('accountToken', ''); status.signedIn = false; S.patch({ accountEmail: '' }); emit(); }

function init() {
  status.signedIn = !!secure.get('accountToken'); status.email = S.get().accountEmail; status.last = meta().data.last;
  S.bus.on('settings', () => { if (status.signedIn) schedule(); });
  setInterval(() => { if (status.signedIn) syncNow(); }, 5 * 60 * 1000);
  if (status.signedIn) setTimeout(syncNow, 8000);
  const st = S.bookmarks(); const save = st.save.bind(st); st.save = (...a) => { save(...a); if (status.signedIn) schedule(); };
}
module.exports = { init, auth, signOut, deleteAccount, syncNow, status: () => Object.assign({}, status), onStatus: f => listeners.push(f) };
