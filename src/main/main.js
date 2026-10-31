'use strict';
const path = require('path');
const fs = require('fs');
const { app, protocol, ipcMain, Menu, dialog, powerMonitor, session, shell } = require('electron');
const S = require('./state');

// ---- before ready -----------------------------------------------------------------------------
// look like plain Chrome (many sites block "Electron" user agents)
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|kitsune-browser|Kitsune)\/\S+/gi, '');
app.commandLine.appendSwitch('disable-features', 'MediaRouter,Translate,AutofillServerCommunication');
app.commandLine.appendSwitch('enable-features', 'SmoothScrolling,PlatformHEVCDecoderSupport,VaapiVideoDecoder');
// Video: proprietary codecs (H.264/AAC/MP3) ship in Electron's ffmpeg; let videos autoplay muted like Chrome does.
app.commandLine.appendSwitch('autoplay-policy', 'document-user-activation-required');
const DEMO = require('./demo');
if (DEMO.on) { app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu-compositing'); app.commandLine.appendSwitch('disable-dev-shm-usage'); }

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

if (process.env.KITSUNE_SMOKE_V13) app.commandLine.appendSwitch('host-resolver-rules', 'MAP *.crunchyroll.com 127.0.0.1');
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
app.whenReady().then(async () => {
  // Widevine DRM (Netflix, Disney+, Spotify...) only exists in the castlabs Electron build; plain Electron has no `components`.
  try { const { components } = require('electron'); if (components && components.whenReady) { await Promise.race([components.whenReady(), new Promise(r => setTimeout(r, 20000))]); S.runtime.widevine = true; } } catch (_) {}
  S.init(); if (DEMO.on) S.patch({ setupDone: true, nimbusServer: '', restoreSession: false });
  require('./blocker').load(S.get().blocker).catch(() => {});
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
  reg('tab.menu', (w, e, id, x, y) => B.tabContextMenu(w, id, x, y), true);
  reg('tab.newAt', (w, e, url, beforeId) => { if (/^(https?|file):/i.test(String(url))) B.createTab(w, { url, beforeId: beforeId || undefined }); return 0; }, true);
  reg('ctx.run', (w, e, id) => { B.runMenu(w, String(id)); }, true);
  reg('ctx.close', (w) => { w.ctx = null; }, true);
  reg('win.min', w => { w.base.minimize(); }, true);
  reg('win.max', w => { w.base.isMaximized() ? w.base.unmaximize() : w.base.maximize(); }, true);
  reg('win.close', w => { w.base.close(); }, true);
  reg('clip.read', () => require('electron').clipboard.readText().slice(0, 4000), true);
  reg('clip.write', (w, e, t) => { require('electron').clipboard.writeText(String(t || '').slice(0, 4000)); }, true);
  reg('site.info', w => B.siteInfo(w), true);
  reg('site.setPerm', (w, e, origin, key, val) => { B.setSitePerm(String(origin), String(key), String(val)); }, true);
  reg('site.clear', w => B.clearSite(w), true);
  reg('nav', (w, e, input) => { B.navigate(w, input); }, true);
  reg('omni.suggest', (w, e, text) => B.suggest(w, text), true);
  reg('ui.sideOpen', (w, e, on) => B.setSideOpen(w, on), true);
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
  reg('dl.drag', (w, e, id) => downloads.drag(id, e.sender), true);
  reg('dl.cancel', (w, e, id) => downloads.cancel(id));
  reg('dl.pause', (w, e, id) => downloads.pause(id));
  reg('dl.remove', (w, e, id) => { downloads.remove(id); B.broadcastDownloads(); });
  reg('dl.clear', () => { downloads.clear(); B.broadcastDownloads(); });
  reg('dl.chooseDir', async () => { const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }); if (!r.canceled && r.filePaths[0]) S.patch({ downloadDir: r.filePaths[0] }); return S.get().downloadDir; });

  // kiroku / anime
  if (S.FEAT.assistant) require('./nimbus').init(reg);
  reg('blocker.info', () => require('./blocker').info());
  const BG = require('./backgrounds'), SND = require('./sounds');
  reg('kiroku.bg', async () => {
    const s = S.get(); const th = String(s.theme).startsWith('custom:') && (s.customThemes || []).find(t => 'custom:' + t.id === s.theme);
    if (th && th.wall) return [{ id: 'theme', custom: true, type: th.wall.type, url: th.wall.url, title: th.name, status: 'theme', dim: th.wall.dim }];
    const mine = BG.forNewTab(); if (s.bgMode === 'mine' && mine.length) return mine;
    const anime = s.bgMode === 'mine' ? [] : await kiroku.backgrounds(s);
    if (!mine.length) return anime; const out = []; const max = Math.max(anime.length, mine.length);
    for (let i = 0; i < max; i++) { if (anime[i]) out.push(anime[i]); if (mine[i % mine.length] && i < Math.max(mine.length, Math.ceil(anime.length / 2))) out.push(mine[i % mine.length]); }
    return out;
  });
  reg('bg.browse', (w, e, q, page, sort) => kiroku.browse(String(q || '').slice(0, 80), page | 0 || 1, sort));
  reg('bg.picks', () => ({ picks: S.get().bgPicks, hidden: S.get().bgHidden, base: kiroku.library(Object.assign({}, S.get(), { bgPicks: [], bgHidden: [] })).items.map(i => i.id) }));
  reg('bg.togglePick', (w, e, a) => { const s = S.get(); const has = s.bgPicks.some(p => p.id === a.id); const inBundled = kiroku.library(Object.assign({}, s, { bgPicks: [], bgHidden: [] })).items.some(i => i.id === a.id);
    if (inBundled) { const hid = new Set(s.bgHidden); hid.has(a.id) ? hid.delete(a.id) : hid.add(a.id); S.patch({ bgHidden: [...hid] }); }
    else S.patch({ bgPicks: has ? s.bgPicks.filter(p => p.id !== a.id) : s.bgPicks.concat([{ id: a.id | 0, t: String(a.title || '').slice(0, 80) }]).slice(-300) });
    B.broadcast('kiroku'); return { on: !has }; });
  const CM = require('./community');
  reg('cm.list', (w, e, o) => CM.list(o || {}));
  reg('cm.mine', () => CM.mine());
  reg('cm.info', () => ({ signedIn: CM.signedIn(), server: CM.base(), email: S.get().accountEmail, bgs: BG.list().map(b => ({ id: b.id, name: b.name, type: b.type, file: b.file, community: b.community || null })), themes: (S.get().customThemes || []).map(t => ({ id: t.id, name: t.name })) }));
  reg('cm.like', (w, e, id) => CM.like(String(id)));
  reg('cm.report', (w, e, id) => CM.report(String(id)));
  reg('cm.delete', (w, e, id) => CM.del(String(id)));
  reg('cm.publishBg', async (w, e, id, m) => { const r = await CM.publishBackground(String(id), m || {}); B.broadcast('kiroku'); return r; });
  reg('cm.publishTheme', (w, e, id, m) => CM.publishTheme(String(id), m || {}));
  reg('cm.install', async (w, e, id) => { const r = await CM.install(String(id)); B.broadcast('kiroku'); return r; });
  reg('bg.mine', () => BG.list());
  reg('bg.add', async () => { const r = await BG.pick(); B.broadcast('kiroku'); return r; });
  reg('bg.update', (w, e, id, p) => { BG.update(id, p || {}); B.broadcast('kiroku'); });
  reg('bg.remove', (w, e, id) => { BG.remove(id); B.broadcast('kiroku'); });
  reg('sfx.pick', (w, e, ev) => SND.pick(ev)); reg('sfx.clear', (w, e, ev) => SND.clear(ev));
  const UP = require('./updater'); UP.onState(st => B.broadcast('update', st)); UP.init(reg);
  // ---- live Kiroku (read API + built-in watch tracker)
  const KN = require('./kiroku-net');
  if (!DEMO.on) {
    KN.init();
    let syncT = 0; const syncLive = async () => {
      if (!KN.connected()) { kiroku.setLive(null); return; }
      try {
        const [lib, w] = await Promise.all([KN.library(), KN.watching().catch(() => [])]); const watchingIds = new Set(w.map(x => x.anilistId).filter(Boolean));
        kiroku.setLive(lib.filter(i => i.anilistId).map(i => ({ id: +i.anilistId, t: i.title, s: watchingIds.has(i.anilistId) ? 'watching' : (i.status === 'watched' ? 'watched' : i.status === 'towatch' ? 'towatch' : 'watched'), r: i.rating || undefined, u: i.aniwatch || undefined, p: i.progress && i.progress.pct != null ? i.progress : undefined })));
        B.broadcast('kiroku');
      } catch (_) {}
    };
    KN.onChange(() => { B.broadcast('kirokuLive', KN.status()); clearTimeout(syncT); syncT = setTimeout(syncLive, 1500); });
    setInterval(() => { if (KN.connected()) { syncLive(); } }, 5 * 60 * 1000).unref(); if (KN.connected()) setTimeout(syncLive, 4000);
    reg('kn.status', () => KN.status());
    reg('kn.connect', (w, e, o) => KN.connect(o || {}));
    reg('kn.auto', () => KN.autoConnect());
    reg('kn.disconnect', () => { KN.disconnect(); kiroku.setLive(null); B.broadcast('kiroku'); });
    reg('kn.watching', () => KN.connected() ? KN.watching() : []);
    reg('kn.history', () => KN.connected() ? KN.history() : []);
    reg('kn.stats', () => KN.connected() ? KN.stats() : null);
    reg('kn.refresh', async () => { await KN.library(true).catch(() => {}); await syncLive(); return KN.status(); });
    reg('kn.open', (w, e, kind) => { const base = KN.status().server; B.createTab(w, { url: base + (kind === 'providers' ? '/#providers' : '') }); });
  }
  reg('kiroku.hub', () => kiroku.hub(S.get()));
  reg('kiroku.import', (w, e, text) => { const n = kiroku.importLibrary(JSON.parse(text)); B.broadcast('kiroku'); return n; });
  reg('kiroku.reset', () => { kiroku.resetLibrary(); B.broadcast('kiroku'); });

  // app / extensions / misc
  reg('app.info', () => ({
    version: app.getVersion(), edition: S.EDITION, chromium: process.versions.chrome, node: process.versions.node,
    platform: process.platform + ' ' + process.arch, userData: app.getPath('userData'), stats: B.stats(), blocklist: require('./adblock').count, isDefault: app.isDefaultProtocolClient('https')
  }));
  reg('app.setDefault', () => { app.setAsDefaultProtocolClient('http'); app.setAsDefaultProtocolClient('https'); return app.isDefaultProtocolClient('https'); });
  reg('app.openDataDir', () => shell.openPath(app.getPath('userData')));
  const X = require('./extensions'), V = require('./vpn'), TH = require('./themes'), SY = require('./sync'), IM = require('./importer');
  reg('ext.list', () => S.get().extensions);
  reg('ext.install', (w, e, input) => X.installFromStore(input));
  reg('ext.load', () => X.loadUnpacked());
  reg('ext.enable', (w, e, id, on) => X.setEnabled(id, !!on));
  reg('ext.remove', (w, e, id) => X.remove(id));
  reg('ext.options', (w, e, id) => { const u = X.optionsUrl(id); if (u && w) B.createTab(w, { url: u }); return !!u; });
  reg('theme.import', () => TH.importFile());
  reg('theme.save', (w, e, t) => TH.add(t));
  reg('theme.export', (w, e, id) => TH.exportTheme(id));
  reg('theme.remove', (w, e, id) => TH.remove(id));
  reg('vpn.save', (w, e, p) => {
    p = p || {}; const id = p.id || 'v' + Date.now().toString(36); if (id === V.FREE) return { error: 'The built-in Kitsune Free VPN can’t be edited.' };
    const prof = { id, name: String(p.name || p.host || 'My VPN').slice(0, 40), scheme: ['http', 'https', 'socks5'].includes(p.scheme) ? p.scheme : 'http', host: String(p.host || '').trim(), port: Math.max(1, Math.min(65535, +p.port || 8080)), user: String(p.user || '') };
    if (!prof.host) return { error: 'Enter a server address.' };
    if (typeof p.password === 'string' && p.password) V.setPassword(id, p.password);
    S.patch({ vpnProfiles: S.get().vpnProfiles.filter(x => x.id !== id).concat([prof]) }); return { ok: id };
  });
  reg('vpn.remove', (w, e, id) => { if (id === V.FREE) return { error: 'Kitsune Free VPN is built in and can’t be removed. You can switch the VPN off instead.' }; V.setPassword(id, ''); S.patch({ vpnProfiles: S.get().vpnProfiles.filter(x => x.id !== id), vpnActive: S.get().vpnActive === id ? '' : S.get().vpnActive, vpnOn: S.get().vpnActive === id ? false : S.get().vpnOn }); });
  reg('vpn.free', () => V.freeStatus());
  reg('vpn.check', (w, e, id) => { const p = S.get().vpnProfiles.find(x => x.id === id); return p ? V.check(p) : { error: 'No such profile' }; });
  reg('vpn.toggle', (w, e, on) => { const s = S.get(); if (on && !s.vpnProfiles.some(p => p.id === s.vpnActive)) return { error: 'Add and select a VPN server first.' }; S.patch({ vpnOn: !!on }); return { ok: true }; });
  reg('import.detect', () => IM.detect());
  reg('import.run', (w, e, o) => IM.run(o || {}).then(r => { B.broadcast('bookmarks'); return r; }));
  reg('setup.done', () => { S.patch({ setupDone: true }); });
  reg('acct.status', () => SY.status());
  reg('acct.auth', (w, e, mode, email, pw, server) => { if (server) S.patch({ accountServer: String(server).replace(/\/+$/, '') }); return SY.auth(mode, email, pw); });
  reg('acct.signOut', () => SY.signOut());
  reg('acct.delete', (w, e, pw) => SY.deleteAccount(pw));
  reg('acct.sync', () => SY.syncNow());
  SY.onStatus(st => B.broadcast('account', st)); SY.init();
  V.init(); if (!DEMO.on) V.startFree();

  if (DEMO.on) for (const n of ['import.run', 'acct.auth', 'vpn.save', 'ext.load', 'ext.install', 'theme.import', 'dl.chooseDir', 'app.openDataDir', 'bm.import', 'bm.export']) ipcMain.removeHandler('k:' + n);

  // ---- password vault (kitsune://passwords) + page autofill channel (kpw:*) ----
  if (!DEMO.on) {
    const V = require('./vault'); V.init(); V.onStatus(st => B.broadcast('vault', st));
    const regV = (name, fn) => ipcMain.handle('k:vault.' + name, (e, ...a) => { const u = e.senderFrame ? e.senderFrame.url : ''; if (!u.startsWith('kitsune://passwords/')) throw new Error('untrusted sender'); return fn(e, ...a); });
    regV('status', () => V.status());
    regV('create', (e, pw) => V.create(pw)); regV('unlock', (e, pw) => V.unlock(pw)); regV('lock', () => V.lock());
    regV('changeMaster', (e, a, b) => V.changeMaster(a, b));
    regV('list', () => V.list()); regV('get', (e, id) => V.get(id)); regV('save', (e, o) => V.save(o || {})); regV('remove', (e, id) => V.remove(id));
    regV('totps', () => V.totps()); regV('generate', (e, o) => V.generate(o)); regV('strength', (e, pw) => V.strength(pw));
    regV('copy', (e, id, f) => V.copy(id, f)); regV('importCsv', (e, text) => V.importCsv(text)); regV('exportCsv', (e, pw) => V.exportCsv(pw));
    regV('parseTotp', (e, s) => { try { const t = V.parseTotp(s); return t ? { ok: true, issuer: t.issuer || '' } : { ok: false }; } catch (err) { return { ok: false, error: err.message }; } });
    const pageUrl = e => { const f = e.senderFrame; if (!f || !/^https?:/.test(f.url)) throw new Error('bad frame'); const main = e.sender.mainFrame; if (f !== main) { try { if (new URL(f.url).origin !== new URL(main.url).origin) throw new Error('cross-origin frame'); } catch (_) { throw new Error('bad frame'); } } return f.url; };
    ipcMain.handle('kpw:state', e => { pageUrl(e); const s = V.status(); return { exists: s.exists, locked: !s.unlocked }; });
    ipcMain.handle('kpw:list', e => V.status().unlocked ? V.pageList(pageUrl(e)) : []);
    ipcMain.handle('kpw:fill', (e, id, what) => V.pageFill(pageUrl(e), String(id), what === 'code' ? 'code' : 'login'));
    ipcMain.handle('kpw:generate', e => { pageUrl(e); return V.generate({ length: 20 }); });
    ipcMain.on('kpw:capture', (e, o) => { try { const u = pageUrl(e); if (!e.sender.session.isPersistent() || !o) return; V.capture(e.sender.id, u, String(o.user || '').slice(0, 200), String(o.pass || '')); } catch (_) {} });
    ipcMain.handle('kpw:pending', e => { pageUrl(e); return e.senderFrame === e.sender.mainFrame ? V.pendingFor(e.sender.id) : null; });
    ipcMain.handle('kpw:pendingSave', e => { pageUrl(e); return V.pendingSave(e.sender.id) && true; });
    ipcMain.handle('kpw:pendingDrop', (e, never) => { pageUrl(e); V.pendingDrop(e.sender.id, !!never); });
    ipcMain.handle('kpw:unlockPage', e => { pageUrl(e); const w = B.winOfSender(e.sender); if (w) B.cmd(w, 'openPage', 'passwords'); });
  }

  // ---- reactions to settings ----
  S.bus.on('settings', s => { require('./blocker').load(s.blocker).catch(() => {}); B.broadcast('settings', s); B.applyThemeChrome(); B.relayoutAll(); });


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
  require('./telemetry').start();

  const st = S.session().data;
  const restore = !pendingUrls.length && S.get().restoreSession && st.tabs && st.tabs.length ? st : null;
  if (!S.get().setupDone && !process.env.KITSUNE_SMOKE && !process.env.KITSUNE_SMOKE_AI && !restore && !process.env.KITSUNE_SMOKE_NEW && !process.env.KITSUNE_SMOKE_V11 && !process.env.KITSUNE_SMOKE_V12 && !process.env.KITSUNE_SMOKE_V13 && !process.env.KITSUNE_SMOKE_V14) pendingUrls = ['kitsune://setup/'].concat(pendingUrls);
  B.createWindow({ urls: pendingUrls, restore });
  pendingUrls = [];
  if (process.env.KITSUNE_SMOKE_NEW) require('./smoke-new')().catch(e => { console.error('smoke-new failed', e); app.exit(1); });
  if (process.env.KITSUNE_SMOKE_V11) require('./smoke-v11')().catch(e => { console.error('smoke-v11 failed', e); app.exit(1); });
  if (process.env.KITSUNE_SMOKE_V12) require('./smoke-v12')().catch(e => { console.error('smoke-v12 failed', e); app.exit(1); });
  if (process.env.KITSUNE_SMOKE_V14) require('./smoke-v14')().catch(e => { console.error('smoke-v14 failed', e); app.exit(1); });
  if (process.env.KITSUNE_SMOKE_V13) require('./smoke-v13')().catch(e => { console.error('smoke-v13 failed', e); app.exit(1); });
  if (process.env.KITSUNE_SMOKE_AI) require('./smoke-ai')().catch(e => { console.error('smoke-ai failed', e); app.exit(1); });
  if (process.env.KITSUNE_SMOKE) require('./smoke')().catch(e => { console.error('smoke failed', e); app.quit(); });

  app.on('activate', () => { if (!B.wins.size) B.createWindow({}); });
});

let quitting = false;
app.on('before-quit', e => {
  try { require('./browser').saveSession(); require('./storage').flushAll(); } catch (_) {}
  if (quitting) return;
  quitting = true;
  // let the anonymous "closed" ping out (at most ~1s), then really quit
  e.preventDefault();
  Promise.resolve().then(() => require('./telemetry').stop()).catch(() => {}).then(() => app.quit());
});
