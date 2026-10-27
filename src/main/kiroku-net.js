'use strict';
// Live Kiroku integration: read-only API (library, watching, stats, history) + built-in watch tracker that replaces the Kiroku browser extension.
//  - Keys live in the encrypted secret store: 'kiroku:read' (kk_r_…, Mega API) and 'kiroku:ingest' (kk_i_…, progress reporting).
//  - The tracker only reports on the six streaming sites, only from normal persistent windows, and only when you are connected and tracking is on.
const { net, ipcMain, session } = require('electron');
const S = require('./state');
const secure = require('./secure');

const DEFAULT_SERVER = 'https://kiroku.zeabur.app';
const server = () => (S.get().kirokuUrl || DEFAULT_SERVER).replace(/\/+$/, '');
const HOSTS = { 'crunchyroll.com': 'crunchyroll', 'hidive.com': 'hidive', 'adultswim.com': 'adultswim', 'hulu.com': 'hulu', 'netflix.com': 'netflix', 'disneyplus.com': 'disneyplus' };
const NAMES = { crunchyroll: 'Crunchyroll', hidive: 'HIDIVE', adultswim: 'Adult Swim', hulu: 'Hulu', netflix: 'Netflix', disneyplus: 'Disney+' };
const providerOf = u => { try { const h = new URL(u).hostname.toLowerCase(); const k = Object.keys(HOSTS).find(x => h === x || h.endsWith('.' + x)); return k ? HOSTS[k] : null; } catch (_) { return null; } };

let listeners = [], cache = {}, me = null, last = null, trackTimer = {}, lastSent = new Map();
const emit = () => listeners.forEach(f => { try { f(); } catch (_) {} });

// ------------------------------------------------------------ http
async function http(method, p, o) {
  o = o || {};
  const headers = { accept: 'application/json' }; if (o.key) headers.authorization = 'Bearer ' + o.key; if (o.body) headers['content-type'] = 'application/json';
  let res; try { res = await net.fetch(server() + p, { method, headers, body: o.body ? JSON.stringify(o.body) : undefined, signal: AbortSignal.timeout(o.timeout || 15000) }); } catch (_) { throw new Error('Cannot reach ' + server()); }
  const t = await res.text(); let d = {}; try { d = t ? JSON.parse(t) : {}; } catch (_) {}
  if (!res.ok) { const m = d && d.error && (d.error.message || d.error); const e = new Error(typeof m === 'string' ? m : 'Kiroku answered HTTP ' + res.status); e.status = res.status; throw e; }
  return d;
}
const v1 = (p, ttl) => {
  const key = secure.get('kiroku:read'); if (!key) return Promise.reject(new Error('Kiroku isn’t connected yet.'));
  const hit = cache[p]; if (ttl && hit && Date.now() - hit.t < ttl) return Promise.resolve(hit.d);
  return http('GET', '/api/v1' + p, { key }).then(d => { cache[p] = { t: Date.now(), d }; return d; });
};

