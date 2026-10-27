'use strict';
// Windows, tabs, layout, commands, omnibox.
const fs = require('fs');
const path = require('path');
const { BaseWindow, WebContentsView, Menu, session, shell, clipboard, dialog, nativeTheme, net, app } = require('electron');
const S = require('./state');
const sessions = require('./sessions');
const downloads = require('./downloads');
const { READER, PIP } = require('./scripts');

const PRELOAD = path.join(__dirname, '../preload/preload.js');
const TAB_H = 46, TOOL_H = 46, BAR_H = 32, FIND_H = 46, SIDE_W = 54, SIDE_OPEN_W = 224;
const MAC = process.platform === 'darwin', WIN = process.platform === 'win32';

const wins = new Map();            // id -> win
const tabByWc = new Map();         // webContents.id -> tab
let winSeq = 0, tabSeq = 0, lastFocused = null;
const closedTabs = [];
let histIndex = null;

// ---------------------------------------------------------------- helpers
const send = (view, ch, ...a) => { try { if (view && !view.webContents.isDestroyed()) view.webContents.send('k:' + ch, ...a); } catch (_) {} };
const tabOf = (win, id) => win.tabs.find(t => t.id === id) || null;
const activeTab = win => tabOf(win, win.activeId);
const nav = wc => wc.navigationHistory;
const isInternal = u => /^kitsune:/.test(u || '');

function focusedWin() {
  if (lastFocused && wins.has(lastFocused.id) && !lastFocused.base.isDestroyed()) return lastFocused;
  return [...wins.values()][0] || null;
}
function winOfSender(sender) {
  for (const w of wins.values()) {
    if (w.top.webContents === sender || (w.side && w.side.webContents === sender) || (w.ai && w.ai.webContents === sender)) return w;
    const t = tabByWc.get(sender.id); if (t && t.win === w) return w;
  }
  const t = tabByWc.get(sender.id); return t ? t.win : focusedWin();
}

function broadcast(ch, ...a) {
  for (const w of wins.values()) {
    send(w.top, ch, ...a); send(w.side, ch, ...a); send(w.ai, ch, ...a);
    for (const t of w.tabs) if (t.view && isInternal(t.url)) send(t.view, ch, ...a);
  }
}

function toast(win, text, kind) { if (win) send(win.top, 'toast', text, kind || 'info'); }

// ---------------------------------------------------------------- geometry
const barVisible = win => S.get().showBookmarksBar && !win.htmlFull;
const topH = win => win.htmlFull ? 0 : TAB_H + TOOL_H + (barVisible(win) ? BAR_H : 0) + (win.findOpen ? FIND_H : 0);
const AI_W = 390;
const aiW = win => (S.FEAT.assistant && win.aiOpen && !win.htmlFull) ? Math.min(AI_W, Math.max(Math.floor(win.base.getContentSize()[0] * 0.5), 300)) : 0;
const sideW = win => (S.FEAT.sidebar && S.get().sidebarOn && !win.htmlFull) ? SIDE_W : 0;

function bringChromeToFront(win) {
  if (win.side) win.base.contentView.addChildView(win.side);
  if (win.ai) win.base.contentView.addChildView(win.ai);
  win.base.contentView.addChildView(win.top);
}

function layout(win) {
  if (win.base.isDestroyed()) return;
  const [w, h] = win.base.getContentSize();
  const th = topH(win), sw = sideW(win);
  win.top.setBounds({ x: 0, y: 0, width: w, height: win.htmlFull ? 0 : Math.min(h, Math.max(th, win.expandH || 0)) });
  win.top.setVisible(!win.htmlFull);
  if (win.side) { win.side.setBounds({ x: 0, y: th, width: sw ? (win.sideOpen ? SIDE_OPEN_W : sw) : 0, height: Math.max(h - th, 0) }); win.side.setVisible(sw > 0); }
  const aw = aiW(win);
  if (win.ai) { win.ai.setBounds({ x: Math.max(w - aw, 0), y: th, width: aw, height: Math.max(h - th, 0) }); win.ai.setVisible(aw > 0); }
  const cx = sw, cy = th, cw = Math.max(w - sw - aw, 0), ch = Math.max(h - th, 0);
  const a = activeTab(win), sp = win.splitId ? tabOf(win, win.splitId) : null;
  const splitOn = !!(sp && sp.view && a && a.view);
  for (const t of win.tabs) {
    if (!t.view) continue;
    if (t === a || (splitOn && t === sp)) {
      let b = { x: cx, y: cy, width: cw, height: ch };
      if (splitOn) { const half = Math.floor(cw / 2); b = t === a ? { x: cx, y: cy, width: half - 1, height: ch } : { x: cx + half + 1, y: cy, width: cw - half - 1, height: ch }; }
      t.view.setBounds(b); t.view.setVisible(true);
    } else t.view.setVisible(false);
  }
}

// ---------------------------------------------------------------- state -> UI
function serializeTab(t) {
  return { id: t.id, title: t.title, url: t.url, favicon: t.favicon, loading: t.loading, audible: t.audible, muted: t.muted, pinned: t.pinned, sleeping: t.sleeping, container: t.container, blocked: t.blocked, canBack: t.canBack, canFwd: t.canFwd, secure: t.secure };
}
function snapshot(win) {
  const a = activeTab(win);
  const bm = a ? S.bookmarks().data.items.some(b => b.url === a.url) : false;
  const z = a && a.view ? a.view.webContents.getZoomLevel() : 0;
  return { h: win.base.getContentSize()[1], tabs: win.tabs.map(serializeTab), activeId: win.activeId, splitId: win.splitId, workspace: win.workspace, private: win.private, bookmarked: bm, zoom: Math.round(Math.pow(1.2, z) * 100), findOpen: win.findOpen, aiOpen: !!win.aiOpen, fullscreen: win.base.isFullScreen(), maximized: win.base.isMaximized(), downloads: { active: downloads.active(), progress: downloads.progress() } };
}
function emit(win) {
  if (win.emitT) return;
  win.emitT = setTimeout(() => {
    win.emitT = null;
    if (win.base.isDestroyed()) return;
    const snap = snapshot(win);
    send(win.top, 'tabs', snap); send(win.side, 'tabs', snap); send(win.ai, 'tabs', snap);
    scheduleSessionSave();
  }, 16);
}

