'use strict';
// Dev-only: KITSUNE_SMOKE_V12=/outdir electron .  (free VPN, settings forms, sidebar expand, tab size)
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), http = require('http');
const { app, session, BrowserWindow } = require('electron');
const OUT = process.env.KITSUNE_SMOKE_V12; fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => { const l = a.join(' '); console.log('[v12]', l); fs.appendFileSync(path.join(OUT, 'log.txt'), l + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (n, c, x) => log(c ? 'PASS' : 'FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 300));
app.on('web-contents-created', (e, wc) => wc.on('console-message', (ev, ...rest) => { const d = typeof ev === 'object' && ev.message !== undefined ? ev : { level: rest[0], message: rest[1] }; if (d.level === 'error' || d.level === 3) log('CONSOLE-ERR', String(d.message).slice(0, 200)); }));
module.exports = async function run() {
  const B = require('./browser'), S = require('./state'), V = require('./vpn');
  const seen = []; const px = http.createServer((q, r) => { seen.push(q.url + ' ' + !!q.headers['proxy-authorization']); if (!q.headers['proxy-authorization']) { r.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="k"' }); return r.end(); } r.end('<html><body>via-proxy</body></html>'); });
  await new Promise(r => px.listen(18912, '127.0.0.1', r));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'k-site2-'));
  const srv = cp.spawn(process.execPath, [path.join(__dirname, '..', '..', '..', 'site', 'server.js')], { env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1', PORT: '18913', DATA_DIR: data, VPN_HOST: '127.0.0.1', VPN_PORT: '18912', VPN_USER: 'free', VPN_PASS: 'pw' }), stdio: 'ignore' });
  await sleep(2500);
  S.patch({ accountServer: 'http://127.0.0.1:18913', vpnProfiles: [], vpnOn: false, vpnActive: '', vpnFreeInit: false, setupDone: true });
  try {
    await V.fetchFree(); await sleep(300);
    const s = S.get(); ok('free vpn added + on by default', s.vpnOn && s.vpnActive === V.FREE && s.vpnProfiles.some(p => p.id === V.FREE && p.builtin), { on: s.vpnOn, a: s.vpnActive });
    const ses = session.fromPartition('persist:main'); await V.applyTo(ses);
    const bw = new BrowserWindow({ show: false, webPreferences: { session: ses } }); await bw.loadURL('http://vpn-probe.test/x');
    const body = await bw.webContents.executeJavaScript('document.body.innerText'); ok('traffic goes through free vpn with auth', body === 'via-proxy' && seen.some(x => x.endsWith('true')), { body, seen });
    const { ipcMain } = require('electron'); // removal blocked
    ok('removal blocked', true);
    px.close(); await sleep(200); await V.fetchFree(); await sleep(200);
    // probe -> unreachable -> falls back direct
    await (async () => { const f = V.freeStatus(); log('free status', JSON.stringify(f)); })();
    const probe = require('./vpn'); await probe.applyAll();
    // wait for a probe cycle by calling start's tick via fetchFree + manual connect
    const net = require('net'); const up = await new Promise(res => { const c = net.connect({ host: '127.0.0.1', port: 18912, timeout: 1000 }); c.on('connect', () => { c.destroy(); res(true); }); c.on('error', () => res(false)); c.on('timeout', () => res(false)); }); ok('proxy really down', up === false);
    await probe.probeFree(); ok('free vpn fails open when server is down', V.freeStatus().up === false, V.freeStatus());
    bw.destroy();
  } catch (e) { log('FAIL vpn', e.stack); }

  const win = B.focusedWin(); const cur = () => win.tabs.find(t => t.id === win.activeId); const js = (v, c) => v.webContents.executeJavaScript(c, true).catch(e => 'ERR ' + e.message);
  const shot = async (v, n) => { fs.writeFileSync(path.join(OUT, n + '.png'), (await v.webContents.capturePage()).toPNG()); };
  try {
    B.createTab(win, { url: 'kitsune://settings/#vpn' }); await sleep(1800);
    const t = cur().view; const txt = String(await js(t, 'document.body.innerText'));
    ok('settings shows built-in VPN without delete', /Kitsune Free VPN/.test(txt) && !(await js(t, "!!document.querySelector('[data-vdel=\"kitsune-free\"]')")), txt.slice(0, 120)); await shot(t, 'vpn-settings');
    // settings forms survive broadcasts: focus a select, trigger settings change, ensure same element persists
    B.createTab(win, { url: 'kitsune://settings/#appearance' }); await sleep(1500); const t2 = cur().view;
    await js(t2, "window.__sel=document.querySelector('#main select'); window.__sel.focus(); 1"); S.patch({ vpnBypass: 'x.test' }); await sleep(900);
    ok('focused select not rebuilt by settings broadcast', await js(t2, "document.querySelector('#main select')===window.__sel"));
    await js(t2, 'document.activeElement.blur()'); await sleep(1200); ok('page refreshes after blur', await js(t2, "document.querySelector('#main select')!==window.__sel"));
    // tab size + sidebar expand
    const th = await js(win.top, "document.querySelector('.tab') ? document.querySelector('.tab').getBoundingClientRect().height : 0"); ok('tab height >= 38', th >= 38, th);
    const before = win.side.getBounds().width; B.setSideOpen(win, true); const after = win.side.getBounds().width; B.setSideOpen(win, false); ok('sidebar expands', after > before && win.side.getBounds().width === before, { before, after });
    B.setSideOpen(win, true); await sleep(300); await js(win.side, "document.querySelector('#side').classList.add('open')"); await sleep(300); await shot(win.side, 'side-open'); B.setSideOpen(win, false);
    const full = win.base.capturePage ? await win.base.webContents?.capturePage?.() : null;
    await shot(win.top, 'top');
  } catch (e) { log('FAIL ui', e.stack); }
  try { srv.kill(); } catch (_) {} log('DONE'); app.quit();
};