// ------------------------------------------------------------ tolerant normalisers (the API may use camelCase or snake_case)
const pick = (o, ...k) => { for (const x of k) if (o && o[x] != null && o[x] !== '') return o[x]; return undefined; };
const list = d => Array.isArray(d) ? d : (d && (d.items || d.library || d.results || d.data || d.watching || d.history || d.entries)) || [];
function progressOf(x) {
  let p = pick(x, 'progress', 'aniwatch_progress', 'aniwatchProgress', 'watch');
  const o = { episode: pick(x, 'episode', 'lastEpisode', 'last_episode', 'ep'), watched: pick(x, 'watchedEpisodes', 'watched_episodes', 'episodesWatched'), total: pick(x, 'episodes', 'totalEpisodes'), pct: pick(x, 'pct', 'percent'), provider: pick(x, 'provider', 'service', 'source'), at: pick(x, 'updatedAt', 'updated_at', 'lastWatched', 'last_watched', 'at', 'time'), url: pick(x, 'url', 'resumeUrl', 'resume_url', 'link') };
  if (p && typeof p === 'object') { o.episode = pick(p, 'episode', 'lastEpisode', 'last_episode', 'ep') ?? o.episode; o.watched = pick(p, 'watched', 'watchedEpisodes', 'episodesWatched', 'count') ?? o.watched; o.total = pick(p, 'total', 'episodes', 'totalEpisodes') ?? o.total; o.pct = pick(p, 'pct', 'percent') ?? o.pct; o.provider = pick(p, 'provider', 'service') ?? o.provider; o.at = pick(p, 'updatedAt', 'updated_at', 'at', 'latest') ?? o.at; o.url = pick(p, 'url', 'resumeUrl', 'link') ?? o.url; }
  else if (typeof p === 'string') { const m = /watched\s+(\d+)\s*\/\s*(\d+)/i.exec(p); if (m) { o.watched = +m[1]; o.total = +m[2]; } const e = /last ep(?:isode)?\s+(\d+)/i.exec(p); if (e) o.episode = +e[1]; }
  for (const k of ['episode', 'watched', 'total', 'pct']) if (o[k] != null && !Number.isNaN(+o[k])) o[k] = +o[k]; else delete o[k];
  if (o.pct == null && o.watched != null && o.total) o.pct = Math.round(100 * o.watched / o.total);
  if (o.at != null) { const t = typeof o.at === 'number' ? (o.at < 1e12 ? o.at * 1000 : o.at) : Date.parse(o.at); o.at = Number.isFinite(t) ? t : undefined; }
  return Object.keys(o).filter(k => o[k] == null).forEach(k => delete o[k]) || o;
}
function norm(x) {
  const it = x.item || x.anime || x; const wh = pick(it, 'where_to_watch', 'whereToWatch') || [];
  const urls = (Array.isArray(wh) ? wh : []).map(s => { const m = /^([^:]+):\s*(https?:\/\/\S+)/.exec(String(s)); return m ? { name: m[1], url: m[2] } : (s && s.url ? { name: s.name || s.provider || 'Watch', url: s.url } : null); }).filter(Boolean);
  const pr = progressOf(x === it ? it : Object.assign({}, it, x));
  return {
    id: pick(it, 'id'), anilistId: pick(it, 'anilist_id', 'anilistId', 'anilist'), title: pick(it, 'title', 'name', 'series') || '', status: pick(it, 'status'), rating: pick(it, 'rating', 'score') ?? null,
    episodes: pick(it, 'episodes', 'totalEpisodes') ?? null, year: pick(it, 'year') ?? null, format: pick(it, 'format') || '', genres: pick(it, 'genres') || [], cover: pick(it, 'cover', 'coverImage', 'image', 'poster', 'thumbnail') || '',
    aniwatch: pick(it, 'aniwatch', 'aniwatchUrl', 'aniwatch_url') || (urls.find(u => /aniwatch/i.test(u.name)) || {}).url || '', where: urls, progress: pr
  };
}
const resumeUrl = a => (a.progress && a.progress.url) || a.aniwatch || (a.where[0] && a.where[0].url) || (a.anilistId ? 'https://anilist.co/anime/' + a.anilistId : '');

async function library(force) {
  if (force) delete cache['/library:all'];
  const hit = cache['/library:all']; if (hit && Date.now() - hit.t < 120000) return hit.d;
  const out = []; for (let off = 0; off < 5000; off += 200) { const d = await v1('/library?limit=200&offset=' + off); const l = list(d); out.push(...l); if (l.length < 200) break; }
  const items = out.map(norm).filter(i => i.title); cache['/library:all'] = { t: Date.now(), d: items }; return items;
}
const watching = async () => list(await v1('/watching?limit=12', 30000)).map(norm).filter(i => i.title).map(i => Object.assign(i, { resume: resumeUrl(i) }));
const history = async () => list(await v1('/history?limit=30', 60000)).map(x => Object.assign(norm(x), { at: (progressOf(x) || {}).at })).filter(i => i.title);
const stats = () => v1('/stats', 60000);