let sessionTimer = null;
function scheduleSessionSave() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(saveSession, 1500);
}
function saveSession() {
  const w = focusedWin(); const st = S.session();
  const target = (w && !w.private) ? w : [...wins.values()].find(x => !x.private);
  if (!target) return;
  const list = target.tabs.filter(t => t.url && !/^(view-source:|kitsune:\/\/error)/.test(t.url));
  st.data = { tabs: list.map(t => ({ url: t.url, container: t.container, pinned: t.pinned, title: t.title })), active: Math.max(0, list.findIndex(t => t.id === target.activeId)) };
  st.save();
}

// ---------------------------------------------------------------- history
function loadHistIndex() {
  histIndex = new Map();
  for (const h of S.history().data.items) histIndex.set(h.url, h);
}
function addHistory(url, title) {
  if (!/^https?:/.test(url)) return;
  if (!histIndex) loadHistIndex();
  let h = histIndex.get(url);
  const items = S.history().data.items;
  if (h) { h.time = Date.now(); h.visits++; if (title) h.title = title; }
  else {
    h = { url, title: title || url, time: Date.now(), visits: 1 };
    items.push(h); histIndex.set(url, h);
    if (items.length > 6000) { items.splice(0, 500).forEach(x => histIndex.delete(x.url)); }
  }
  S.history().save();
}
function setHistoryTitle(url, title) {
  if (!histIndex) loadHistIndex();
  const h = histIndex.get(url); if (h && title) { h.title = title; S.history().save(); }
}
function clearHistory() { S.history().data.items = []; histIndex = new Map(); S.history().flush(); }

// ---------------------------------------------------------------- input resolution
function resolveInput(text) {
  const s = S.get(); text = (text || '').trim();
  if (!text) return s.homepage;
  if (/^(https?|file|kitsune|view-source|about|chrome-extension):/i.test(text)) return text.startsWith('about:') ? (text === 'about:blank' ? text : 'kitsune://' + text.slice(6) + '/') : text;
  const kw = text.match(/^(\w+)\s+(.+)$/);
  if (kw && S.KEYWORDS[kw[1].toLowerCase()]) return S.KEYWORDS[kw[1].toLowerCase()].replace('%s', encodeURIComponent(kw[2]));
  if (/^localhost(:\d+)?(\/.*)?$/i.test(text) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(text)) return 'http://' + text;
  if (!/\s/.test(text) && /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text)) return 'https://' + text;
  const eng = S.SEARCH_ENGINES[s.searchEngine] || S.SEARCH_ENGINES.duckduckgo;
  return eng.url.replace('%s', encodeURIComponent(text));
}

// ---------------------------------------------------------------- tabs
const hooks = {
  blocked(wcId) { const t = tabByWc.get(wcId); if (t) { t.blocked++; emit(t.win); } },
  download(item) { downloads.handle(item, final => { broadcastDownloads(final); }); }
};
function broadcastDownloads() {
  broadcast('downloads', downloads.list());
  for (const w of wins.values()) emit(w);
}

function partitionFor(win, container) {
  if (win.private) return `private-${win.id}`;
  return (!S.FEAT.containers || container === 'default') ? 'persist:main' : `persist:c-${container}`;
}

function makeView(win, tab) {
  const ses = session.fromPartition(partitionFor(win, tab.container));
  sessions.setup(ses, hooks);
  const view = new WebContentsView({ webPreferences: { session: ses, preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true, backgroundThrottling: true } });
  view.setBackgroundColor('#ffffff');
  tab.view = view;
  win.base.contentView.addChildView(view);
  bringChromeToFront(win);
  wire(win, tab);
  return view;
}

function updateNav(tab) {
  if (!tab.view) return;
  const wc = tab.view.webContents; if (wc.isDestroyed()) return;
  try { tab.canBack = nav(wc).canGoBack(); tab.canFwd = nav(wc).canGoForward(); } catch (_) {}
}

