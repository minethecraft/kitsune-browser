'use strict';
// Custom themes: Kitsune theme JSON, plus Firefox / Chrome theme packages (manifest.json "theme" colours).
const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');
const { unzipSync } = require('fflate');
const S = require('./state');

const NAMED = { black: '#000000', white: '#ffffff', red: '#ff0000', blue: '#0000ff', green: '#008000', gray: '#808080', grey: '#808080', pink: '#ffc0cb', purple: '#800080', orange: '#ffa500', yellow: '#ffff00' };
function toHex(c) {
  if (c == null) return null;
  if (Array.isArray(c)) return '#' + c.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  c = String(c).trim().toLowerCase(); if (NAMED[c]) return NAMED[c];
  let m = c.match(/^#([0-9a-f]{3})$/); if (m) return '#' + m[1].split('').map(x => x + x).join('');
  m = c.match(/^#([0-9a-f]{6})/); if (m) return '#' + m[1];
  m = c.match(/^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/); if (m) return toHex([+m[1], +m[2], +m[3]]);
  return null;
}
const lum = h => { const n = parseInt(h.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
const mix = (a, b, t) => { const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16); const ch = s => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t); return '#' + [16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join(''); };

function fromManifest(m) {
  const c = (m.theme && m.theme.colors) || {}; const g = (...k) => { for (const x of k) { const v = toHex(c[x]); if (v) return v; } return null; };
  const bg = g('frame', 'ntp_background', 'toolbar') || '#2b1830'; const bg2 = g('toolbar', 'popup', 'frame') || mix(bg, '#ffffff', .06);
  const dark = lum(bg) < .5; const fg = g('tab_background_text', 'toolbar_text', 'tab_text', 'bookmark_text', 'popup_text') || (dark ? '#f3e9f7' : '#2a1633');
  const accent = g('tab_line', 'button_background_active', 'toolbar_field_focus', 'icons_attention', 'tab_selected', 'button_background') || '#ff8fb8';
  return { name: m.name || 'Imported theme', bg, bg2, bg3: mix(bg2, dark ? '#ffffff' : '#000000', .08), fg, muted: mix(fg, bg, .4), accent, accent2: accent };
}
const clean = t => {
  const hx = v => (toHex(v) || null);
  const out = { id: t.id || ('t' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)), name: String(t.name || 'My theme').slice(0, 40), bg: hx(t.bg) || '#2b1830', bg2: hx(t.bg2) || hx(t.bg) || '#38213f', bg3: hx(t.bg3) || hx(t.bg2) || '#47294f', fg: hx(t.fg) || '#ffe9f3', muted: hx(t.muted) || hx(t.fg) || '#cba8bd', accent: hx(t.accent) || '#ff8fb8', accent2: hx(t.accent2) || hx(t.accent) || '#ffc86b' };
  if (t.particles && ['sakura', 'ember', 'snow', 'rain', 'firefly', 'none'].includes(t.particles)) out.particles = t.particles;
  if (t.lockAccent) out.lockAccent = true;
  const num = (v, a, b, d) => Number.isFinite(+v) ? Math.max(a, Math.min(b, +v)) : d;
  if (t.ui && typeof t.ui === 'object') out.ui = { radius: num(t.ui.radius, 0, 28, 12), blur: num(t.ui.blur, 0, 30, 10), density: ['compact', 'normal', 'roomy'].includes(t.ui.density) ? t.ui.density : 'normal', font: ['system', 'rounded', 'serif', 'mono'].includes(t.ui.font) ? t.ui.font : 'system', tabs: ['round', 'square', 'pill'].includes(t.ui.tabs) ? t.ui.tabs : 'round' };
  if (t.wall && typeof t.wall === 'object' && ['image', 'video'].includes(t.wall.type) && typeof t.wall.url === 'string' && /^(https:\/\/|kitsune:\/\/bg\/[a-z0-9]+\.[a-z0-9]+$)/i.test(t.wall.url) && t.wall.url.length < 600) out.wall = { type: t.wall.type, url: t.wall.url, dim: num(t.wall.dim, 0, 80, 20) };
  if (t.sfx && typeof t.sfx === 'object') out.sfx = { pack: ['off', 'soft', 'chime', 'arcade', 'drop', 'katana', 'retro'].includes(t.sfx.pack) ? t.sfx.pack : 'off', volume: num(t.sfx.volume, 0, 1, 0.5), hover: !!t.sfx.hover };
  if (typeof t.image === 'string' && /^(https:\/\/|data:image\/)/.test(t.image) && t.image.length < 2e6) out.image = t.image;
  return out;
};
function parse(buf, name) {
  let obj;
  if (buf[0] === 0x50 && buf[1] === 0x4b) { // zip / xpi / crx-without-header
    const files = unzipSync(new Uint8Array(buf)); const mf = files['manifest.json']; if (!mf) throw new Error('No manifest.json in that package.');
    obj = JSON.parse(Buffer.from(mf).toString('utf8').replace(/^﻿/, ''));
  } else obj = JSON.parse(buf.toString('utf8').replace(/^﻿/, ''));
  if (obj.theme && obj.theme.colors) return clean(fromManifest(obj));
  if (obj.kitsuneTheme || (obj.bg && obj.fg && obj.accent)) return clean(obj.kitsuneTheme || obj);
  throw new Error('That file isn’t a Kitsune, Firefox or Chrome theme.');
}
async function importFile() {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Themes', extensions: ['json', 'xpi', 'zip', 'crx'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  try { let buf = fs.readFileSync(r.filePaths[0]); if (buf.slice(0, 4).toString() === 'Cr24') buf = buf.slice(12 + buf.readUInt32LE(8)); const t = parse(buf, path.basename(r.filePaths[0])); return add(t); } catch (e) { return { error: e.message }; }
}
function add(t) { t = clean(t); const list = (S.get().customThemes || []).filter(x => x.id !== t.id).concat([t]); S.patch({ customThemes: list }); return { ok: t.name, id: t.id }; }
async function exportTheme(id) {
  const t = (S.get().customThemes || []).find(x => x.id === id); if (!t) return null;
  const r = await dialog.showSaveDialog({ defaultPath: t.name.replace(/[^\w -]/g, '') + '.kitsune-theme.json', filters: [{ name: 'Kitsune theme', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return null; fs.writeFileSync(r.filePath, JSON.stringify({ kitsuneTheme: t }, null, 2)); return { ok: r.filePath };
}
function remove(id) { const s = S.get(); S.patch({ customThemes: (s.customThemes || []).filter(x => x.id !== id) }); if (s.theme === 'custom:' + id) S.patch({ theme: 'sakura' }); }
module.exports = { importFile, add, exportTheme, remove, clean };