// ------------------------------------------------------------ connection
function parseSetup(raw) {
  const t = String(raw || '').trim().replace(/^kiroku:/i, ''); let o; try { o = JSON.parse(Buffer.from(t, 'base64').toString('utf8')); } catch (_) { throw new Error('That doesn’t look like a Kiroku setup code.'); }
  let u; try { u = new URL(o.s); } catch (_) { throw new Error('The setup code has no valid server.'); }
  if (!/^kk_i_/.test(String(o.k || ''))) throw new Error('That isn’t a tracker key. Create a setup code under Providers on your Kiroku site.');
  return { server: u.origin, key: o.k };
}
async function connect(o) {
  o = o || {}; let srv = server();
  if (o.server) { let u; try { u = new URL(/^https?:\/\//i.test(o.server) ? o.server : 'https://' + o.server); } catch (_) { throw new Error('Enter your Kiroku site address.'); } srv = u.origin; S.patch({ kirokuUrl: srv }); }
  const res = {};
  if (o.setupCode) { const s = parseSetup(o.setupCode); if (o.server && s.server !== srv) S.patch({ kirokuUrl: s.server }); else if (!o.server) S.patch({ kirokuUrl: s.server });
    const j = await http('GET', '/api/ingest/ping', { key: s.key }).catch(e => { throw new Error(e.status === 401 || e.status === 403 ? 'Kiroku rejected that setup code.' : e.message); }); secure.set('kiroku:ingest', s.key); res.tracker = j.username || true; }
  if (o.readKey) { const k = String(o.readKey).trim(); if (!/^kk_r_/.test(k)) throw new Error('A read key starts with kk_r_ — create one under Account → API keys on Kiroku.'); await http('GET', '/api/v1/me', { key: k }).catch(e => { throw new Error(e.status === 401 || e.status === 403 ? 'Kiroku rejected that read key.' : e.message); }); secure.set('kiroku:read', k); res.read = true; }
  if (!res.tracker && !res.read) throw new Error('Paste a read key and/or a tracker setup code.');
  cache = {}; me = null; S.patch({ kirokuConnected: true, kirokuTrack: S.get().kirokuTrack !== false }); emit(); refreshMe(); return status();
}
/** One click: if you're signed in to Kiroku inside Kitsune, create both keys with your session. */
async function autoConnect() {
  const ses = session.fromPartition('persist:main'); const call = async (method, p, body) => {
    let r; try { r = await ses.fetch(server() + p, { method, headers: { 'content-type': 'application/json', accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined, credentials: 'include' }); } catch (_) { throw new Error('Cannot reach ' + server()); }
    const t = await r.text(); let d = {}; try { d = JSON.parse(t); } catch (_) {} if (r.status === 401) { const e = new Error('Sign in to Kiroku in Kitsune first, then try again.'); e.needLogin = true; throw e; } if (!r.ok) throw new Error((d.error && (d.error.message || d.error)) || 'Kiroku answered HTTP ' + r.status); return d; };
  await call('GET', '/api/me');
  const rk = await call('POST', '/api/keys', { scope: 'read', name: 'Kitsune' }); const ik = await call('POST', '/api/keys', { scope: 'ingest', name: 'Kitsune tracker' });
  if (!rk.key || !ik.setupCode) throw new Error('Kiroku didn’t return the keys. Use the manual option instead.');
  return connect({ readKey: rk.key, setupCode: ik.setupCode });
}
function disconnect() { secure.set('kiroku:read', ''); secure.set('kiroku:ingest', ''); cache = {}; me = null; last = null; S.patch({ kirokuConnected: false }); emit(); }
async function refreshMe() { try { me = await v1('/me'); } catch (_) { me = null; } emit(); return me; }
const status = () => ({ server: server(), read: !!secure.get('kiroku:read'), tracker: !!secure.get('kiroku:ingest'), track: S.get().kirokuTrack !== false, user: me && (me.username || me.user || me.name) || '', last, providers: NAMES });
const connected = () => !!secure.get('kiroku:read');

// ------------------------------------------------------------ tracker (replaces the browser extension)
const GET_PAGE = `(() => { const clean = s => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim().slice(0, 300); const text = sel => { const e = document.querySelector(sel); return e ? clean(e.textContent) : ''; }; const meta = sel => { const e = document.querySelector(sel); return e ? clean(e.getAttribute('content')) : ''; };
  const leaf = r => { const o = []; const w = el => { if (!el.children.length) { const t = clean(el.textContent); if (t) o.push(t); return; } for (const c of el.children) w(c); }; w(r); return o.join(' | '); };
  const UI = { netflix: ['[data-uia="video-title"]', '[class*="video-title" i]'], disneyplus: ['[data-testid*="title" i]', '[class*="title-field" i]', '[class*="playback" i] [class*="title" i]'], hulu: ['[class*="PlayerMetadata" i]', '[class*="metadata__title" i]', '[class*="ControlsBar" i] [class*="title" i]'], hidive: ['[class*="player" i] [class*="title" i]'], adultswim: ['[class*="player" i] [class*="title" i]'] };
  const h = location.hostname; const prov = h.includes('netflix') ? 'netflix' : h.includes('disneyplus') ? 'disneyplus' : h.includes('hulu') ? 'hulu' : h.includes('hidive') ? 'hidive' : h.includes('adultswim') ? 'adultswim' : 'crunchyroll';
  const ui = []; for (const sel of (UI[prov] || [])) { let els = []; try { els = [...document.querySelectorAll(sel)].slice(0, 3); } catch (_) {} for (const el of els) { const t = leaf(el); if (t && t.length < 250 && !ui.includes(t)) ui.push(t); } }
  const ld = []; const visit = o => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(visit); const ty = [].concat(o['@type'] || []).join(','); if (/TVEpisode/i.test(ty)) { const series = o.partOfSeries && (o.partOfSeries.name || (o.partOfSeries.partOfSeries && o.partOfSeries.partOfSeries.name)); const season = o.partOfSeason && o.partOfSeason.seasonNumber; if (series) ld.push({ type: 'TVEpisode', name: clean(o.name), series: clean(series), episode: o.episodeNumber, season }); } if (o['@graph']) visit(o['@graph']); };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) { try { visit(JSON.parse(s.textContent)); } catch (_) {} }
  return { title: clean(document.title), og: meta('meta[property="og:title"]'), h1: text('h1'), ui: ui.slice(0, 6), ld: ld.slice(0, 5) }; })()`;

async function onVideo(e, m) {
  try {
    if (!m || typeof m !== 'object' || S.get().kirokuTrack === false) return;
    const key = secure.get('kiroku:ingest'); if (!key) return;
    const wc = e.sender; if (!wc || wc.isDestroyed()) return;
    if (!wc.session.isPersistent()) return;                 // never from private windows
    const provider = providerOf(e.senderFrame && e.senderFrame.url); if (!provider) return;      // derived from the real frame URL, not from the page's claim
    const time = +m.time, duration = +m.duration; if (!(duration > 0) || !Number.isFinite(time) || time < 0) return;
    const now = Date.now(); if (now - (lastSent.get(wc.id) || 0) < 2500 && !m.ended) return; lastSent.set(wc.id, now);
    let page = null; try { page = await wc.mainFrame.executeJavaScript(GET_PAGE, true); } catch (_) {}
    const body = Object.assign({ provider }, page || {}, { time, duration, ended: !!m.ended });
    let j, ok = false, status = 0;
    try { const r = await net.fetch(server() + '/api/ingest/progress', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) }); status = r.status; j = await r.json().catch(() => ({})); ok = r.ok && j.ok; } catch (_) { j = {}; }
    if (ok && j.ignored) return;
    last = ok ? (j.matched ? { ok: true, provider, text: `${j.title}, episode ${j.episode}${j.completed ? ' (finished)' : ` (${j.pct}%)`}`, at: now, title: j.title, episode: j.episode, completed: !!j.completed } : { ok: false, provider, text: 'Not matched: ' + (j.reason || 'unknown'), at: now })
      : { ok: false, provider, text: status === 401 || status === 403 ? 'Kiroku rejected the tracker key — reconnect in Settings.' : status ? ((j.error && (j.error.message || j.error)) || 'Kiroku error ' + status) : 'Couldn’t reach Kiroku', at: now };
    if (last.ok && (!trackTimer.t)) { delete cache['/watching?limit=12']; delete cache['/library:all']; trackTimer.t = setTimeout(() => { trackTimer.t = null; emit(); }, 15000); }
    if (last.ok && (last.completed || !trackTimer.toast || now - trackTimer.toast > 600000)) { trackTimer.toast = now; try { { const B = require('./browser'); const t = B.tabByWc.get(wc.id); if (t) B.toast(t.win, 'Kiroku: ' + last.text, 'ok'); }; } catch (_) {} }
    emit();
  } catch (_) {}
}
function init() { ipcMain.on('kiroku:video', onVideo); if (connected()) refreshMe(); }
module.exports = { init, onChange: f => listeners.push(f), status, connected, connect, autoConnect, disconnect, library, watching, history, stats, providerOf, norm, resumeUrl, HOSTS, NAMES };