function wire(win, tab) {
  const wc = tab.view.webContents;
  tabByWc.set(wc.id, tab);

  wc.setWindowOpenHandler(({ url, disposition, features }) => {
    if (/^(https?|kitsune|about):/.test(url)) {
      if (disposition === 'new-window' && features && /(width|height|popup)/i.test(features)) {
        return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 520, height: 720 } };
      }
      createTab(win, { url, background: disposition === 'background-tab', container: tab.container, afterId: tab.id });
    } else if (/^(mailto|tel|magnet|steam|discord|spotify|obsidian):/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  wc.on('page-title-updated', (e, title) => { tab.title = title; setHistoryTitle(tab.url, title); emit(win); });
  wc.on('page-favicon-updated', (e, favs) => { tab.favicon = favs[0] || ''; emit(win); });
  wc.on('did-start-loading', () => { tab.loading = true; emit(win); });
  wc.on('did-stop-loading', () => { tab.loading = false; updateNav(tab); emit(win); });
  wc.on('did-start-navigation', d => { if (d.isMainFrame && !d.isSameDocument) { tab.blocked = 0; } });
  wc.on('did-navigate', (e, url) => {
    tab.url = url; tab.secure = url.startsWith('https:'); updateNav(tab);
    if (!win.private) addHistory(url, wc.getTitle());
    if (win.findOpen && win.activeId === tab.id) { cmd(win, 'closeFind'); }
    emit(win);
  });
  wc.on('did-navigate-in-page', (e, url, isMain) => { if (isMain) { tab.url = url; updateNav(tab); emit(win); } });
  wc.on('audio-state-changed', ev => { tab.audible = ev.audible; emit(win); });
  wc.on('focus', () => send(win.top, 'cmd', 'closePopups'));
  wc.on('found-in-page', (e, r) => send(win.top, 'find-result', { active: r.activeMatchOrdinal, total: r.matches }));
  wc.on('enter-html-full-screen', () => { win.htmlFull = true; win.base.setFullScreen(true); layout(win); });
  wc.on('leave-html-full-screen', () => { win.htmlFull = false; win.base.setFullScreen(false); layout(win); });
  wc.on('render-process-gone', (e, d) => { if (d.reason !== 'clean-exit') loadError(tab, 'Page crashed', d.reason); });
  wc.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (!isMain || code === -3 || code === -20 || code === -27) return;
    const orig = sessions.upgraded.get(url);
    if (orig) { try { sessions.httpsExceptions.add(new URL(orig).hostname); } catch (_) {} wc.loadURL(orig).catch(() => {}); return; }
    loadError(tab, desc, url);
  });
  wc.on('before-input-event', (e, input) => handleKey(win, e, input));
  wc.on('context-menu', (e, p) => pageContextMenu(win, tab, p));
  wc.on('will-navigate', (e, url) => {
    if (/^(mailto|tel|magnet|steam|discord|spotify):/.test(url)) { e.preventDefault(); shell.openExternal(url); }
  });
}

function loadError(tab, desc, url) {
  if (!tab.view || tab.view.webContents.isDestroyed()) return;
  tab.view.webContents.loadURL('kitsune://error/?d=' + encodeURIComponent(desc || 'Unknown error') + '&u=' + encodeURIComponent(url || tab.url)).catch(() => {});
}

function createTab(win, o = {}) {
  const s = S.get();
  const container = S.FEAT.containers ? (o.container || (win.workspace !== 'all' ? win.workspace : 'default')) : 'default';
  const tab = { id: ++tabSeq, win, url: o.url || s.homepage, title: '', favicon: '', loading: false, audible: false, muted: false, pinned: !!o.pinned, sleeping: false, container, lastActive: Date.now(), blocked: 0, canBack: false, canFwd: false, view: null, secure: false };
  let idx = o.afterId ? win.tabs.findIndex(t => t.id === o.afterId) + 1 : win.tabs.length;
  if (idx <= 0) idx = win.tabs.length;
  const pinnedCount = win.tabs.filter(t => t.pinned).length;
  if (tab.pinned) idx = Math.min(idx, pinnedCount); else idx = Math.max(idx, pinnedCount);
  win.tabs.splice(idx, 0, tab);
  if (o.sleeping) { tab.sleeping = true; tab.title = o.title || ''; }
  else { makeView(win, tab); tab.view.webContents.loadURL(tab.url).catch(() => {}); }
  if (!o.background) activateTab(win, tab.id);
  else { layout(win); emit(win); }
  if (!o.background && /^kitsune:\/\/newtab/.test(tab.url)) send(win.top, 'cmd', 'focusOmnibox');
  return tab;
}

function wake(tab) {
  if (!tab.sleeping) return;
  tab.sleeping = false;
  makeView(tab.win, tab);
  tab.view.webContents.loadURL(tab.url).catch(() => {});
}

function sleepTab(tab) {
  const win = tab.win;
  if (!tab.view || tab.id === win.activeId || tab.id === win.splitId || tab.audible || tab.loading) return false;
  try { win.base.contentView.removeChildView(tab.view); } catch (_) {}
  tabByWc.delete(tab.view.webContents.id);
  try { tab.view.webContents.close(); } catch (_) {}
  tab.view = null; tab.sleeping = true; tab.blocked = 0;
  emit(win);
  return true;
}

function activateTab(win, id) {
  const tab = tabOf(win, id); if (!tab) return;
  win.activeId = id; tab.lastActive = Date.now();
  if (win.splitId === id) win.splitId = null;
  if (win.workspace !== 'all' && tab.container !== win.workspace) win.workspace = tab.container;
  if (tab.sleeping) wake(tab);
  if (win.findOpen) cmd(win, 'closeFind');
  layout(win); emit(win);
  if (tab.view) tab.view.webContents.focus();
}

function closeTab(win, id, opts = {}) {
  const i = win.tabs.findIndex(t => t.id === id); if (i < 0) return;
  const tab = win.tabs[i];
  if (!win.private && tab.url && !/^kitsune:\/\/(newtab|error)/.test(tab.url)) {
    closedTabs.unshift({ url: tab.url, container: tab.container, pinned: tab.pinned, title: tab.title }); closedTabs.length = Math.min(closedTabs.length, 25);
  }
  win.tabs.splice(i, 1);
  if (tab.view) {
    try { win.base.contentView.removeChildView(tab.view); } catch (_) {}
    tabByWc.delete(tab.view.webContents.id);
    try { tab.view.webContents.close(); } catch (_) {}
    tab.view = null;
  }
  if (win.splitId === id) win.splitId = null;
  if (!win.tabs.length) { if (opts.keepWindow) createTab(win, {}); else { win.base.close(); return; } }
  if (win.activeId === id) {
    const vis = visibleTabs(win);
    const next = win.tabs[Math.min(i, win.tabs.length - 1)];
    const pick = (vis.includes(next) ? next : vis[Math.min(vis.findIndex(t => t === next), vis.length - 1)] || vis[vis.length - 1]) || next;
    activateTab(win, pick.id);
  } else { layout(win); emit(win); }
}

