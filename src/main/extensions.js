'use strict';
// Extensions: install straight from the Chrome Web Store (by link or ID), load unpacked folders, enable/disable/remove.
// Electron implements a subset of the Chrome extension APIs (content scripts, storage, webRequest, etc.).
const fs = require('fs');
const path = require('path');
const { app, net, session, dialog } = require('electron');
const { unzipSync } = require('fflate');
const S = require('./state');

const sessions = new Set();
const dirOf = id => path.join(app.getPath('userData'), 'extensions', id);
const list = () => S.get().extensions || [];
const save = l => S.patch({ extensions: l });

async function loadInto(ses, e) { try { return await ses.extensions.loadExtension(e.path, { allowFileAccess: true }); } catch (err) { return null; } }
async function attach(ses) {
  if (!S.FEAT.extensions) return; sessions.add(ses);
  for (const e of list()) if (e.enabled !== false) await loadInto(ses, e);
}
function parseCrx(buf) {
  if (buf.slice(0, 4).toString() !== 'Cr24') throw new Error('Not a CRX file');
  const v = buf.readUInt32LE(4);
  if (v === 2) return buf.slice(16 + buf.readUInt32LE(8) + buf.readUInt32LE(12));
  if (v === 3) return buf.slice(12 + buf.readUInt32LE(8));
  throw new Error('Unsupported CRX version');
}
function extractTo(zipBuf, dir) {
  const files = unzipSync(new Uint8Array(zipBuf));
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) continue;
    const dst = path.normalize(path.join(dir, name)); if (!dst.startsWith(dir + path.sep)) continue; // zip-slip guard
    fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, Buffer.from(data));
  }
}
const idFrom = s => { const m = String(s || '').match(/[a-p]{32}/); return m ? m[0] : null; };

async function installFromStore(input) {
  if (!S.FEAT.extensions) return { error: 'Extensions are part of the Full edition.' };
  const id = idFrom(input); if (!id) return { error: 'Paste a Chrome Web Store link or a 32-letter extension ID.' };
  const url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${process.versions.chrome}&acceptformat=crx2,crx3&x=${encodeURIComponent('id=' + id + '&uc')}`;
  let res; try { res = await net.fetch(url); } catch (_) { return { error: 'Could not reach the Chrome Web Store.' }; }
  if (!res.ok || res.status === 204) return { error: 'The Web Store has no download for that ID.' };
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = dirOf(id);
  try { extractTo(parseCrx(buf), dir); } catch (e) { return { error: 'Could not unpack the extension: ' + e.message }; }
  return add(dir, id);
}
async function add(dir, idHint) {
  let manifest; try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^﻿/, '')); } catch (_) { return { error: 'No manifest.json found in that folder.' }; }
  const results = [];
  for (const ses of sessions.size ? sessions : [session.fromPartition('persist:main')]) results.push(await loadInto(ses, { path: dir }));
  const ext = results.find(Boolean); if (!ext) return { error: 'This extension could not be loaded (it may need unsupported APIs).' };
  const entry = { id: ext.id, storeId: idHint || null, name: ext.name || manifest.name, version: ext.version, path: dir, enabled: true, options: (manifest.options_ui && manifest.options_ui.page) || manifest.options_page || null, mv: manifest.manifest_version };
  save(list().filter(x => x.path !== dir).concat([entry]));
  return { ok: entry.name, mv3: manifest.manifest_version === 3 };
}
async function loadUnpacked() {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'], message: 'Choose an unpacked extension folder' });
  if (r.canceled || !r.filePaths[0]) return null; return add(r.filePaths[0]);
}
async function setEnabled(id, on) {
  const e = list().find(x => x.id === id); if (!e) return;
  for (const ses of sessions) { try { if (on) await loadInto(ses, e); else await ses.extensions.removeExtension(id); } catch (_) {} }
  save(list().map(x => x.id === id ? Object.assign({}, x, { enabled: on }) : x));
}
async function remove(id) {
  const e = list().find(x => x.id === id); if (!e) return;
  for (const ses of sessions) { try { await ses.extensions.removeExtension(id); } catch (_) {} }
  if (e.path.startsWith(path.join(app.getPath('userData'), 'extensions'))) fs.rmSync(e.path, { recursive: true, force: true });
  save(list().filter(x => x.id !== id));
}
function optionsUrl(id) { const e = list().find(x => x.id === id); return e && e.options ? `chrome-extension://${id}/${e.options.replace(/^\//, '')}` : null; }
async function ensureIds(remote) { for (const e of remote || []) if (e.id && !list().some(x => x.storeId === e.id || x.id === e.id)) await installFromStore(e.id).catch(() => {}); }
module.exports = { attach, installFromStore, loadUnpacked, setEnabled, remove, optionsUrl, ensureIds };
