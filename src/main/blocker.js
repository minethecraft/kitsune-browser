'use strict';
// Real ad / tracker blocker: Ghostery's adblocker engine (EasyList, EasyPrivacy, uBlock filters, cosmetic filters, scriptlets).
// The compiled engine is cached on disk and refreshed every few days. Until it is ready the small built-in host list is used.
const fs = require('fs');
const path = require('path');
const { app, net, ipcMain } = require('electron');

let ElectronBlocker, PRELOAD_PATH;
try { ({ ElectronBlocker } = require('@ghostery/adblocker-electron')); } catch (e) { console.warn('[blocker] engine unavailable:', e.message); }
try { PRELOAD_PATH = require.resolve('@ghostery/adblocker-electron-preload'); } catch (e) { console.warn('[blocker] cosmetic preload unavailable:', e.message); }

const state = { engine: null, level: null, loading: null, ipc: false, updated: 0, error: null };
const TTL = 4 * 24 * 3600 * 1000;
const fetcher = (url, opts) => net.fetch(url, opts);
const file = level => path.join(app.getPath('userData'), `adblock-${level}.bin`);

async function load(level) {
  if (!ElectronBlocker || level === 'off') { state.engine = null; state.level = level; return null; }
  if (state.engine && state.level === level) return state.engine;
  if (state.loading && state.loading.level === level) return state.loading.p;
  const p = (async () => {
    let eng = null; const f = file(level);
    try { const st = fs.statSync(f); eng = ElectronBlocker.deserialize(fs.readFileSync(f)); state.updated = st.mtimeMs; if (Date.now() - st.mtimeMs > TTL) refresh(level); } catch (_) { eng = null; }
    if (!eng) {
      try {
        eng = level === 'strict' ? await ElectronBlocker.fromPrebuiltFull(fetcher) : await ElectronBlocker.fromPrebuiltAdsAndTracking(fetcher);
        fs.writeFileSync(f, Buffer.from(eng.serialize())); state.updated = Date.now(); state.error = null;
      } catch (e) { state.error = e.message; console.warn('[blocker] list download failed:', e.message); }
    }
    if (eng) { state.engine = eng; state.level = level; wireIpc(); }
    state.loading = null; return eng;
  })();
  state.loading = { level, p };
  return p;
}
async function refresh(level) {
  try {
    const eng = level === 'strict' ? await ElectronBlocker.fromPrebuiltFull(fetcher) : await ElectronBlocker.fromPrebuiltAdsAndTracking(fetcher);
    fs.writeFileSync(file(level), Buffer.from(eng.serialize())); state.updated = Date.now();
    if (state.level === level) state.engine = eng;
  } catch (_) {}
}
function wireIpc() {
  if (state.ipc) return; state.ipc = true;
  ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (e, url, msg) => state.engine ? state.engine.onInjectCosmeticFilters(e, url, msg) : undefined);
  ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', e => state.engine ? state.engine.onIsMutationObserverEnabled(e) : false);
}
/** Call once per session: injects the cosmetic-filter preload. */
function attachPreload(ses) {
  if (!PRELOAD_PATH) return;
  try { ses.registerPreloadScript({ type: 'frame', filePath: PRELOAD_PATH }); } catch (_) {}
}
const ready = () => !!state.engine;
function onBeforeRequest(details, cb) { return state.engine.onBeforeRequest(details, cb); }
function onHeadersReceived(details, cb) { return state.engine ? state.engine.onHeadersReceived(details, cb) : cb({}); }
const info = () => ({ ready: ready(), level: state.level, updated: state.updated, error: state.error, available: !!ElectronBlocker });

module.exports = { load, refresh, attachPreload, ready, onBeforeRequest, onHeadersReceived, info };
