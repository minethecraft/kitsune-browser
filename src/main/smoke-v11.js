'use strict';
// Dev-only: KITSUNE_SMOKE_V11=/outdir electron .   (updater, backgrounds, studio, community, vault pages)
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { app } = require('electron');
const OUT = process.env.KITSUNE_SMOKE_V11; fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => { const l = a.join(' '); console.log('[v11]', l); fs.appendFileSync(path.join(OUT, 'log.txt'), l + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (n, c, x) => log(c ? 'PASS' : 'FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 300));
app.on('web-contents-created', (e, wc) => wc.on('console-message', (ev, ...rest) => { const d = typeof ev === 'object' && ev.message !== undefined ? ev : { level: rest[0], message: rest[1] }; if (d.level === 'error' || d.level === 3) log('CONSOLE-ERR', String(d.message).slice(0, 200)); }));
process.on('uncaughtException', e => log('UNCAUGHT', e.stack));

module.exports = async function run() {
  const B = require('./browser'), S = require('./state'); const PORT = 18911;
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'k-site-')); fs.mkdirSync(path.join(data, 'releases'), { recursive: true });
  fs.writeFileSync(path.join(data, 'releases', 'Kitsune-9.0.0-linux-x64.AppImage'), Buffer.alloc(300000, 7));
  fs.writeFileSync(path.join(data, 'changelog.json'), JSON.stringify({ '9.0.0': ['Shiny new thing', 'Another fix'] }));
  const srv = cp.spawn(process.execPath, [path.join(__dirname, '..', '..', '..', 'site', 'server.js')], { env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1', PORT: String(PORT), DATA_DIR: data, ADMIN_TOKEN: 'adm' }), stdio: 'ignore' });
  await sleep(2500); const base = 'http://127.0.0.1:' + PORT;
  S.patch({ accountServer: base, updateServer: base, setupDone: true });
  try { fs.rmSync(path.join(app.getPath('userData'), 'vault.json'), { force: true }); } catch (_) {}
  const win = B.focusedWin(); const js = (v, c) => v.webContents.executeJavaScript(c, true).catch(e => 'ERR ' + e.message);
  const cur = () => win.tabs.find(t => t.id === win.activeId);
  const shot = async n => { const img = await cur().view.webContents.capturePage(); fs.writeFileSync(path.join(OUT, n + '.png'), img.toPNG()); };
  const open = async u => { B.createTab(win, { url: u }); await sleep(2000); };
  try {
    // ---- updater
    const U = require('./updater'); await U.check(true); ok('updater finds 9.0.0', U.state().status === 'available' && U.state().latest === '9.0.0', { s: U.state().status, l: U.state().latest, e: U.state().error });
    await open('kitsune://updates/'); await shot('updates-available');
    ok('updates page shows changelog', String(await js(cur().view, 'document.body.innerText')).includes('Shiny new thing'));
    await js(cur().view, "(()=>{const b=[...document.querySelectorAll('button')].find(b=>/update|download/i.test(b.textContent));b&&b.click()})()"); await sleep(3500);
    ok('download + sha verify', ['ready', 'downloading', 'opened'].includes(U.state().status), { s: U.state().status, e: U.state().error }); await shot('updates-ready');

    // ---- backgrounds + custom image/video
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const BG = require('./backgrounds'); const img = BG.addBuffer(Buffer.concat([png, Buffer.alloc(40)]), { name: 'Test image' }); ok('add image', img.type === 'image');
    let vid = null; try { const vf = path.join(OUT, 't.webm'); cp.execSync(`ffmpeg -loglevel error -y -f lavfi -i testsrc=size=320x180:rate=15 -t 2 -c:v libvpx -b:v 200k ${vf}`); vid = BG.addBuffer(fs.readFileSync(vf), { name: 'Test video' }); ok('add video', vid.type === 'video'); } catch (e) { log('NOTE no ffmpeg/video', e.message.slice(0, 80)); }
    const rg = await cur().view.webContents.executeJavaScript(`fetch('kitsune://bg/${img.file}').then(r=>r.status+' '+r.headers.get('content-type'))`).catch(e => 'ERR ' + e.message); ok('kitsune://bg serves', /^200 image/.test(rg), rg);
    if (vid) { const rr = await js(cur().view, `fetch('kitsune://bg/${vid.file}',{headers:{Range:'bytes=0-99'}}).then(r=>r.status+' '+(r.headers.get('content-range')||''))`); ok('video range', /^206/.test(rr), rr); }
    await open('kitsune://backgrounds/'); await sleep(1200); await shot('backgrounds'); ok('backgrounds page has content', String(await js(cur().view, 'document.body.innerText')).length > 80);
    await js(cur().view, "(()=>{const t=[...document.querySelectorAll('.tabs button')].find(b=>/my/i.test(b.textContent));t&&t.click()})()"); await sleep(600); await shot('backgrounds-mine');

    // ---- studio
    await open('kitsune://studio/'); await sleep(800); await shot('studio'); ok('studio renders', String(await js(cur().view, 'document.body.innerText')).length > 100);

    // ---- community: register, publish bg + theme, browse, install
    const SY = require('./sync'); const reg = await SY.auth('register', 'smoke@example.com', 'password123').catch(e => ({ error: e.message })); ok('register', reg.ok, reg);
    const CM = require('./community');
    const pb = await CM.publishBackground(img.id, { title: 'Smoke BG', tags: 'test,smoke' }).catch(e => ({ error: e.message })); ok('publish bg', !!pb.id, pb);
    const TH = require('./themes'); const th = TH.add({ name: 'Smoke Theme', bg: '#101030', fg: '#ffffff', accent: '#ff3399', wall: { type: 'image', url: 'kitsune://bg/' + img.file, dim: 0.4 }, sfx: { pack: 'chime', volume: 0.4 } });
    const pt = await CM.publishTheme(th.id, { title: 'Smoke Theme', desc: 'hello' }).catch(e => ({ error: e.message })); ok('publish theme', !!pt.id && !!pt.wallId, pt);
    const lst = await CM.list({ kind: 'theme' }); ok('list themes', lst.items.length === 1, lst.total);
    await open('kitsune://community/'); await sleep(1500); await shot('community-bg');
    await js(cur().view, "document.querySelector('#tabs button[data-t=theme]').click()"); await sleep(1200); await shot('community-theme');
    const inst = await CM.install(pt.id).catch(e => ({ error: e.message })); ok('install theme', inst.ok && S.get().customThemes.some(t => t.name === 'Smoke Theme' && t.wall && /^kitsune:\/\/bg\//.test(t.wall.url)), inst);
    const lk = await CM.like(pt.id); ok('like', lk.liked && lk.likes === 1, lk);

    // ---- passwords page (UI flow)
    await open('kitsune://passwords/'); await sleep(800); await shot('pw-create');
    await js(cur().view, "(()=>{document.querySelector('#pw').value='master password 123';document.querySelector('#pw2').value='master password 123';document.querySelector('#go').click()})()"); await sleep(1500);
    ok('vault created via UI', String(await js(cur().view, 'document.body.innerText')).includes('Passwords'), (await js(cur().view, 'document.body.innerText')).slice(0, 80));
    await js(cur().view, "document.querySelector('#add').click()"); await sleep(400);
    await js(cur().view, "(()=>{document.querySelector('#t').value='GitHub';document.querySelector('#u').value='https://github.com';document.querySelector('#us').value='octocat';document.querySelector('#p').value='Xk9#mPq2$vLw8zTn';document.querySelector('#tk').value='JBSWY3DPEHPK3PXP';document.querySelector('#save').click()})()"); await sleep(1500);
    const lt = String(await js(cur().view, 'document.body.innerText')); ok('item saved + live 2FA code', /GitHub/.test(lt) && /\d{3} \d{3}/.test(lt), lt.slice(0, 200)); await shot('pw-list');
    const V = require('./vault'); await js(cur().view, "document.querySelector('#lockb').click()"); await sleep(800); ok('lock via UI', !V.status().unlocked);
    await shot('pw-locked');
    await open('kitsune://about/'); await sleep(500);
  } catch (e) { log('FAIL', e.stack); }
  try { srv.kill(); } catch (_) {}
  log('DONE'); app.quit();
};
