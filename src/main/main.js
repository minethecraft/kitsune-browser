'use strict';
const path = require('path');
const fs = require('fs');
const { app, protocol, ipcMain, Menu, dialog, powerMonitor, session, shell } = require('electron');
const S = require('./state');

// ---- before ready -----------------------------------------------------------------------------
// look like plain Chrome (many sites block "Electron" user agents)
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|kitsune-browser|Kitsune)\/\S+/gi, '');
app.commandLine.appendSwitch('disable-features', 'MediaRouter,Translate,AutofillServerCommunication');
app.commandLine.appendSwitch('enable-features', 'SmoothScrolling');

// Lite = portable: keep the profile next to the file you launched, when that folder is writable.
if (S.LITE) {
  let base = process.env.PORTABLE_EXECUTABLE_DIR;
  if (!base && process.platform === 'darwin') { const m = process.execPath.match(/^(.*)\/[^/]+\.app\/Contents\/MacOS\//); if (m) base = m[1]; }
  if (!base && process.platform === 'win32') base = path.dirname(process.execPath);
  if (!base && process.env.APPIMAGE) base = path.dirname(process.env.APPIMAGE);
  if (base) {
    const dir = path.join(base, 'KitsuneData');
    try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); app.setPath('userData', dir); } catch (_) { /* read-only: default profile */ }
  }
}

if (process.env.KITSUNE_SMOKE && process.env.HTTPS_PROXY) { app.commandLine.appendSwitch('proxy-server', process.env.HTTPS_PROXY); app.commandLine.appendSwitch('ignore-certificate-errors'); }