const visibleTabs = win => win.workspace === 'all' ? win.tabs : win.tabs.filter(t => t.container === win.workspace || t.pinned);

function moveTab(win, id, beforeId) {
  const i = win.tabs.findIndex(t => t.id === id); if (i < 0) return;
  const [t] = win.tabs.splice(i, 1);
  const j = beforeId ? win.tabs.findIndex(x => x.id === beforeId) : -1;
  win.tabs.splice(j < 0 ? win.tabs.length : j, 0, t);
  win.tabs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  emit(win);
}

function cycle(win, dir) {
  const v = visibleTabs(win); if (v.length < 2) return;
  const i = v.findIndex(t => t.id === win.activeId);
  activateTab(win, v[(i + dir + v.length) % v.length].id);
}

// ---------------------------------------------------------------- windows
function createWindow(o = {}) {
  const id = ++winSeq;
  const meta = S.themeMeta(S.get().theme, S.get().customThemes);
  const opts = { width: 1380, height: 880, minWidth: 760, minHeight: 480, show: false, backgroundColor: meta.bg, title: 'Kitsune', icon: path.join(S.SRC, '../build/icon.png') };
  const offset = (wins.size % 8) * 28;
  const prev = focusedWin();
  if (prev && !prev.base.isDestroyed()) { const b = prev.base.getBounds(); opts.x = b.x + offset; opts.y = b.y + offset; opts.width = b.width; opts.height = b.height; }
  if (MAC) { opts.titleBarStyle = 'hidden'; opts.trafficLightPosition = { x: 14, y: 12 }; }
  else if (WIN) { opts.titleBarStyle = 'hidden'; opts.titleBarOverlay = { color: meta.bg, symbolColor: meta.fg, height: TAB_H }; }
  const base = new BaseWindow(opts);
  const view = () => new WebContentsView({ webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' } });
  const top = view(); top.setBackgroundColor('#00000000');
  const side = S.FEAT.sidebar ? view() : null; if (side) side.setBackgroundColor('#00000000');
  const ai = S.FEAT.assistant ? view() : null; if (ai) ai.setBackgroundColor('#00000000');
  const win = { id, base, top, side, ai, aiOpen: !!(S.FEAT.assistant && S.get().aiOpen && !o.private), tabs: [], activeId: null, splitId: null, private: !!o.private, workspace: 'all', findOpen: false, expandH: 0, htmlFull: false, emitT: null };
  wins.set(id, win); lastFocused = win;
  if (side) base.contentView.addChildView(side);
  if (ai) { base.contentView.addChildView(ai); ai.webContents.loadURL('kitsune://ui/assistant.html'); ai.webContents.on('before-input-event', (e, input) => handleKey(win, e, input)); }
  base.contentView.addChildView(top);
  top.webContents.loadURL('kitsune://ui/top.html'); if (side) side.webContents.loadURL('kitsune://ui/side.html');
  top.webContents.on('before-input-event', (e, input) => handleKey(win, e, input));
  if (side) side.webContents.on('before-input-event', (e, input) => handleKey(win, e, input));
  const relayout = () => { layout(win); emit(win); };
  for (const ev of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore']) base.on(ev, relayout);
  base.on('focus', () => { lastFocused = win; });
  base.on('close', () => {
    if (!win.private) saveSession();
    for (const t of win.tabs) if (t.view) { tabByWc.delete(t.view.webContents.id); try { t.view.webContents.close(); } catch (_) {} }
    try { require('./nimbus').dispose(win); top.webContents.close(); if (side) side.webContents.close(); if (ai) ai.webContents.close(); } catch (_) {}
  });
  base.on('closed', () => {
    wins.delete(id); if (lastFocused === win) lastFocused = null;
    if (win.private) { try { session.fromPartition(`private-${id}`).clearStorageData(); } catch (_) {} }
    if (!wins.size && !MAC) app.quit();
  });
  layout(win);
  base.show();
  top.webContents.once('did-finish-load', () => {
    const urls = o.urls && o.urls.length ? o.urls : null;
    if (o.restore && o.restore.tabs && o.restore.tabs.length) {
      o.restore.tabs.forEach((t, i) => createTab(win, { url: t.url, container: t.container, pinned: t.pinned, background: true, sleeping: i !== o.restore.active, title: t.title }));
      const act = win.tabs[Math.min(o.restore.active || 0, win.tabs.length - 1)];
      if (act) activateTab(win, act.id);
    } else if (urls) urls.forEach(u => createTab(win, { url: u }));
    else createTab(win, { url: o.private ? 'kitsune://newtab/?private=1' : undefined });
  });
  return win;
}

function applyThemeChrome() {
  const meta = S.themeMeta(S.get().theme, S.get().customThemes);
  for (const w of wins.values()) {
    try { w.base.setBackgroundColor(meta.bg); if (WIN) w.base.setTitleBarOverlay({ color: meta.bg, symbolColor: meta.fg, height: TAB_H }); } catch (_) {}
  }
  nativeTheme.themeSource = S.get().pageTheme === 'dark' ? 'dark' : S.get().pageTheme === 'light' ? 'light' : 'system';
}

function relayoutAll() { for (const w of wins.values()) { layout(w); emit(w); } }

// ---------------------------------------------------------------- keyboard
function handleKey(win, e, input) {
  if (input.type !== 'keyDown') return;
  const mod = MAC ? input.meta : input.control, alt = input.alt, shift = input.shift;
  const k = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  const run = (n, a) => { e.preventDefault(); cmd(win, n, a); };
  if (mod && !alt) {
    if (k === 't') return run(shift ? 'reopenTab' : 'newTab');
    if (k === 'w' || k === 'F4') return run('closeTab');
    if (k === 'l') return run('focusOmnibox');
    if (k === 'k') return run('palette');
    if (k === 'r' || k === 'F5') return run(shift ? 'hardReload' : 'reload');
    if (k === 'f') return run('find');
    if (k === 'g') return run('findNext', !shift);
    if (k === 'd') return run('bookmark');
    if (k === 'h' && !MAC) return run('openPage', 'history');
    if (k === 'y' && MAC) return run('openPage', 'history');
    if (k === 'j') return run('openPage', 'downloads');
    if (k === 'o' && shift) return run('openPage', 'bookmarks');
    if (k === 'n') return run(shift ? 'newPrivate' : 'newWindow');
    if (k === 'p') return run(shift ? 'pdf' : 'print');
    if (k === 'u') return run('viewSource');
    if (k === 's' && shift) return run('screenshot');
    if (k === 'a' && shift) return run('assistant');
    if (k === 'i' && shift && !MAC) return run('devtools');
    if (k === '=' || k === '+') return run('zoomIn');
    if (k === '-' || k === '_') return run('zoomOut');
    if (k === '0') return run('zoomReset');
    if (k === ',') return run('openPage', 'settings');
    if (k === 'Tab') return run('cycle', shift ? -1 : 1);
    if (k === 'PageDown') return run('cycle', 1);
    if (k === 'PageUp') return run('cycle', -1);
    if (k === '[' && MAC) return run('back');
    if (k === ']' && MAC) return run('forward');
    if (/^[1-9]$/.test(k)) return run('tabIndex', parseInt(k, 10));
  }
  if (MAC && mod && alt && k === 'i') return run('devtools');
  if (alt && !mod && !MAC) { if (k === 'ArrowLeft') return run('back'); if (k === 'ArrowRight') return run('forward'); if (k === 'd') return run('focusOmnibox'); }
  if (k === 'F5') return run(shift ? 'hardReload' : 'reload');
  if (k === 'F6') return run('focusOmnibox');
  if (k === 'F3') return run('findNext', !shift);
  if (k === 'F9') return run('reader');
  if (k === 'F11' && !MAC) return run('fullscreen');
  if (k === 'F12') return run('devtools');
  if (MAC && input.control && input.meta && k === 'f') return run('fullscreen');
  if (k === 'Escape' && win.findOpen) return run('closeFind');
}

// ---------------------------------------------------------------- commands
const PALETTE = [
  ['newTab', 'New tab'], ['newWindow', 'New window'], ['newPrivate', 'New private window'], ['reopenTab', 'Reopen closed tab'],
  ['reader', 'Toggle reader view'], ['split', 'Toggle split view'], ['pip', 'Picture-in-picture'], ['screenshot', 'Take screenshot'],
  ['bookmark', 'Bookmark this page'], ['find', 'Find in page'], ['print', 'Print'], ['pdf', 'Save page as PDF'], ['devtools', 'Developer tools'],
  ['viewSource', 'View page source'], ['fullscreen', 'Toggle full screen'], ['sleepOthers', 'Sleep other tabs (free memory)'], ['closeOthers', 'Close other tabs'],
  ['nextTheme', 'Next theme'], ['toggleSidebar', 'Toggle sidebar'], ['zoomReset', 'Reset zoom'],
  ['page:anime', 'Open Anime Hub'], ['page:bookmarks', 'Open bookmarks'], ['page:history', 'Open history'], ['page:downloads', 'Open downloads'], ['page:settings', 'Open settings']
];

function openPage(win, name) {
  const url = `kitsune://${name}/`;
  const ex = win.tabs.find(t => t.url.startsWith(url));
  if (ex) return activateTab(win, ex.id);
  createTab(win, { url, afterId: win.activeId });
}

async function cmd(win, name, arg) {
  if (!win) return;
  const a = activeTab(win), wc = a && a.view ? a.view.webContents : null;
  switch (name) {
    case 'newTab': return createTab(win, { url: arg || undefined, afterId: win.activeId });
    case 'newWindow': return createWindow({});
    case 'newPrivate': return createWindow({ private: true });
    case 'closeTab': return a && closeTab(win, a.id);
    case 'reopenTab': { const c = closedTabs.shift(); if (c) createTab(win, c); return; }
    case 'cycle': return cycle(win, arg || 1);
    case 'tabIndex': { const v = visibleTabs(win); const t = arg === 9 ? v[v.length - 1] : v[arg - 1]; if (t) activateTab(win, t.id); return; }
    case 'back': if (wc && nav(wc).canGoBack()) nav(wc).goBack(); return;
    case 'forward': if (wc && nav(wc).canGoForward()) nav(wc).goForward(); return;
    case 'reload': if (a && a.sleeping) return wake(a); if (wc) { if (a.loading) wc.stop(); else wc.reload(); } return;
    case 'hardReload': if (wc) wc.reloadIgnoringCache(); return;
    case 'stop': if (wc) wc.stop(); return;
    case 'home': if (wc) wc.loadURL(S.get().homepage).catch(() => {}); return;
    case 'focusOmnibox': return send(win.top, 'cmd', 'focusOmnibox');
    case 'palette': return send(win.top, 'cmd', 'palette');
    case 'find': win.findOpen = true; layout(win); emit(win); return send(win.top, 'cmd', 'find');
    case 'closeFind': win.findOpen = false; if (wc) { wc.stopFindInPage('clearSelection'); } layout(win); emit(win); send(win.top, 'cmd', 'findClosed'); if (wc) wc.focus(); return;
    case 'findNext': if (wc && win.lastFind) wc.findInPage(win.lastFind, { forward: arg !== false, findNext: true }); return;
    case 'bookmark': return toggleBookmark(win);
    case 'openPage': return openPage(win, arg);
    case 'navigate': navigate(win, arg); return;
    case 'openUrl': { // sidebar pins: focus an existing tab for that site, else open a new one
      try { const host = new URL(arg).hostname; const ex = win.tabs.find(t => { try { return new URL(t.url).hostname === host; } catch (_) { return false; } }); if (ex) return activateTab(win, ex.id); } catch (_) {}
      return createTab(win, { url: arg, afterId: win.activeId });
    }
    case 'pinCurrent': { if (a && /^https?:/.test(a.url)) { const pins = S.get().pins.filter(p => p.url !== a.url); pins.push({ title: a.title || a.url, url: a.url }); S.patch({ pins }); toast(win, 'Pinned to sidebar'); } return; }
    case 'workspace': {
      win.workspace = arg || 'all';
      const v = visibleTabs(win);
      if (!v.includes(a)) { if (v.length) activateTab(win, v[0].id); else createTab(win, { container: win.workspace === 'all' ? 'default' : win.workspace }); }
      emit(win); return;
    }
    case 'zoomIn': case 'zoomOut': case 'zoomReset': {
      if (!wc) return;
      const z = name === 'zoomReset' ? 0 : Math.max(-3, Math.min(5, wc.getZoomLevel() + (name === 'zoomIn' ? 0.5 : -0.5)));
      wc.setZoomLevel(z); emit(win); toast(win, `Zoom ${Math.round(Math.pow(1.2, z) * 100)}%`); return;
    }
    case 'devtools': if (wc) { wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'detach' }); } return;
    case 'viewSource': if (a && /^https?:/.test(a.url)) createTab(win, { url: 'view-source:' + a.url, afterId: a.id }); return;
    case 'print': if (wc) wc.print({ printBackground: true }); return;
    case 'pdf': {
      if (!wc) return;
      const r = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('downloads'), (a.title || 'page').replace(/[\\/:*?"<>|]+/g, '_') + '.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (r.canceled || !r.filePath) return;
      try { fs.writeFileSync(r.filePath, await wc.printToPDF({ printBackground: true })); toast(win, 'Saved PDF'); shell.showItemInFolder(r.filePath); } catch (e) { toast(win, 'PDF failed: ' + e.message, 'error'); }
      return;
    }
    case 'fullscreen': return win.base.setFullScreen(!win.base.isFullScreen());
    case 'reader': {
      if (!wc || isInternal(a.url)) return toast(win, 'Reader view isn’t available here');
      try { const r = await wc.executeJavaScript(READER, true); if (r === 'none') toast(win, 'Reader view isn’t available on this page'); } catch (_) { toast(win, 'Reader view failed', 'error'); }
      return;
    }
    case 'pip': {
      if (!wc) return;
      try { const r = await wc.executeJavaScript(PIP, true); if (r === 'none') toast(win, 'No playing video found'); } catch (_) { toast(win, 'Picture-in-picture unavailable'); }
      return;
    }
    case 'screenshot': {
      if (!wc) return;
      try {
        const img = await wc.capturePage();
        const dir = path.join(app.getPath('pictures'), 'Kitsune'); fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, 'Kitsune-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.png');
        fs.writeFileSync(f, img.toPNG()); clipboard.writeImage(img);
        toast(win, 'Screenshot saved & copied', 'ok');
      } catch (e) { toast(win, 'Screenshot failed', 'error'); }
      return;
    }
    case 'mute': { const t = arg ? tabOf(win, arg) : a; if (t && t.view) { t.muted = !t.muted; t.view.webContents.setAudioMuted(t.muted); emit(win); } return; }
    case 'pin': { const t = arg ? tabOf(win, arg) : a; if (t) { t.pinned = !t.pinned; win.tabs.sort((x, y) => (y.pinned ? 1 : 0) - (x.pinned ? 1 : 0)); emit(win); } return; }
    case 'duplicate': { const t = arg ? tabOf(win, arg) : a; if (t) createTab(win, { url: t.url, container: t.container, afterId: t.id }); return; }
    case 'sleep': { const t = tabOf(win, arg); if (t) sleepTab(t); return; }
    case 'sleepOthers': { let n = 0; for (const t of win.tabs) if (sleepTab(t)) n++; toast(win, n ? `Put ${n} tab${n > 1 ? 's' : ''} to sleep` : 'Nothing to sleep', 'ok'); return; }
    case 'closeOthers': { const keep = arg || win.activeId; for (const t of [...win.tabs]) if (t.id !== keep && !t.pinned) closeTab(win, t.id); return; }
    case 'closeRight': { const i = win.tabs.findIndex(t => t.id === arg); for (const t of win.tabs.slice(i + 1)) closeTab(win, t.id); return; }
    case 'split': {
      if (!S.FEAT.split) return;
      if (win.splitId) { win.splitId = null; layout(win); emit(win); return; }
      let other = arg ? tabOf(win, arg) : [...win.tabs].filter(t => t.id !== win.activeId).sort((x, y) => y.lastActive - x.lastActive)[0];
      if (!other) other = createTab(win, { url: 'kitsune://newtab/', background: true });
      if (other.sleeping) wake(other);
      win.splitId = other.id; layout(win); emit(win); return;
    }
    case 'moveToContainer': { const t = tabOf(win, arg.id); if (t && t.container !== arg.container) { createTab(win, { url: t.url, container: arg.container, afterId: t.id }); closeTab(win, t.id); } return; }
    case 'nextTheme': { const l = S.FEAT.themes; const i = l.indexOf(S.get().theme); S.patch({ theme: l[(i + 1) % l.length] }); return; }
    case 'assistant': if (!S.FEAT.assistant) return; win.aiOpen = arg === undefined ? !win.aiOpen : !!arg; if (!win.private) S.patch({ aiOpen: win.aiOpen }); layout(win); emit(win); send(win.ai, 'ai.focus'); return;
    case 'toggleSidebar': S.patch({ sidebarOn: !S.get().sidebarOn }); return;
    default:
      if (name.startsWith('page:')) return openPage(win, name.slice(5));
  }
}

function toggleBookmark(win) {
  const a = activeTab(win); if (!a || !/^(https?|file):/.test(a.url)) return toast(win, 'This page can’t be bookmarked');
  const st = S.bookmarks(); const items = st.data.items;
  const i = items.findIndex(b => b.url === a.url);
  if (i >= 0) { items.splice(i, 1); toast(win, 'Bookmark removed'); }
  else { items.push({ id: 'b' + Date.now().toString(36), title: a.title || a.url, url: a.url, added: Date.now(), bar: true }); toast(win, 'Bookmarked ★', 'ok'); }
  st.save(); broadcast('bookmarks'); emit(win);
}

// ---------------------------------------------------------------- navigation from omnibox
function navigate(win, input) {
  const url = resolveInput(input);
  let a = activeTab(win);
  if (!a) return createTab(win, { url });
  a.url = url;
  if (a.sleeping) wake(a); else a.view.webContents.loadURL(url).catch(() => {});
  a.view.webContents.focus();
  emit(win);
}

// ---------------------------------------------------------------- omnibox suggestions
async function suggest(win, text) {
  text = (text || '').trim();
  const out = [];
  if (text.startsWith('>')) {
    const q = text.slice(1).trim().toLowerCase();
    return PALETTE.filter(([id, label]) => !q || label.toLowerCase().includes(q)).slice(0, 9).map(([id, label]) => ({ type: 'cmd', title: label, cmd: id }));
  }
  if (!text) return [];
  const q = text.toLowerCase();
  out.push({ type: 'go', title: text, url: resolveInput(text) });
  const seen = new Set();
  const push = o => { if (o.url && seen.has(o.url)) return; if (o.url) seen.add(o.url); out.push(o); };
  for (const t of win.tabs) if (t.url && !isInternal(t.url) && ((t.title || '').toLowerCase().includes(q) || t.url.toLowerCase().includes(q))) push({ type: 'tab', title: t.title || t.url, url: t.url, tabId: t.id, icon: t.favicon });
  for (const b of S.bookmarks().data.items) if (b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)) push({ type: 'bookmark', title: b.title, url: b.url });
  if (!win.private) {
    const items = S.history().data.items; let n = 0;
    const scored = [];
    for (let i = items.length - 1; i >= 0 && scored.length < 200; i--) {
      const h = items[i]; const u = h.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '');
      if (u.startsWith(q) || (h.title || '').toLowerCase().includes(q) || u.includes(q)) scored.push({ h, s: (u.startsWith(q) ? 100 : 0) + Math.min(h.visits, 20) + (i / items.length) * 10 });
    }
    scored.sort((x, y) => y.s - x.s);
    for (const { h } of scored) { if (n++ >= 4) break; push({ type: 'history', title: h.title, url: h.url }); }
  }
  const trimmed = out.slice(0, 7);
  if (!/\s/.test(text) && /\./.test(text)) return trimmed;
  try {
    const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 650);
    const r = await net.fetch('https://duckduckgo.com/ac/?q=' + encodeURIComponent(text), { signal: ctrl.signal }); clearTimeout(tm);
    const j = await r.json();
    for (const p of j.slice(0, 5)) if (p.phrase && p.phrase.toLowerCase() !== q) trimmed.push({ type: 'search', title: p.phrase, url: resolveInput(p.phrase) });
  } catch (_) { /* offline or slow: skip */ }
  return trimmed.slice(0, 11);
}

