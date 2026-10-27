'use strict';
// Dev-only: exercises the assistant against a mock Nimbus server. KITSUNE_SMOKE_AI=/outdir
const fs = require('fs'), path = require('path'); const { app } = require('electron');
const OUT = process.env.KITSUNE_SMOKE_AI; fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => { const l = a.join(' '); console.log('[ai]', l); fs.appendFileSync(path.join(OUT, 'log.txt'), l + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.on('web-contents-created', (e, wc) => { wc.on('console-message', (ev, ...r) => { const d = typeof ev === 'object' && ev.message !== undefined ? ev : { level: r[0], message: r[1] }; if (d.level === 'error' || d.level === 3) log('console.error', String(d.message).slice(0, 300)); }); });
module.exports = async function () {
  const B = require('./browser'), S = require('./state'), N = require('./nimbus');
  await sleep(3500); const win = B.focusedWin();
  S.patch({ nimbusServer: 'http://127.0.0.1:8788' }); N.setToken('TESTKEY');
  B.createTab(win, { url: 'data:text/html,<title>Demo</title><body><h1>Hello page</h1><a href="https://example.org/">First link</a><input placeholder="search"></body>' });
  await sleep(1500);
  B.cmd(win, 'assistant', true); await sleep(1500);
  const js = (code) => win.ai.webContents.executeJavaScript(code, true).catch(e => 'ERR ' + e.message);
  const shot = async n => { const i = await win.ai.webContents.capturePage(); fs.writeFileSync(path.join(OUT, n + '-ai.png'), i.toPNG()); const t = await B.activeTab(win).view.webContents.capturePage(); fs.writeFileSync(path.join(OUT, n + '-tab.png'), t.toPNG()); };
  await js('boot()'); await sleep(1500);
  log('models', await js("document.querySelectorAll('#model option').length"));
  await shot('1-idle');
  await js("send('How many tabs are open?')"); await sleep(2500); await shot('2-assist');
  log('assistant reply', await js("document.querySelector('#log .m.a:last-child').innerText"));
  await js("document.querySelector('.seg button[data-m=cowork]').click(); document.querySelector('#reset').click()"); await sleep(300);
  await js("send('please click the first link')"); await sleep(2000);
  log('approval 1', await js("(document.querySelector('.ap .s')||{}).innerText"));
  await shot('3-approval');
  await js("document.querySelector('.ap:not(.done) .y').click()"); await sleep(1800);
  log('approval 2', await js("(document.querySelector('.ap:not(.done) .s')||{}).innerText"));
  await js("document.querySelector('.ap:not(.done) .y').click()"); await sleep(2500);
  log('final', await js("document.querySelector('#log .m.a:last-child').innerText"));
  log('url after click', B.activeTab(win).url);
  await shot('4-done');
  // deny flow
  await js("send('please click it again')"); await sleep(2200);
  log('deny: approval?', await js("!!document.querySelector('.ap:not(.done)')"));
  await js("document.querySelector('.ap:not(.done) .n').click()"); await sleep(1500);
  log('after deny', await js("[...document.querySelectorAll('#log > *')].slice(-4).map(e => e.className + ':' + e.innerText.replace(/\\n/g,' ')).join(' || ')"));
  await shot('5-denied');
  log('DONE'); app.quit();
};
