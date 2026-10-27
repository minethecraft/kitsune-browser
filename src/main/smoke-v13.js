'use strict';
// Dev-only: KITSUNE_SMOKE_V13=/outdir electron .  (live Kiroku: connect, library, watching, tracker, UI)
const fs = require('fs'), path = require('path'), http = require('http'), cp = require('child_process');
const { app, session } = require('electron');
const OUT = process.env.KITSUNE_SMOKE_V13; fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => { const l = a.join(' '); console.log('[v13]', l); fs.appendFileSync(path.join(OUT, 'log.txt'), l + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (n, c, x) => log(c ? 'PASS' : 'FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 300));
app.on('web-contents-created', (e, wc) => wc.on('console-message', (ev, ...rest) => { const d = typeof ev === 'object' && ev.message !== undefined ? ev : { level: rest[0], message: rest[1] }; if (d.level === 'error' || d.level === 3) log('CONSOLE-ERR', String(d.message).slice(0, 200)); }));
module.exports = async function run() {
  const B = require('./browser'), S = require('./state'), KN = require('./kiroku-net');
  const vf = path.join(OUT, 'v.webm'); try { cp.execSync(`ffmpeg -loglevel error -y -f lavfi -i testsrc=size=160x90:rate=10 -t 40 -c:v libvpx -b:v 50k ${vf}`); } catch (e) { log('NOTE ffmpeg missing'); }
  const reports = []; const IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#a3c"/></svg>');
  const lib = [{ id: 'a1', anilist_id: 154587, title: 'Frieren: Beyond Journey\'s End', status: 'watched', rating: 10, episodes: 28, aniwatch: 'https://aniwatch.example/go/mal/52991', cover: IMG, progress: 'watched 28/28 episodes, last ep 28' }, { id: 'a2', anilist_id: 21, title: 'One Piece', status: 'towatch', episodes: 1100, cover: IMG }, { id: 'a3', anilist_id: 16498, title: 'Attack on Titan', status: 'watched', rating: 9, cover: IMG }];
  const watchingList = [{ id: 'a4', anilist_id: 145815, title: 'Solo Leveling', status: 'watching', episodes: 12, cover: IMG, progress: { episode: 5, total: 12, pct: 41, provider: 'crunchyroll', updatedAt: Date.now() - 3600e3, url: 'https://www.crunchyroll.com/watch/xyz' } }];
  const srv = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x'); const auth = q.headers.authorization || ''; const json = (c, o) => { r.writeHead(c, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
    if (u.pathname === '/video.webm') { r.writeHead(200, { 'content-type': 'video/webm', 'accept-ranges': 'bytes' }); return r.end(fs.readFileSync(vf)); }
    if (u.pathname === '/watch') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end('<html><head><title>Solo Leveling Episode 5 - Watch on Crunchyroll</title></head><body><h1>Solo Leveling</h1><video id="v" src="/video.webm" muted autoplay loop width="160"></video></body></html>'); }
    if (u.pathname === '/api/me') return q.headers.cookie && /sid=ok/.test(q.headers.cookie) ? json(200, { user: { id: 1, username: 'vibe' } }) : json(401, { error: 'Please sign in' });
    if (u.pathname === '/api/keys' && q.method === 'POST') { if (!/sid=ok/.test(q.headers.cookie || '')) return json(401, { error: 'Please sign in' }); let b = ''; q.on('data', d => b += d); return q.on('end', () => { const sc = JSON.parse(b).scope; json(200, sc === 'read' ? { key: 'kk_r_testkey' } : { setupCode: 'kiroku:' + Buffer.from(JSON.stringify({ s: 'http://127.0.0.1:18930', k: 'kk_i_testkey' })).toString('base64') }); }); }
    if (u.pathname === '/api/ingest/ping') return auth === 'Bearer kk_i_testkey' ? json(200, { ok: true, username: 'vibe' }) : json(401, { error: 'no' });
    if (u.pathname === '/api/ingest/progress') { let b = ''; q.on('data', d => b += d); return q.on('end', () => { if (auth !== 'Bearer kk_i_testkey') return json(401, { error: 'no' }); const o = JSON.parse(b); reports.push(o); json(200, { ok: true, matched: true, title: 'Solo Leveling', episode: 5, pct: Math.round(100 * o.time / o.duration) }); }); }
    if (u.pathname.startsWith('/api/v1')) { if (auth !== 'Bearer kk_r_testkey') return json(401, { error: { code: 'invalid_key', message: 'Missing or unknown API key.' } }); const p = u.pathname.slice(7);
      if (p === '/me') return json(200, { username: 'vibe' }); if (p === '/stats') return json(200, { watched: 2, watching: 1, towatch: 1, episodes: 33, avgRating: 9.5 });
      if (p === '/library') return json(200, { count: 3, items: lib.slice(+(u.searchParams.get('offset') || 0), +(u.searchParams.get('offset') || 0) + +(u.searchParams.get('limit') || 100)) });
      if (p === '/watching') return json(200, { items: watchingList }); if (p === '/history') return json(200, { items: watchingList }); }
    json(404, { error: 'nope' });
  });
  await new Promise(r => srv.listen(18930, '127.0.0.1', r));
  S.patch({ kirokuUrl: 'http://127.0.0.1:18930', setupDone: true, bgKiroku: true, kirokuTrack: true });
  const win = B.focusedWin(); const cur = () => win.tabs.find(t => t.id === win.activeId); const js = (v, c) => v.webContents.executeJavaScript(c, true).catch(e => 'ERR ' + e.message);
  const shot = async n => { fs.writeFileSync(path.join(OUT, n + '.png'), (await cur().view.webContents.capturePage()).toPNG()); };
  const open = async u => { B.createTab(win, { url: u }); await sleep(2200); };
  try {
    ok('starts disconnected', !KN.status().read && !KN.status().tracker);
    let e1 = null; try { await KN.autoConnect(); } catch (e) { e1 = e.message; } ok('autoConnect refuses when not signed in', !!e1 && /Sign in/.test(e1), e1);
    await session.fromPartition('persist:main').cookies.set({ url: 'http://127.0.0.1:18930/', name: 'sid', value: 'ok' });
    const st = await KN.autoConnect(); ok('autoConnect creates both keys', st.read && st.tracker, st);
    await sleep(500); ok('user from /me', KN.status().user === 'vibe', KN.status().user);
    const w = await KN.watching(); ok('watching normalised', w[0].title === 'Solo Leveling' && w[0].progress.pct === 41 && w[0].resume.includes('crunchyroll.com/watch'), w[0]);
    const l = await KN.library(); ok('library normalised', l.length === 3 && l[0].anilistId === 154587 && l[0].progress.watched === 28 && l[0].aniwatch.includes('aniwatch.example'), l[0].progress);
    const bad = await KN.connect({ readKey: 'kk_r_wrong' }).catch(e => e.message); ok('wrong read key rejected', /rejected/.test(String(bad)), bad);
    // new tab + hub + settings pages with live data
    await sleep(3000); await open('kitsune://anime/'); await sleep(2500); await shot('hub'); const t = String(await js(cur().view, 'document.body.innerText'));
    ok('hub shows continue watching + stats', /continue watching/i.test(t) && /Solo Leveling/.test(t) && /Resume/.test(t) && /9\.5/.test(t), t.slice(0, 200));
    ok('hub library is the live one', /Frieren/.test(t) || (await js(cur().view, 'document.querySelectorAll(".ac").length')) >= 1, t.length);
    await open('kitsune://newtab/'); await sleep(2500); await shot('newtab'); ok('newtab continue-watching row', /continue watching/i.test(String(await js(cur().view, "document.querySelector('#watching').innerText"))));
    await open('kitsune://settings/#anime'); await sleep(1200); await shot('settings-kiroku'); ok('settings shows connected', /Connected to Kiroku as vibe/.test(String(await js(cur().view, 'document.querySelector("#kn").innerText'))));
    // tracker: play a video on crunchyroll.com host inside a normal tab
    if (fs.existsSync(vf)) { await open('http://www.crunchyroll.com:18930/watch'); await sleep(9000); ok('tracker reported progress', reports.length >= 1 && reports[0].provider === 'crunchyroll' && /Solo Leveling/.test(reports[0].title || '') && reports[0].duration > 0, reports.slice(0, 1)); ok('last report recorded', KN.status().last && KN.status().last.ok, KN.status().last); }
    S.patch({ kirokuTrack: false }); const n0 = reports.length; await sleep(12000); ok('pause stops reporting', reports.length === n0, { n0, n: reports.length });
    KN.disconnect(); ok('disconnect clears keys', !KN.status().read && !KN.status().tracker);
  } catch (e) { log('FAIL', e.stack); }
  srv.close(); log('DONE'); app.quit();
};
