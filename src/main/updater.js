'use strict';
// Update manager: asks the Kitsune site what the newest build for THIS install is (OS + edition + CPU), downloads it with a
// SHA-256 check, then installs it the way that OS expects. State is broadcast to the update page and the toolbar badge.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app, net, shell } = require('electron');
const S = require('./state');
const DEMO = require('./demo');

const state = { status: 'idle', current: app.getVersion(), latest: null, file: null, notes: [], progress: 0, received: 0, total: 0, error: '', checked: 0, canAuto: true, how: '' };
let listeners = [], timer = null, downloaded = null;
const emit = () => { for (const f of listeners) try { f(Object.assign({}, state)); } catch (_) {} };
const set = p => { Object.assign(state, p); emit(); };
const server = () => String(S.get().updateServer || S.get().accountServer || 'https://kitsune.zeabur.app').replace(/\/+$/, '');
const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
const asImage = () => !!process.env.APPIMAGE;

// Which published file is the right one for this install?
function pick(files) {
  const edition = S.EDITION; const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  let c = files.filter(f => f.edition === edition);
  if (process.platform === 'win32') c = c.filter(f => f.os === 'windows' && f.ext === 'exe');
  else if (process.platform === 'darwin') c = c.filter(f => f.os === 'mac' && f.ext === 'dmg' && f.arch === arch);
  else { c = c.filter(f => f.os === 'linux'); const want = asImage() || edition === 'lite' ? 'appimage' : 'deb'; c = c.filter(f => f.ext.toLowerCase() === want).concat(c.filter(f => f.ext.toLowerCase() !== want)); }
  c = c.filter(f => f.version).sort((a, b) => cmp(b.version, a.version)); return c[0] || null;
}
function describe() {
  if (process.platform === 'win32') return S.LITE ? 'Replaces the portable exe and restarts Kitsune.' : 'Installs silently and restarts Kitsune.';
  if (process.platform === 'darwin') return 'Opens the disk image: drag Kitsune into Applications to finish.';
  return asImage() ? 'Replaces this AppImage and restarts Kitsune.' : 'Opens the package in your software installer.';
}
async function check(manual) {
  if (DEMO.on) return; if (state.status === 'downloading') return;
  set({ status: 'checking', error: '' });
  try {
    const res = await net.fetch(server() + '/api/releases', { headers: { accept: 'application/json' } }); if (!res.ok) throw new Error('Server answered ' + res.status);
    const d = await res.json(); const f = pick(d.files || []);
    const notes = (d.changelog && f && d.changelog[f.version]) || [];
    if (!f) return set({ status: 'uptodate', checked: Date.now(), latest: null, how: describe() });
    if (cmp(f.version, state.current) > 0) set({ status: 'available', latest: f.version, file: f, notes, checked: Date.now(), how: describe() });
    else set({ status: 'uptodate', latest: f.version, file: f, notes, checked: Date.now(), how: describe() });
  } catch (e) { set({ status: manual ? 'error' : 'idle', error: 'Couldn’t reach the update server (' + String(e.message).slice(0, 80) + ').', checked: Date.now() }); }
}
async function download() {
  const f = state.file; if (!f || state.status === 'downloading') return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-update-')); const dst = path.join(dir, path.basename(f.file));
  set({ status: 'downloading', progress: 0, received: 0, total: f.size || 0, error: '' });
  try {
    const url = f.url.startsWith('http') ? f.url : server() + f.url; const res = await net.fetch(url); if (!res.ok) throw new Error('Download failed (' + res.status + ')');
    const total = +res.headers.get('content-length') || f.size || 0; const h = crypto.createHash('sha256'); const ws = fs.createWriteStream(dst); let got = 0, last = 0;
    const reader = res.body.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; h.update(value); if (!ws.write(value)) await new Promise(r => ws.once('drain', r)); got += value.length; if (Date.now() - last > 120) { last = Date.now(); set({ received: got, total, progress: total ? got / total : 0 }); } }
    await new Promise(r => ws.end(r));
    if (f.sha256 && h.digest('hex') !== f.sha256) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error('The download didn’t match its checksum, so it was discarded.'); }
    downloaded = dst; set({ status: 'ready', progress: 1, received: got, total });
  } catch (e) { set({ status: 'error', error: String(e.message).slice(0, 160) }); }
}
function install() {
  if (!downloaded || !fs.existsSync(downloaded)) return set({ status: 'error', error: 'The downloaded file is gone. Download it again.' });
  const f = downloaded;
  const detached = (cmd, args, opts) => { const c = spawn(cmd, args, Object.assign({ detached: true, stdio: 'ignore', windowsHide: true }, opts)); c.unref(); };
  try {
    if (process.platform === 'win32') {
      const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath; const q = s => '"' + s.replace(/"/g, '') + '"';
      if (S.LITE && process.env.PORTABLE_EXECUTABLE_FILE) detached('cmd.exe', ['/c', `ping -n 4 127.0.0.1 >nul & move /y ${q(f)} ${q(exe)} >nul & start "" ${q(exe)}`], { windowsVerbatimArguments: true });
      else detached('cmd.exe', ['/c', `ping -n 3 127.0.0.1 >nul & ${q(f)} /S & ping -n 6 127.0.0.1 >nul & start "" ${q(process.execPath)}`], { windowsVerbatimArguments: true });
      setTimeout(() => app.quit(), 400);
    } else if (process.platform === 'darwin') { shell.openPath(f); set({ status: 'opened' }); }
    else if (asImage()) {
      const target = process.env.APPIMAGE; fs.chmodSync(f, 0o755);
      detached('sh', ['-c', `sleep 2; mv -f "${f}" "${target}" 2>/dev/null || cp -f "${f}" "${target}"; chmod +x "${target}"; "${target}" &`]); setTimeout(() => app.quit(), 400);
    } else { shell.openPath(f); set({ status: 'opened' }); }
  } catch (e) { set({ status: 'error', error: String(e.message).slice(0, 160) }); }
}
function init(reg) {
  if (DEMO.on) return;
  reg('update.state', () => Object.assign({}, state));
  reg('update.check', async () => { await check(true); return Object.assign({}, state); });
  reg('update.download', async () => { await download(); return Object.assign({}, state); });
  reg('update.install', () => { install(); });
  reg('update.run', async () => { if (state.status !== 'ready') await download(); if (state.status === 'ready') install(); });
  const tick = () => { if (S.get().autoUpdateCheck !== false) check(false); };
  setTimeout(tick, 12000); timer = setInterval(tick, 6 * 3600 * 1000); timer.unref && timer.unref();
}
module.exports = { init, check, onState: f => listeners.push(f), state: () => Object.assign({}, state), cmp, pick };