protocol.registerSchemesAsPrivileged([{ scheme: 'kitsune', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) { app.quit(); return; }

const urlArgs = argv => argv.slice(1).filter(a => /^(https?:|file:)/i.test(a));
let pendingUrls = urlArgs(process.argv);

app.on('second-instance', (e, argv) => {
  const B = require('./browser'); const urls = urlArgs(argv); const w = B.focusedWin();
  if (w) { if (w.base.isMinimized()) w.base.restore(); w.base.focus(); urls.forEach(u => B.createTab(w, { url: u })); }
  else B.createWindow({ urls });
});
app.on('open-url', (e, url) => { e.preventDefault(); const B = require('./browser'); const w = B.focusedWin(); if (w) B.createTab(w, { url }); else pendingUrls.push(url); });

// ---- ready -------------------------------------------------------------------------------------
app.whenReady().then(() => {
  S.init();
  const downloads = require('./downloads'); downloads.init();
  const kiroku = require('./kiroku');
  const B = require('./browser');
  kiroku.api.onHd = () => B.broadcast('kiroku');

  // kitsune:// internal pages (default session here; every tab/private partition registers it in sessions.setup)
  protocol.handle('kitsune', require('./kproto').handler);

  // ---- IPC bridge (internal pages only) ----
  const reg = (name, fn, chromeOnly) => ipcMain.handle('k:' + name, (e, ...args) => {
    const url = e.senderFrame ? e.senderFrame.url : '';
    if (!url.startsWith(chromeOnly ? 'kitsune://ui/' : 'kitsune://')) throw new Error('untrusted sender');
    return fn(B.winOfSender(e.sender), e, ...args);
  });

  reg('state', win => ({
    settings: S.get(), features: S.FEAT, edition: S.EDITION, platform: process.platform, version: app.getVersion(),
    engines: S.SEARCH_ENGINES, runtime: S.runtime, snapshot: win ? B.snapshot(win) : null, downloads: downloads.list()
  }));
  reg('settings.set', (w, e, p) => S.patch(p || {}));
  reg('accent.set', (w, e, c) => { S.runtime.dynamicAccent = /^#[0-9a-f]{6}$/i.test(c || '') ? c : null; B.broadcast('runtime', S.runtime); });

  // chrome-only: tabs / nav / omnibox
  reg('tab.new', (w, e, url, o) => B.createTab(w, Object.assign({ url, afterId: w.activeId }, o || {})) && 0, true);
  reg('tab.activate', (w, e, id) => B.activateTab(w, id), true);
  reg('tab.close', (w, e, id) => B.closeTab(w, id), true);
  reg('tab.move', (w, e, id, before) => B.moveTab(w, id, before), true);
  reg('tab.menu', (w, e, id) => B.tabContextMenu(w, id), true);
  reg('nav', (w, e, input) => { B.navigate(w, input); }, true);
  reg('omni.suggest', (w, e, text) => B.suggest(w, text), true);
  reg('ui.expand', (w, e, h) => B.setExpand(w, h), true);
  reg('find', (w, e, text, o) => B.findText(w, text, o), true);
  // never return the command's result: it can be a tab/window object, which is not serialisable over IPC
  reg('cmd', async (w, e, name, arg) => { await B.cmd(w, name, arg); });

  // bookmarks
  const bm = () => S.bookmarks();
  reg('bm.list', () => bm().data.items);
  reg('bm.add', (w, e, o) => { bm().data.items.push({ id: 'b' + Date.now().toString(36), title: o.title || o.url, url: o.url, added: Date.now(), bar: o.bar !== false }); bm().save(); B.broadcast('bookmarks'); });
  reg('bm.update', (w, e, id, p) => { const b = bm().data.items.find(x => x.id === id); if (b) { if (typeof p.title === 'string') b.title = p.title; if (typeof p.bar === 'boolean') b.bar = p.bar; if (typeof p.url === 'string') b.url = p.url; bm().save(); B.broadcast('bookmarks'); } });
  reg('bm.remove', (w, e, id) => { bm().data.items = bm().data.items.filter(x => x.id !== id); bm().save(); B.broadcast('bookmarks'); if (w) B.emit(w); });
  reg('bm.export', async () => {
    const r = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('documents'), 'kitsune-bookmarks.html'), filters: [{ name: 'HTML', extensions: ['html'] }] });
    if (r.canceled || !r.filePath) return false;
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n' +
      bm().data.items.map(b => `    <DT><A HREF="${esc(b.url)}" ADD_DATE="${Math.floor((b.added || Date.now()) / 1000)}">${esc(b.title)}</A>`).join('\n') + '\n</DL><p>\n';
    fs.writeFileSync(r.filePath, html); return true;
  });
  reg('bm.import', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Bookmarks', extensions: ['html', 'htm'] }] });
    if (r.canceled || !r.filePaths[0]) return 0;
    const txt = fs.readFileSync(r.filePaths[0], 'utf8'); let n = 0;
    const have = new Set(bm().data.items.map(b => b.url));
    const re = /<A\s+[^>]*HREF="([^"]+)"[^>]*>([^<]*)<\/A>/gi; let m;
    while ((m = re.exec(txt))) {
      const url = m[1].replace(/&amp;/g, '&'); if (!/^https?:/i.test(url) || have.has(url)) continue;
      bm().data.items.push({ id: 'b' + Date.now().toString(36) + n, title: m[2].replace(/&amp;/g, '&') || url, url, added: Date.now(), bar: false }); have.add(url); n++;
    }
    bm().save(); B.broadcast('bookmarks'); return n;
  });

  // history
  reg('hist.list', (w, e, q, limit) => {
    q = (q || '').toLowerCase(); const out = []; const items = S.history().data.items;
    for (let i = items.length - 1; i >= 0 && out.length < (limit || 500); i--) { const h = items[i]; if (!q || h.url.toLowerCase().includes(q) || (h.title || '').toLowerCase().includes(q)) out.push(h); }
    return out.sort((a, b) => b.time - a.time);
  });
  reg('hist.remove', (w, e, url) => { S.history().data.items = S.history().data.items.filter(h => h.url !== url); S.history().save(); });
  reg('hist.clear', (w, e, range) => {
    const ms = { hour: 3600e3, day: 864e5, week: 6048e5 }[range];
    if (!ms) B.clearHistory(); else { S.history().data.items = S.history().data.items.filter(h => h.time < Date.now() - ms); S.history().flush(); }
  });
  reg('data.clear', async (w, e, o) => {
    o = o || {};
    const parts = ['persist:main'].concat(S.get().containers.filter(c => c.id !== 'default').map(c => 'persist:c-' + c.id));
    for (const p of parts) {
      const ses = session.fromPartition(p);
      if (o.cookies) await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'websql'] });
      if (o.cache) await ses.clearCache();
    }
    if (o.history) B.clearHistory();
    if (o.downloads) { downloads.clear(); B.broadcastDownloads(); }
    if (o.permissions) S.patch({ sitePerms: {} });
    return true;
  });

  // downloads
  reg('dl.list', () => downloads.list());
  reg('dl.open', (w, e, id) => downloads.open(id));
  reg('dl.show', (w, e, id) => downloads.show(id));
  reg('dl.cancel', (w, e, id) => downloads.cancel(id));
  reg('dl.pause', (w, e, id) => downloads.pause(id));
  reg('dl.remove', (w, e, id) => { downloads.remove(id); B.broadcastDownloads(); });
  reg('dl.clear', () => { downloads.clear(); B.broadcastDownloads(); });
  reg('dl.chooseDir', async () => { const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }); if (!r.canceled && r.filePaths[0]) S.patch({ downloadDir: r.filePaths[0] }); return S.get().downloadDir; });

  // kiroku / anime
  if (S.FEAT.assistant) require('./nimbus').init(reg);
  reg('kiroku.bg', () => kiroku.backgrounds(S.get()));
  reg('kiroku.hub', () => kiroku.hub(S.get()));
  reg('kiroku.import', (w, e, text) => { const n = kiroku.importLibrary(JSON.parse(text)); B.broadcast('kiroku'); return n; });
  reg('kiroku.reset', () => { kiroku.resetLibrary(); B.broadcast('kiroku'); });

  // app / extensions / misc
  reg('app.info', () => ({
    version: app.getVersion(), edition: S.EDITION, electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node,
    platform: process.platform + ' ' + process.arch, userData: app.getPath('userData'), stats: B.stats(), blocklist: require('./adblock').count, isDefault: app.isDefaultProtocolClient('https')
  }));
  reg('app.setDefault', () => { app.setAsDefaultProtocolClient('http'); app.setAsDefaultProtocolClient('https'); return app.isDefaultProtocolClient('https'); });
  reg('app.openDataDir', () => shell.openPath(app.getPath('userData')));
  reg('ext.load', async () => {
    if (!S.FEAT.extensions) return { error: 'Extensions are available in the Full edition.' };
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'], message: 'Choose an unpacked Chrome extension folder' });
    if (r.canceled || !r.filePaths[0]) return null;
    try {
      const ext = await session.fromPartition('persist:main').extensions.loadExtension(r.filePaths[0], { allowFileAccess: true });
      const list = S.get().extensions.filter(x => x.path !== r.filePaths[0]).concat([{ name: ext.name, path: r.filePaths[0] }]); S.patch({ extensions: list });
      return { ok: ext.name };
    } catch (err) { return { error: err.message }; }
  });
  reg('ext.remove', (w, e, p) => { S.patch({ extensions: S.get().extensions.filter(x => x.path !== p) }); });

  // ---- reactions to settings ----
  S.bus.on('settings', s => { B.broadcast('settings', s); B.applyThemeChrome(); B.relayoutAll(); });

  // reload saved extensions (Full)
  if (S.FEAT.extensions) {
    const ses = session.fromPartition('persist:main');
    for (const x of S.get().extensions) ses.extensions.loadExtension(x.path, { allowFileAccess: true }).catch(() => {});
  }

  // menu: macOS needs an Edit menu for clipboard shortcuts in the omnibox; elsewhere no menu bar.
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]) : null);
  B.applyThemeChrome();

  // power: auto-lighten animations on battery
  try {
    S.runtime.onBattery = powerMonitor.isOnBatteryPower();
    powerMonitor.on('on-battery', () => { S.runtime.onBattery = true; B.broadcast('runtime', S.runtime); });
    powerMonitor.on('on-ac', () => { S.runtime.onBattery = false; B.broadcast('runtime', S.runtime); });
  } catch (_) {}

  B.startSleeper();

  const st = S.session().data;
  const restore = !pendingUrls.length && S.get().restoreSession && st.tabs && st.tabs.length ? st : null;
  B.createWindow({ urls: pendingUrls, restore });
  pendingUrls = [];
  if (process.env.KITSUNE_SMOKE_AI) require('./smoke-ai')().catch(e => { console.error('smoke-ai failed', e); app.exit(1); });
  if (process.env.KITSUNE_SMOKE) require('./smoke')().catch(e => { console.error('smoke failed', e); app.quit(); });

  app.on('activate', () => { if (!B.wins.size) B.createWindow({}); });
});

app.on('before-quit', () => {
  try { require('./browser').saveSession(); require('./storage').flushAll(); } catch (_) {}
});