// ---------------------------------------------------------------- native menus
function pageContextMenu(win, tab, p) {
  const wc = tab.view.webContents; const T = [];
  const open = (url, bg, priv) => priv ? createWindow({ private: true, urls: [url] }) : createTab(win, { url, background: bg, container: tab.container, afterId: tab.id });
  if (p.misspelledWord && p.dictionarySuggestions.length) {
    p.dictionarySuggestions.slice(0, 4).forEach(sg => T.push({ label: sg, click: () => wc.replaceMisspelling(sg) }));
    T.push({ type: 'separator' });
  }
  if (p.linkURL) {
    T.push({ label: 'Open Link in New Tab', click: () => open(p.linkURL, false) }, { label: 'Open Link in Background Tab', click: () => open(p.linkURL, true) },
      { label: 'Open Link in Private Window', click: () => open(p.linkURL, false, true) }, { label: 'Copy Link Address', click: () => clipboard.writeText(p.linkURL) }, { type: 'separator' });
  }
  if (p.mediaType === 'image') {
    T.push({ label: 'Open Image in New Tab', click: () => open(p.srcURL, false) }, { label: 'Save Image As…', click: () => wc.downloadURL(p.srcURL) },
      { label: 'Copy Image', click: () => wc.copyImageAt(p.x, p.y) }, { label: 'Copy Image Address', click: () => clipboard.writeText(p.srcURL) }, { type: 'separator' });
  }
  if (p.mediaType === 'video' || p.mediaType === 'audio') {
    if (p.mediaType === 'video') T.push({ label: 'Picture-in-Picture', click: () => cmd(win, 'pip') });
    T.push({ label: 'Save ' + (p.mediaType === 'video' ? 'Video' : 'Audio') + ' As…', click: () => wc.downloadURL(p.srcURL) }, { label: 'Copy Media Address', click: () => clipboard.writeText(p.srcURL) }, { type: 'separator' });
  }
  if (p.isEditable) {
    T.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' });
  } else if (p.selectionText) {
    const sel = p.selectionText.trim();
    T.push({ role: 'copy' }, { label: `Search for “${sel.length > 28 ? sel.slice(0, 28) + '…' : sel}”`, click: () => open(resolveInput(sel), false) }, { type: 'separator' });
  }
  if (!p.linkURL && !p.selectionText && !p.isEditable && p.mediaType === 'none') {
    T.push({ label: 'Back', enabled: nav(wc).canGoBack(), click: () => nav(wc).goBack() }, { label: 'Forward', enabled: nav(wc).canGoForward(), click: () => nav(wc).goForward() }, { label: 'Reload', click: () => wc.reload() }, { type: 'separator' },
      { label: 'Bookmark Page', click: () => toggleBookmark(win) }, { label: 'Reader View', click: () => cmd(win, 'reader') }, { label: 'Take Screenshot', click: () => cmd(win, 'screenshot') }, { label: 'Print…', click: () => cmd(win, 'print') }, { type: 'separator' });
  }
  T.push({ label: 'View Page Source', enabled: /^https?:/.test(tab.url), click: () => cmd(win, 'viewSource') }, { label: 'Inspect Element', click: () => { wc.inspectElement(p.x, p.y); if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach' }); } });
  Menu.buildFromTemplate(T).popup({ window: win.base });
}

function tabContextMenu(win, id) {
  const t = tabOf(win, id); if (!t) return;
  const T = [
    { label: 'New Tab', click: () => cmd(win, 'newTab') },
    { label: 'Reload Tab', click: () => { if (t.sleeping) wake(t); else t.view.webContents.reload(); } },
    { label: t.pinned ? 'Unpin Tab' : 'Pin Tab', click: () => cmd(win, 'pin', id) },
    { label: t.muted ? 'Unmute Tab' : 'Mute Tab', enabled: !!t.view, click: () => cmd(win, 'mute', id) },
    { label: 'Duplicate Tab', click: () => cmd(win, 'duplicate', id) },
    { label: 'Put Tab to Sleep', enabled: !!t.view && t.id !== win.activeId, click: () => cmd(win, 'sleep', id) }
  ];
  if (S.FEAT.split) T.push({ label: win.splitId === id ? 'Close Split View' : 'Open in Split View', enabled: id !== win.activeId, click: () => { if (win.splitId) win.splitId = null; cmd(win, 'split', win.splitId ? undefined : id); if (win.splitId === null) { win.splitId = null; } layout(win); emit(win); } });
  if (S.FEAT.containers && !win.private) {
    T.push({ type: 'separator' }, { label: 'Move to Container', submenu: S.get().containers.map(c => ({ label: `${c.icon || ''} ${c.name}`, type: 'radio', checked: t.container === c.id, click: () => cmd(win, 'moveToContainer', { id, container: c.id }) })) });
  }
  T.push({ type: 'separator' }, { label: 'Close Tab', click: () => closeTab(win, id) }, { label: 'Close Other Tabs', click: () => cmd(win, 'closeOthers', id) }, { label: 'Close Tabs to the Right', click: () => cmd(win, 'closeRight', id) }, { label: 'Reopen Closed Tab', enabled: closedTabs.length > 0, click: () => cmd(win, 'reopenTab') });
  Menu.buildFromTemplate(T).popup({ window: win.base });
}

// ---------------------------------------------------------------- housekeeping
function startSleeper() {
  setInterval(() => {
    const mins = S.get().sleepMinutes; if (!mins) return;
    const cutoff = Date.now() - mins * 60000;
    for (const w of wins.values()) for (const t of w.tabs) if (t.view && t.lastActive < cutoff && !/^kitsune:\/\/newtab/.test(t.url)) sleepTab(t);
  }, 60000).unref();
}

module.exports = {
  activeTab, tabOf, wake, wins, tabByWc, createWindow, createTab, focusedWin, winOfSender, cmd, navigate, suggest, emit, layout, relayoutAll, broadcast, broadcastDownloads,
  activateTab, closeTab, moveTab, tabContextMenu, snapshot, applyThemeChrome, startSleeper, saveSession, clearHistory, toast, PALETTE,
  setSideOpen(win, on) { on = !!on; if (win.sideOpen === on) return; win.sideOpen = on; if (on && win.side) { win.base.contentView.addChildView(win.side); win.base.contentView.addChildView(win.top); } layout(win); },
  setExpand(win, h) { win.expandH = h | 0; layout(win); },
  findText(win, text, opts = {}) { const a = activeTab(win); if (!a || !a.view) return; win.lastFind = text; if (!text) { a.view.webContents.stopFindInPage('clearSelection'); send(win.top, 'find-result', { active: 0, total: 0 }); return; } a.view.webContents.findInPage(text, { forward: opts.forward !== false, findNext: !!opts.next, matchCase: !!opts.matchCase }); },
  stats() { let tabs = 0, sleeping = 0; for (const w of wins.values()) for (const t of w.tabs) { tabs++; if (t.sleeping) sleeping++; } return { tabs, sleeping, windows: wins.size }; }
};
