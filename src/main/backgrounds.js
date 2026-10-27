'use strict';
// Custom backgrounds: your own images and videos (and ones installed from the community), stored in the profile.
// Served to internal pages as kitsune://bg/<file>.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, dialog } = require('electron');
const storage = require('./storage');

const store = storage.open('custom-bgs', { items: [] });
const dir = () => { const d = path.join(app.getPath('userData'), 'backgrounds'); fs.mkdirSync(d, { recursive: true }); return d; };
const EXT = { image: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'], video: ['.mp4', '.webm', '.m4v', '.mov'] };
const MAX = { image: 40 * 1048576, video: 400 * 1048576 };

/** Detect by file signature, never by extension or a declared type. */
function sniff(b) {
  if (b.length < 12) return null; const h = b.slice(0, 12);
  if (h[0] === 0xff && h[1] === 0xd8) return { type: 'image', ext: '.jpg' };
  if (h.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image', ext: '.png' };
  if (h.slice(0, 3).toString() === 'GIF') return { type: 'image', ext: '.gif' };
  if (h.slice(0, 4).toString() === 'RIFF' && h.slice(8, 12).toString() === 'WEBP') return { type: 'image', ext: '.webp' };
  if (h.slice(4, 8).toString() === 'ftyp') { const brand = h.slice(8, 12).toString(); return /^(avif|avis)$/.test(brand) ? { type: 'image', ext: '.avif' } : { type: 'video', ext: '.mp4' }; }
  if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return { type: 'video', ext: '.webm' };
  return null;
}
const list = () => store.data.items.map(x => Object.assign({}, x, { url: 'kitsune://bg/' + x.file }));
function addBuffer(buf, meta) {
  const k = sniff(buf); if (!k) throw new Error('That isn’t a supported image or video (JPG, PNG, WebP, GIF, AVIF, MP4, WebM).');
  if (buf.length > MAX[k.type]) throw new Error(`That ${k.type} is too large (max ${MAX[k.type] / 1048576} MB).`);
  const id = 'c' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'); const file = id + k.ext;
  fs.writeFileSync(path.join(dir(), file), buf);
  const item = { id, file, type: k.type, name: String((meta && meta.name) || 'My background').slice(0, 60), added: Date.now(), community: (meta && meta.community) || undefined, on: true };
  store.data.items.push(item); store.save(); return item;
}
async function pick() {
  const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images & videos', extensions: [...EXT.image, ...EXT.video].map(e => e.slice(1)) }] });
  if (r.canceled) return { added: [] };
  const added = [], errors = [];
  for (const f of r.filePaths) { try { const st = fs.statSync(f); if (st.size > 400 * 1048576) throw new Error('too large'); added.push(addBuffer(fs.readFileSync(f), { name: path.basename(f, path.extname(f)) })); } catch (e) { errors.push(path.basename(f) + ': ' + e.message); } }
  return { added: added.map(x => x.id), errors };
}
function update(id, p) { const x = store.data.items.find(i => i.id === id); if (!x) return; if (typeof p.on === 'boolean') x.on = p.on; if (typeof p.name === 'string') x.name = p.name.slice(0, 60); store.save(); }
function mark(id, cid) { const x = store.data.items.find(i => i.id === id); if (x) { x.community = cid; store.save(); } }
function remove(id) { const x = store.data.items.find(i => i.id === id); if (!x) return; try { fs.rmSync(path.join(dir(), x.file), { force: true }); } catch (_) {} store.data.items = store.data.items.filter(i => i !== x); store.save(); }
function filePath(name) { if (!/^[a-z0-9]+\.(jpg|png|gif|webp|avif|mp4|webm)$/i.test(name)) return null; const f = path.join(dir(), name); return fs.existsSync(f) ? f : null; }
function read(id) { const x = store.data.items.find(i => i.id === id); return x ? { item: x, buf: fs.readFileSync(path.join(dir(), x.file)) } : null; }

/** Entries for the new-tab rotation. */
function forNewTab() { return store.data.items.filter(x => x.on !== false).map(x => ({ id: x.id, custom: true, type: x.type, url: 'kitsune://bg/' + x.file, title: x.name, status: 'mine', rating: null, banner: null, hd: null, cover: null, color: null, score: null })); }
module.exports = { mark, list, addBuffer, pick, update, remove, filePath, read, forNewTab, sniff };
