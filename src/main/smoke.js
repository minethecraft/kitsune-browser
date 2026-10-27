'use strict';
// Developer smoke test: KITSUNE_SMOKE=/path/to/outdir electron .   (never loaded in normal runs)
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const OUT = process.env.KITSUNE_SMOKE;
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => { const l = a.join(' '); console.log('[smoke]', l); fs.appendFileSync(path.join(OUT, 'log.txt'), l + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

app.on('web-contents-created', (e, wc) => {
  wc.on('console-message', (ev, ...rest) => {
    const d = (typeof ev === 'object' && ev.message !== undefined) ? ev : { level: rest[0], message: rest[1], lineNumber: rest[2], sourceId: rest[3] };
    const lvl = d.level; const lv = typeof lvl === 'string' ? lvl : ['verbose', 'info', 'warning', 'error'][lvl] || lvl;
    if (lv === 'error' || lv === 'warning' || lv === 3 || lv === 2) log('console.' + lv, '|', String(d.message).slice(0, 300), '|', String(d.sourceId || '').slice(-50) + ':' + (d.lineNumber || ''));
  });
  wc.on('did-fail-load', (e2, code, desc, url) => log('did-fail-load', code, desc, url));
  wc.on('render-process-gone', (e2, d) => log('render-process-gone', JSON.stringify(d)));
});
process.on('uncaughtException', e => log('UNCAUGHT', e.stack));

async function shot(win, name) {
  const meta = { size: win.base.getContentSize(), layers: [] };
  const add = async (view, label) => {
    try {
      const b = view.getBounds(); if (!b.width || !b.height) return;
      const img = await Promise.race([view.webContents.capturePage(), sleep(6000).then(() => null)]); if (!img) { log('capture-timeout', label, view.webContents.getURL(), 'loading=' + view.webContents.isLoading()); return; } const png = img.toPNG(); if (!png.length) return;
      fs.writeFileSync(path.join(OUT, `${name}-${label}.png`), png);
      meta.layers.push({ file: `${name}-${label}.png`, label, bounds: b });
    } catch (e) { log('shot-fail', label, e.message); }
  };
  const a = win.tabs.find(t => t.id === win.activeId);
  if (a && a.view) await add(a.view, 'tab');
  if (win.splitId) { const s = win.tabs.find(t => t.id === win.splitId); if (s && s.view) await add(s.view, 'split'); }
  if (win.side) await add(win.side, 'side');
  await add(win.top, 'top');
  fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(meta));
  log('shot', name, meta.size.join('x'), meta.layers.map(l => l.label).join(','));
}

module.exports = async function run() {
  const B = require('./browser'); const S = require('./state');
  await sleep(4000);
  const win = B.focusedWin(); if (!win) { log('NO WINDOW'); return app.quit(); }
  log('visible', win.base.isVisible(), 'minimized', win.base.isMinimized(), 'bounds', JSON.stringify(win.base.getContentBounds())); log('tabs', win.tabs.length, 'active', win.activeId, 'edition', S.EDITION);
  await shot(win, '01-newtab');
  const js = (v, code) => v.webContents.executeJavaScript(code, true).catch(e => 'ERR ' + e.message);

  B.createTab(win, { url: 'kitsune://settings/' }); await sleep(1500); await shot(win, '02-settings');
  B.createTab(win, { url: 'kitsune://anime/' }); await sleep(4000); await shot(win, '03-anime');
  B.createTab(win, { url: 'kitsune://history/' }); B.createTab(win, { url: 'kitsune://bookmarks/' }); await sleep(1200); await shot(win, '04-bookmarks');

  log('menu click ->', await js(win.top, "document.querySelector('#b-menu').click(); 'ok'")); await sleep(700); await shot(win, '05-menu');
  await js(win.top, "document.querySelector('#backdrop').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))"); await sleep(300);

  log('omni typing ->', await js(win.top, "(()=>{const i=document.querySelector('#omni-in');i.focus();i.value='anime';i.dispatchEvent(new Event('input'));return 'ok'})()")); await sleep(1800); await shot(win, '06-suggest');
  await js(win.top, "document.querySelector('#omni-in').blur()"); await sleep(400);

  B.cmd(win, 'find'); await sleep(400); await shot(win, '07-find'); B.cmd(win, 'closeFind');
  const st = B.snapshot(win); log('snapshot tabs', st.tabs.map(t => t.title || t.url).join(' | '));

  // error page + split + container + sleep
  B.createTab(win, { url: 'http://127.0.0.1:1/' }); await sleep(2500); await shot(win, '08-error');
  B.cmd(win, 'split'); await sleep(900); await shot(win, '09-split'); B.cmd(win, 'split');
  const t0 = win.tabs[1]; B.cmd(win, 'sleep', t0.id); await sleep(200); log('sleep tab ->', t0.sleeping);
  S.patch({ theme: 'neon' }); await sleep(900); await shot(win, '10-neon');
  B.cmd(win, 'closeTab'); await sleep(300); log('after close tabs', win.tabs.length);
  B.cmd(win, 'newPrivate'); await sleep(2500); const pw = B.focusedWin(); await shot(pw, '11-private');
  log('DONE'); app.quit();
};
