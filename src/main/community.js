'use strict';
// Community client: browse, install, publish, like and report backgrounds + themes on the Kitsune site.
const { net } = require('electron');
const S = require('./state');
const secure = require('./secure');
const BG = require('./backgrounds');
const TH = require('./themes');

const base = () => (S.get().communityServer || S.get().accountServer || '').replace(/\/+$/, '');
async function req(method, p, body, o) {
  o = o || {}; const token = secure.get('accountToken');
  if (o.auth && !token) throw new Error('Sign in to your Kitsune account first (Settings → Account).');
  const headers = {}; if (token) headers.authorization = 'Bearer ' + token;
  let data = body; if (body !== undefined && !Buffer.isBuffer(body)) { headers['content-type'] = 'application/json'; data = JSON.stringify(body); } else if (Buffer.isBuffer(body)) headers['content-type'] = 'application/octet-stream';
  let res; try { res = await net.fetch(base() + p, { method, headers, body: data }); } catch (_) { throw new Error('Cannot reach ' + base()); }
  if (o.raw) { if (!res.ok) throw new Error('Download failed (HTTP ' + res.status + ')'); return Buffer.from(await res.arrayBuffer()); }
  const t = await res.text(); let d = {}; try { d = t ? JSON.parse(t) : {}; } catch (_) {}
  if (!res.ok) throw new Error(d.error || 'Server answered HTTP ' + res.status); return d;
}
const qs = o => Object.entries(o).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');

const list = (o) => req('GET', '/api/community?' + qs({ kind: o && o.kind, q: o && o.q, sort: o && o.sort, page: o && o.page }));
const mine = () => req('GET', '/api/community/mine', undefined, { auth: true });
const like = id => req('POST', '/api/community/' + encodeURIComponent(id) + '/like', {}, { auth: true });
const report = id => req('POST', '/api/community/' + encodeURIComponent(id) + '/report', {}, { auth: true });
const del = id => req('DELETE', '/api/community/' + encodeURIComponent(id), undefined, { auth: true });
const signedIn = () => !!secure.get('accountToken');
const thumbUrl = id => base() + '/api/community/file/' + encodeURIComponent(id);

async function publishBackground(localId, m) {
  const r = BG.read(localId); if (!r) throw new Error('That background is gone.');
  if (r.item.community) return { id: r.item.community, reused: true };
  const lim = r.item.type === 'video' ? 25 : 8; if (r.buf.length > lim * 1048576) throw new Error(`Community ${r.item.type}s can be ${lim} MB at most (this one is ${(r.buf.length / 1048576).toFixed(1)} MB).`);
  const out = await req('POST', '/api/community/background?' + qs({ title: (m && m.title) || r.item.name, desc: m && m.desc, tags: m && m.tags }), r.buf, { auth: true });
  BG.mark(localId, out.id); return out;
}
async function publishTheme(themeId, m) {
  const t = (S.get().customThemes || []).find(x => x.id === themeId); if (!t) throw new Error('Theme not found.');
  let wallId = null;
  if (t.wall && t.wall.url) { const f = /^kitsune:\/\/bg\/([a-z0-9]+\.[a-z0-9]+)$/i.exec(t.wall.url); if (f) { const it = BG.list().find(x => x.file === f[1]); if (it) wallId = (await publishBackground(it.id, { title: (m && m.title) || t.name, tags: m && m.tags })).id; } }
  return req('POST', '/api/community/theme', { title: (m && m.title) || t.name, desc: m && m.desc, tags: m && m.tags, wallId, theme: t }, { auth: true });
}
async function install(id) {
  const it = await req('GET', '/api/community/item/' + encodeURIComponent(id));
  const dl = async cid => BG.addBuffer(await req('GET', '/api/community/file/' + encodeURIComponent(cid), undefined, { raw: true }), { name: it.title, community: cid });
  if (it.kind === 'background') { const have = BG.list().find(x => x.community === id); if (have) return { ok: true, kind: 'background', already: true }; await dl(id); return { ok: true, kind: 'background' }; }
  const t = Object.assign({ name: it.title }, it.theme);
  if (it.wallId) { const have = BG.list().find(x => x.community === it.wallId); const b = have || await dl(it.wallId); t.wall = { type: b.type, url: 'kitsune://bg/' + b.file, dim: it.theme.dim != null ? it.theme.dim : 0.35 }; }
  delete t.dim; const r = TH.add(t); return { ok: true, kind: 'theme', id: r.id, name: r.ok };
}
module.exports = { list, mine, like, report, del, publishBackground, publishTheme, install, signedIn, thumbUrl, base };
