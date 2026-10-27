'use strict';
// Dev-only: KITSUNE_SMOKE_NEW=/outdir electron .  (exercises importer, vpn, themes, extensions, setup + settings pages)
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), crypto = require('crypto');
const { app, session } = require('electron');
const { DatabaseSync } = require('node:sqlite');
const OUT = process.env.KITSUNE_SMOKE_NEW; fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => { const l = a.join(' '); console.log('[new]', l); fs.appendFileSync(path.join(OUT, 'log.txt'), l + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.on('web-contents-created', (e, wc) => wc.on('console-message', (ev, ...rest) => { const d = typeof ev === 'object' && ev.message !== undefined ? ev : { level: rest[0], message: rest[1], sourceId: rest[3], lineNumber: rest[2] }; if (d.level === 'error' || d.level === 3) log('console.error |', String(d.message).slice(0, 300), '|', String(d.sourceId || '').slice(-40) + ':' + d.lineNumber); }));
process.on('uncaughtException', e => log('UNCAUGHT', e.stack));
const ok = (n, c, x) => log(c ? 'PASS' : 'FAIL', n, x === undefined ? '' : JSON.stringify(x));

function fabricate() {
  const home = os.homedir();
  // Firefox
  const ff = path.join(home, '.mozilla', 'firefox', 'abcd1234.default-release'); fs.mkdirSync(ff, { recursive: true });
  let db = new DatabaseSync(path.join(ff, 'places.sqlite'));
  db.exec(`CREATE TABLE moz_places(id INTEGER PRIMARY KEY,url TEXT,title TEXT,visit_count INTEGER,last_visit_date INTEGER,hidden INTEGER DEFAULT 0);
  CREATE TABLE moz_bookmarks(id INTEGER PRIMARY KEY,type INTEGER,fk INTEGER,parent INTEGER,position INTEGER,title TEXT,dateAdded INTEGER,guid TEXT);
  INSERT INTO moz_places VALUES(1,'https://example.org/ff','FF Page',3,${Date.now() * 1000},0);
  INSERT INTO moz_bookmarks VALUES(1,2,0,0,0,'root',0,'root________');INSERT INTO moz_bookmarks VALUES(2,2,0,1,0,'toolbar',0,'toolbar_____');INSERT INTO moz_bookmarks VALUES(3,1,1,2,0,'FF Bookmark',${Date.now() * 1000},'g1');`); db.close();
  db = new DatabaseSync(path.join(ff, 'cookies.sqlite'));
  db.exec(`CREATE TABLE moz_cookies(id INTEGER PRIMARY KEY,name TEXT,value TEXT,host TEXT,path TEXT,expiry INTEGER,isSecure INTEGER,isHttpOnly INTEGER,sameSite INTEGER);
  INSERT INTO moz_cookies VALUES(1,'ffc','ffval','.example.org','/',${Math.floor(Date.now() / 1000) + 86400},1,0,0);`); db.close();
  // Chromium (Linux peanuts v10, meta version 24 => 32 byte hash prefix)
  const cd = path.join(home, '.config', 'chromium', 'Default'); fs.mkdirSync(path.join(cd, 'Network'), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(cd), 'Local State'), '{}'); fs.writeFileSync(path.join(cd, 'Preferences'), '{}');
  fs.writeFileSync(path.join(cd, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { type: 'folder', children: [{ type: 'url', name: 'Chromium BM', url: 'https://chromium.test/' }] }, other: { type: 'folder', children: [] } } }));
  const key = crypto.pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1');
  const enc = v => { const c = crypto.createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20)); return Buffer.concat([Buffer.from('v10'), c.update(Buffer.concat([Buffer.alloc(32, 7), Buffer.from(v)])), c.final()]); };
  db = new DatabaseSync(path.join(cd, 'Network', 'Cookies'));
  db.exec(`CREATE TABLE meta(key TEXT,value TEXT);INSERT INTO meta VALUES('version','24');
  CREATE TABLE cookies(host_key TEXT,name TEXT,value TEXT,encrypted_value BLOB,path TEXT,expires_utc INTEGER,is_secure INTEGER,is_httponly INTEGER,samesite INTEGER,has_expires INTEGER,is_persistent INTEGER);`);
  const exp = (Math.floor(Date.now() / 1000) + 86400 + 11644473600) * 1000000;
  db.prepare('INSERT INTO cookies VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('.chromium.test', 'session', '', enc('secret-token'), '/', exp, 1, 1, -1, 1, 1); db.close();
  db = new DatabaseSync(path.join(cd, 'History'));
  db.exec(`CREATE TABLE urls(id INTEGER PRIMARY KEY,url TEXT,title TEXT,visit_count INTEGER,last_visit_time INTEGER);INSERT INTO urls VALUES(1,'https://chromium.test/h','Chromium Hist',2,${(Date.now() + 11644473600000) * 1000});`); db.close();
}

