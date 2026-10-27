'use strict';
// Custom interaction sounds (WAV / MP3 / OGG, 1.5 MB max each), served as kitsune://snd/<file>.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, dialog } = require('electron');
const S = require('./state');
const dir = () => { const d = path.join(app.getPath('userData'), 'sounds'); fs.mkdirSync(d, { recursive: true }); return d; };
const EVENTS = ['click', 'hover', 'tabOpen', 'tabClose', 'newTab', 'success', 'error', 'toggle'];
function sniff(b) {
  if (b.length < 12) return null;
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WAVE') return '.wav';
  if (b.slice(0, 3).toString() === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return '.mp3';
  if (b.slice(0, 4).toString() === 'OggS') return '.ogg';
  return null;
}
async function pick(event) {
  if (!EVENTS.includes(event)) return { error: 'Unknown sound slot' };
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Sounds', extensions: ['wav', 'mp3', 'ogg'] }] }); if (r.canceled) return null;
  const buf = fs.readFileSync(r.filePaths[0]); if (buf.length > 1.5 * 1048576) return { error: 'That sound is bigger than 1.5 MB.' };
  const ext = sniff(buf); if (!ext) return { error: 'Use a WAV, MP3 or OGG file.' };
  const file = event + '-' + crypto.randomBytes(4).toString('hex') + ext; fs.writeFileSync(path.join(dir(), file), buf);
  const sfx = Object.assign({}, S.get().sfx); sfx.custom = Object.assign({}, sfx.custom, { [event]: file }); S.patch({ sfx }); return { ok: file };
}
function clear(event) { const sfx = Object.assign({}, S.get().sfx); const c = Object.assign({}, sfx.custom); const f = c[event]; delete c[event]; sfx.custom = c; if (f) try { fs.rmSync(path.join(dir(), path.basename(f)), { force: true }); } catch (_) {} S.patch({ sfx }); }
const filePath = name => /^[a-zA-Z]+-[0-9a-f]{8}\.(wav|mp3|ogg)$/.test(name) && fs.existsSync(path.join(dir(), name)) ? path.join(dir(), name) : null;
module.exports = { pick, clear, filePath, EVENTS };
