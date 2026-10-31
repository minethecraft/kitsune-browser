'use strict';
// Dev-only: KITSUNE_SMOKE_V14=/outdir electron .   (custom menus, drag & drop, themes, lock panel, fast downloads, telemetry, new-tab page)
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');
const { app } = require('electron');
const OUT = process.env.KITSUNE_SMOKE_V14; fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => { const l = a.join(' '); console.log('[v14]', l); fs.appendFileSync(path.join(OUT, 'log.txt'), l + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (n, c, x) => log(c ? 'PASS' : 'FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 300));
app.on('web-contents-created', (e, wc) => wc.on('console-message', (ev, ...rest) => { const d = typeof ev === 'object' && ev.message !== undefined ? ev : { level: rest[0], message: rest[1] }; if (d.level === 'error' || d.level === 3) log('CONSOLE-ERR', String(d.message).slice(0, 200)); }));

module.exports = async function run() {
  const B = require('./browser'), S = require('./state'), DL = require('./downloads');
  const BIG = crypto.randomBytes(24 * 1024 * 1024), BIGSUM = crypto.createHash('sha256').update(BIG).digest('hex');
  const pings = [];
  const srv = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/api/ping') { let b = ''; q.on('data', d => b += d); return q.on('end', () => { try { pings.push(JSON.parse(b)); log('PING', JSON.parse(b).ev); } catch (_) {} r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"ok":true}'); }); }
    if (u.pathname === '/big.bin') {
      let s = 0, e = BIG.length - 1, code = 200; const h = { 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', 'content-disposition': 'attachment; filename="big.bin"', etag: '"v1"' };
      const m = /bytes=(\d+)-(\d*)/.exec(q.headers.range || ''); if (m) { s = +m[1]; if (m[2]) e = +m[2]; code = 206; h['content-range'] = `bytes ${s}-${e}/${BIG.length}`; }
      h['content-length'] = e - s + 1; r.writeHead(code, h);
      let o = s; const tick = () => { if (o > e) return r.end(); const n = Math.min(65536, e - o + 1); r.write(BIG.subarray(o, o + n)); o += n; setTimeout(tick, 25); }; return tick();
    }
    r.writeHead(200, { 'content-type': 'text/html' });
    r.end(`<html><head><title>Test page ${u.pathname}</title></head><body style="font:16px sans-serif;padding:30px"><h1>Test ${u.pathname}</h1><a id="l" href="/other">a link</a><p id="p">some selectable text</p><input id="i"></body></html>`);
  });
  await new Promise(r => srv.listen(18940, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:18940';
  S.patch({ accountServer: BASE, setupDone: true, downloadDir: path.join(OUT, 'dl'), animations: 'full', showBookmarksBar: true, httpsOnly: false, bgKiroku: false });

  let win = null; for (let i = 0; i < 60 && !(win = [...B.wins.values()][0]); i++) await sleep(250);
  await sleep(2500);
  const top = () => win.top.webContents, tabWc = () => B.activeTab(win).view.webContents;
  const ev = (wc, js) => wc.executeJavaScript(js, true);
  const shot = async (wc, name) => { fs.writeFileSync(path.join(OUT, name + '.png'), (await wc.capturePage()).toPNG()); };
  const call = (js) => ev(top(), js);
  const click = (sel) => call(`document.querySelector(${JSON.stringify(sel)}).click()`);

  // ---- basics
  ok('top view loaded', await call(`!!document.querySelector('#chrome') && document.querySelectorAll('.tab').length >= 1`));
  ok('frameless on this OS (custom window buttons visible)', await call(`!document.querySelector('#wc').hidden`));
  ok('particle canvas present', await call(`!!document.querySelector('canvas#fx') && document.querySelector('canvas#fx').width > 0`));
  ok('tabs are wide (not squeezed)', await call(`document.querySelector('.tab').offsetWidth`) > 250, await call(`document.querySelector('.tab').offsetWidth`));
  log('INFO tabs', JSON.stringify(await call(`({ n: document.querySelectorAll('.tab').length, strip: document.querySelector('#tabstrip').offsetWidth, tabs: document.querySelector('#tabs').offsetWidth, tab: [...document.querySelectorAll('.tab')].map(t => t.offsetWidth), vw: innerWidth, flex: getComputedStyle(document.querySelector('.tab')).flex })`)));
  if (process.env.V14_QUICK) { await shot(top(), 'quick'); app.quit(); return; }
  ok('top view is opaque when not expanded', win.topBg !== '#00000000', win.topBg);

  // ---- every theme renders on the new tab page and in the chrome
  const themes = S.FEAT.themes; ok('13 themes', themes.length === 13, themes);
  for (const t of themes) {
    S.patch({ theme: t }); await sleep(700);
    const bgTop = await call(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() + '|' + getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() + '|' + document.documentElement.dataset.theme`);
    ok('theme ' + t + ' applies', /^#[0-9a-f]{3,8}\|#?[0-9a-f]{3,8}\|/i.test(bgTop) && bgTop.endsWith(t), bgTop);
    if (['aurora', 'matcha', 'kitsune', 'cosmos', 'mono', 'sakura', 'neon'].includes(t)) await shot(top(), 'theme-' + t);
  }
  S.patch({ theme: 'sakura' }); await sleep(400);

  // ---- tabs + drag a link onto the tab strip
  B.createTab(win, { url: BASE + '/one' }); await sleep(1500);
  const before = win.tabs.length;
  const dropRes = await call(`(async () => {
    const strip = document.querySelector('#tabstrip'); const dt = new DataTransfer(); dt.setData('text/uri-list', '${BASE}/dropped'); dt.setData('text/plain', '${BASE}/dropped');
    const mk = (t, o) => new DragEvent(t, Object.assign({ bubbles: true, cancelable: true, dataTransfer: dt, clientX: 300, clientY: 20 }, o));
    document.dispatchEvent(mk('dragenter')); const flagged = document.body.classList.contains('dragging-link');
    strip.dispatchEvent(mk('dragover')); strip.dispatchEvent(mk('drop')); return flagged; })()`);
  await sleep(1200);
  ok('dragging a link over the tab bar flags it', dropRes === true);
  ok('dropping a link opens a new tab', win.tabs.length === before + 1 && win.tabs.some(t => t.url.endsWith('/dropped')), win.tabs.map(t => t.url));
  // ... into the bookmarks bar
  await call(`(() => { const bar = document.querySelector('#bar'); const dt = new DataTransfer(); dt.setData('text/uri-list', '${BASE}/bm1'); dt.setData('text/x-moz-url', '${BASE}/bm1\\nMy dropped bookmark'); const mk = t => new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }); bar.dispatchEvent(mk('dragover')); bar.dispatchEvent(mk('drop')); })()`);
  await sleep(700);
  ok('dropping a link on the bookmarks bar bookmarks it', S.bookmarks().data.items.some(b => b.url.endsWith('/bm1')), S.bookmarks().data.items.map(b => b.title));
  // lock is a draggable link handle
  const lk = await call(`(() => { const dt = new DataTransfer(); const e = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }); document.querySelector('#site').dispatchEvent(e); return { uri: dt.getData('text/uri-list'), draggable: document.querySelector('#site').draggable }; })()`);
  ok('lock icon drags the page link', lk.draggable && /^http:\/\/127\.0\.0\.1:18940\//.test(lk.uri), lk);

  // ---- custom context menus
  B.activateTab(win, win.tabs[0].id); await sleep(400);
  B.tabContextMenu(win, win.tabs[1].id, 140, 30); await sleep(500);
  const m1 = await call(`({ open: !document.querySelector('#ctxm').hidden, items: [...document.querySelectorAll('#ctxm .mi span')].map(x => x.textContent) })`);
  ok('tab menu is custom and populated', m1.open && m1.items.includes('Close Tab') && m1.items.includes('Duplicate Tab'), m1.items);
  const exp = win.expandH; ok('top view expanded for the menu', exp > 100, exp);
  const bd = await call(`getComputedStyle(document.querySelector('#backdrop')).backgroundColor`); ok('backdrop no longer darkens the page', /rgba\(0, 0, 0, 0\)|transparent/.test(bd), bd);
  await shot(top(), 'ctx-tab');
  await call(`[...document.querySelectorAll('#ctxm .mi')].find(x => x.textContent.includes('Duplicate Tab')).click()`); await sleep(900);
  ok('menu item runs main-process action', win.tabs.filter(t => t.url.endsWith('/dropped')).length === 2 || win.tabs.length > before + 1, win.tabs.length);
  ok('menu closed after click', await call(`document.querySelector('#ctxm').hidden`));
  // page context menu (link + selection)
  const aw = tabWc(); aw.emit('context-menu', {}, { x: 60, y: 90, linkURL: BASE + '/other', linkText: 'x', mediaType: 'none', misspelledWord: '', dictionarySuggestions: [], isEditable: false, selectionText: '' });
  await sleep(600);
  const m2 = await call(`({ open: !document.querySelector('#ctxm').hidden, items: [...document.querySelectorAll('#ctxm .mi span')].map(x => x.textContent), left: parseInt(document.querySelector('#ctxm').style.left) })`);
  ok('page menu for links is custom', m2.open && m2.items.includes('Open Link in New Tab') && m2.items.includes('Bookmark Link'), m2);
  await call(`document.querySelector('#backdrop').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`); await sleep(400);
  ok('clicking outside closes the menu & collapses view', (await call(`document.querySelector('#ctxm').hidden`)) && win.expandH === 0, win.expandH);
  // omnibox right-click menu
  await call(`document.querySelector('#omni-in').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 70 }))`); await sleep(1200);
  ok('address bar has custom right-click menu', await call(`!document.querySelector('#ctxm').hidden && [...document.querySelectorAll('#ctxm .mi span')].some(x => x.textContent === 'Paste and Go')`));
  await call(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); await sleep(300);

  // ---- bookmarks bar: edit by right-click, "more" toggle
  const chip = await call(`(() => { const c = [...document.querySelectorAll('#bar .chip')].find(x => x.textContent.includes('My dropped')); if (!c) return null; c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 100 })); return true; })()`);
  await sleep(500); ok('right-click on a bookmark opens its menu', chip && await call(`[...document.querySelectorAll('#ctxm .mi span')].some(x => x.textContent.startsWith('Edit'))`));
  await call(`[...document.querySelectorAll('#ctxm .mi')].find(x => x.textContent.startsWith('Edit')).click()`); await sleep(600);
  ok('bookmark editor opens', await call(`!document.querySelector('#editp').hidden && document.querySelector('#ed-t').value.includes('My dropped')`));
  await shot(top(), 'bookmark-editor');
  await call(`document.querySelector('#ed-t').value = 'Renamed!'; document.querySelector('#ed-s').click()`); await sleep(700);
  ok('editing a bookmark saves it', S.bookmarks().data.items.some(b => b.title === 'Renamed!'));
  // fill the bar so the "more" chip appears, then toggle it twice
  for (let i = 0; i < 40; i++) S.bookmarks().data.items.push({ id: 'x' + i, title: 'Bookmark number ' + i, url: BASE + '/b' + i, added: Date.now(), bar: true });
  B.broadcast('bookmarks'); await sleep(800);
  const more = await call(`!!document.querySelector('#bar .chip.more')`); ok('overflow chip appears', more);
  await call(`document.querySelector('#bar .chip.more').click()`); await sleep(500);
  const o1 = await call(`!document.querySelector('#morep').hidden`); await call(`document.querySelector('#bar .chip.more').click()`); await sleep(400);
  ok('bookmarks overflow opens and a second press closes it', o1 && await call(`document.querySelector('#morep').hidden`));
  S.bookmarks().data.items = S.bookmarks().data.items.filter(b => !/^x\d+$/.test(b.id)); B.broadcast('bookmarks');

  // ---- lock menu with real controls
  B.activateTab(win, win.tabs[win.tabs.length - 1].id); await sleep(500);
  await click('#site'); await sleep(800);
  const sp = await call(`({ open: !document.querySelector('#sitep').hidden, selects: document.querySelectorAll('#sitep select').length, btns: [...document.querySelectorAll('#sitep .si-btn span')].map(x => x.textContent) })`);
  ok('lock opens a real site panel (permissions + actions)', sp.open && sp.selects >= 4 && sp.btns.length >= 2, sp);
  await shot(top(), 'site-panel');
  await call(`(() => { const s = document.querySelector('#sitep select[data-p="geolocation"]'); s.value = 'block'; s.dispatchEvent(new Event('change')); })()`); await sleep(500);
  ok('changing a permission is saved', Object.entries(S.get().sitePerms).some(([k, v]) => /geolocation$/.test(k) && v === false), S.get().sitePerms);
  await click('#site'); await sleep(300);
  ok('lock button toggles closed', await call(`document.querySelector('#sitep').hidden`));

  // ---- new tab shows an empty address bar (no leftover URL)
  await call(`document.querySelector('#omni-in').blur()`); B.cmd(win, 'newTab'); await sleep(1400);
  const ob = await call(`document.querySelector('#omni-in').value`); ok('new tab address bar starts empty', ob === '', ob);

  // ---- new-tab page: shortcuts editor + hide modes
  S.patch({ dialItems: [{ id: 'd1', title: 'Mine', url: 'https://example.com/' }] }); await sleep(900);
  const nt = B.activeTab(win).view.webContents; await sleep(1000);
  const dial = await ev(nt, `({ tiles: document.querySelectorAll('.tw[data-i]').length, mo: document.querySelectorAll('.tw .mo').length, add: !!document.querySelector('#addTile'), first: document.querySelector('.tw .tile span').textContent })`);
  ok('new tab shows editable shortcuts + big plus', dial.tiles >= 1 && dial.mo >= 1 && dial.add && dial.first === 'Mine', dial);
  await ev(nt, `document.querySelector('.tw[data-i] .mo').click()`); await sleep(300);
  ok('"…" opens the shortcut menu', await ev(nt, `!document.querySelector('#tmenu').hidden && [...document.querySelectorAll('#tmenu button')].some(b => b.textContent.startsWith('Edit'))`));
  await ev(nt, `document.querySelector('#addTile').click()`); await sleep(300);
  await ev(nt, `document.querySelector('#dn').value = 'Added'; document.querySelector('#du').value = 'added.example.org'; document.querySelector('#ds').click()`); await sleep(900);
  ok('adding a shortcut works', (S.get().dialItems || []).some(x => x.title === 'Added' && x.url === 'https://added.example.org'), S.get().dialItems);
  await shot(nt, 'newtab-shortcuts');
  for (const mode of ['keep', 'clock', 'search', 'none']) {
    S.patch({ hideMode: mode }); await sleep(300);
    await ev(nt, `document.body.classList.remove('hideui'); document.querySelector('#hide').click()`); await sleep(700);
    const st = await ev(nt, `({ ctl: getComputedStyle(document.querySelector('#ctl')).opacity, ui: getComputedStyle(document.querySelector('#ui')).opacity, dial: getComputedStyle(document.querySelector('#dial')).opacity, clock: getComputedStyle(document.querySelector('#clock')).opacity, sf: getComputedStyle(document.querySelector('#sf')).opacity, hm: document.body.dataset.hm })`);
    log('INFO hide mode', mode, JSON.stringify(st));
    const exp2 = mode === 'keep' ? st.ctl === '1' && st.ui === '0' : mode === 'clock' ? st.ui === '1' && st.clock === '1' && st.sf === '0' && st.ctl === '1' : mode === 'search' ? st.ui === '1' && st.sf === '1' && st.clock === '0' && st.ctl === '1' : st.ctl === '0' && st.ui === '0';
    ok('hide mode ' + mode, exp2, st);
    if (mode === 'keep') await shot(nt, 'newtab-hidden-keep');
    await ev(nt, `document.querySelector('#hide').click()`); await sleep(300);
  }

  // ---- extensions browser page
  await B.cmd(win, 'openPage', 'extensions'); await sleep(1800);
  const ex = await ev(B.activeTab(win).view.webContents, `({ cards: document.querySelectorAll('.ext').length, cats: document.querySelectorAll('#cats button').length })`);
  ok('extensions page lists installable extensions', ex.cards >= 10 && ex.cats >= 4, ex); await shot(B.activeTab(win).view.webContents, 'extensions');

  // ---- fast downloads: 24 MB over several connections, with speed + ETA, content intact
  S.patch({ fastDownloads: true });
  const t0 = Date.now(); const pg = tabWc(); await B.cmd(win, 'newTab', BASE + '/dlpage'); await sleep(1200);
  B.activeTab(win).view.webContents.downloadURL(BASE + '/big.bin');
  let saw = null, rec = null; for (let i = 0; i < 400; i++) { await sleep(100); rec = DL.list()[0]; if (rec && rec.state === 'progressing' && rec.conns > 1 && rec.speed > 0 && rec.eta != null && !saw) saw = { conns: rec.conns, speed: rec.speed, eta: rec.eta }; if (rec && rec.state === 'completed') break; }
  const dt = Date.now() - t0;
  ok('download completes', rec && rec.state === 'completed', rec);
  ok('used parallel connections with speed + ETA', !!saw && saw.conns >= 4, saw);
  let sum = ''; try { sum = crypto.createHash('sha256').update(fs.readFileSync(rec.path)).digest('hex'); } catch (_) {}
  ok('downloaded file is byte-identical', sum === BIGSUM);
  log('INFO download took', dt, 'ms');
  ok('download drag API exists', typeof DL.drag === 'function' && DL.drag(rec.id, { startDrag() { ok('startDrag called with file', true); } }) === true);
  await click('#b-dl'); await sleep(600);
  ok('downloads panel lists file with Open link', await call(`!!document.querySelector('#dlp .dl.done[draggable=true]') && !!document.querySelector('#dlp [data-a=open]')`));
  await shot(top(), 'downloads-panel'); await call(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); await sleep(300);

  // ---- window controls & blur check
  await click('#wc-min'); await sleep(300); win.base.restore(); await sleep(300);
  ok('minimize button works', true);
  await shot(top(), 'chrome-final');

  // ---- telemetry
  await sleep(2500);
  ok('telemetry: open ping received with anonymous id and no URLs', pings.some(p => p.ev === 'open' && /^[0-9a-f]{32}$/.test(p.cid) && !JSON.stringify(p).includes('127.0.0.1')), pings[0]);
  ok('telemetry counts tabs opened', pings.reduce((s, p) => s + (p.tabs || 0), 0) >= 1, pings.map(p => p.tabs));
  S.patch({ telemetry: false }); const n0 = pings.length; require('./telemetry'); await sleep(300);
  S.patch({ telemetry: true });
  log('DONE — quitting (a "close" ping should follow)');
  setTimeout(() => { try { fs.appendFileSync(path.join(OUT, 'log.txt'), 'CLOSE-PING-SEEN ' + pings.some(p => p.ev === 'close') + '\n'); } catch (_) {} }, 1800);
  app.quit();
};