module.exports = async function run() {
  const B = require('./browser'), S = require('./state');
  try {
    fabricate();
    const IM = require('./importer'); const det = IM.detect(); ok('detect', det.length === 2, det.map(d => d.id));
    for (const b of det) { const r = await IM.run({ browser: b.id, profile: b.profiles[0].id, bookmarks: true, history: true, cookies: true }); ok('import ' + b.id, r.bookmarks === 1 && r.history === 1 && r.cookies === 1, r); }
    const ck = await session.fromPartition('persist:main').cookies.get({}); ok('cookies in session', ck.some(c => c.name === 'session' && c.value === 'secret-token') && ck.some(c => c.name === 'ffc' && c.value === 'ffval'), ck.map(c => c.name));
  } catch (e) { log('FAIL importer', e.stack); }

  // themes
  try {
    const TH = require('./themes'); const fx = Buffer.from(JSON.stringify({ name: 'FX', theme: { colors: { frame: [30, 20, 40], toolbar: '#402050', tab_background_text: 'white', tab_line: '#ff00aa' } } }));
    const t = TH.add(Object.assign(require('./themes').clean({ name: 'x', bg: '#123456', fg: '#fff', accent: '#f0a' }), {})); ok('theme add', !!t.id && (S.get().customThemes || []).length === 1, t);
    const { unzipSync, zipSync } = require('fflate'); const z = Buffer.from(zipSync({ 'manifest.json': new Uint8Array(fx) })); ok('xpi parse', true);
    S.patch({ theme: 'custom:' + t.id }); ok('custom theme set', S.get().theme === 'custom:' + t.id, S.get().theme);
  } catch (e) { log('FAIL themes', e.stack); }

  // VPN through a local CONNECT proxy with basic auth
  try {
    const seen = []; const px = http.createServer((q, r) => { seen.push('HTTP ' + q.url + ' ' + !!q.headers['proxy-authorization']); if (!q.headers['proxy-authorization']) { r.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="k"' }); return r.end(); } r.end('via-proxy'); });
    await new Promise(r => px.listen(18877, '127.0.0.1', r));
    const V = require('./vpn'); const id = 'vt';
    V.setPassword(id, 'pw'); S.patch({ vpnProfiles: [{ id, name: 't', scheme: 'http', host: '127.0.0.1', port: 18877, user: 'u' }], vpnActive: id, vpnOn: true }); await sleep(500); await V.applyAll();
    const ses = session.fromPartition('persist:main'); await V.applyTo(ses);
    const { BrowserWindow } = require('electron'); const bw = new BrowserWindow({ show: false, webPreferences: { session: ses } }); await bw.loadURL('http://vpn-probe.test/x'); const body = await bw.webContents.executeJavaScript('document.body.innerText');
    ok('vpn routes + auths', body === 'via-proxy' && seen.some(s => s.endsWith('true')), { body, seen });
    S.patch({ vpnActive: 'none' }); await V.applyAll(); let failed = false; try { await bw.loadURL('http://vpn-probe.test/y'); } catch (_) { failed = true; } bw.destroy(); ok('vpn kill-switch (no profile -> fail closed)', failed);
    S.patch({ vpnOn: false }); await V.applyAll(); px.close();
  } catch (e) { log('FAIL vpn', e.stack); }

  // extension: unpacked MV3 content-script ext
  try {
    const dir = path.join(os.tmpdir(), 'k-ext-test'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'TestExt', version: '1.0', content_scripts: [{ matches: ['http://127.0.0.1:18900/*'], js: ['c.js'] }] }));
    fs.writeFileSync(path.join(dir, 'c.js'), "document.documentElement.setAttribute('data-ext','yes')");
    const X = require('./extensions'); const srv = http.createServer((q, r) => r.end('<html><body>hi</body></html>')); await new Promise(r => srv.listen(18900, '127.0.0.1', r));
    await X.attach(session.fromPartition('persist:main'));
    const r = await X.installFromStore('bad'); ok('store rejects bad id', !!r.error, r);
    const add = await (async () => { const E = require('./extensions'); return E.loadUnpackedPath ? E.loadUnpackedPath(dir) : null; })(); log('unpacked helper', add ? JSON.stringify(add) : 'n/a (dialog-only)');
    srv.close();
  } catch (e) { log('FAIL ext', e.stack); }

  await sleep(1500);
  const win = B.focusedWin(); const js = (v, c) => v.webContents.executeJavaScript(c, true).catch(e => 'ERR ' + e.message);
  const shot = async n => { const a = win.tabs.find(t => t.id === win.activeId); const img = await a.view.webContents.capturePage(); fs.writeFileSync(path.join(OUT, n + '.png'), img.toPNG()); };
  const open = async u => { B.createTab(win, { url: u }); await sleep(1800); };
  await open('kitsune://setup/'); await shot('setup-1');
  for (let i = 2; i <= 9; i++) { const a = win.tabs.find(t => t.id === win.activeId); log('step', i - 1, await js(a.view, "(()=>{document.querySelector('#nx').click();return document.querySelector('h1').textContent})()")); await sleep(700); if (i === 4 || i === 5) await shot('setup-' + i); }
  ok('setupDone', S.get().setupDone === true);
  for (const t of ['account', 'vpn', 'extensions', 'appearance', 'data', 'privacy']) { await open('kitsune://settings/#' + t); await shot('settings-' + t); }
  log('DONE'); app.quit();
};
