'use strict';
const $ = s => document.querySelector(s);
const call = (n, ...a) => kitsune.call(n, ...a);
const MAC = /Mac/.test(navigator.platform) || document.documentElement.dataset.platform === 'darwin';
const MOD = () => (K.platform === 'darwin' ? '⌘' : 'Ctrl+');
let snap = null, S = null, F = {}, downloads = [], bookmarks = [];
const tabEls = new Map();
const need = { panel: 0, toast: 0 };
let omniSeq = 0, sugg = [], selIdx = -1, omniTimer = 0, typing = false;

// ------------------------------------------------------------------ boot
(async function boot() {
  const st = await K.init();
  S = st.settings; F = st.features; snap = st.snapshot; downloads = st.downloads || [];
  document.querySelectorAll('[id]').forEach(() => {});
  paintIcons(); bindStatic(); buildPetals();
  bookmarks = await call('bm.list');
  document.body.classList.toggle('bar-on', !!S.showBookmarksBar);
  if (snap) renderAll();
  renderBar();

  kitsune.on('tabs', s => { snap = s; renderAll(); });
  kitsune.on('settings', s => { S = s; document.body.classList.toggle('bar-on', !!S.showBookmarksBar); buildPetals(); renderBar(); if (!$('#menu').hidden) buildMenu(); });
  kitsune.on('bookmarks', async () => { bookmarks = await call('bm.list'); renderBar(); });
  kitsune.on('downloads', d => { downloads = d; if (!$('#dlp').hidden) buildDl(); });
  kitsune.on('toast', (t, k) => toast(t, k));
  kitsune.on('find-result', r => { $('#find-count').textContent = r.total ? `${r.active}/${r.total}` : ($('#find-in').value ? 'No matches' : ''); });
  kitsune.on('cmd', c => {
    if (c === 'focusOmnibox') focusOmni('');
    else if (c === 'palette') focusOmni('>');
    else if (c === 'find') { const i = $('#find-in'); i.focus(); i.select(); }
    else if (c === 'closePopups') closePopups();
  });
  document.addEventListener('k:applied', () => buildPetals());
  addEventListener('blur', () => { if (!typing) closePopups(); });
  addEventListener('resize', () => renderBar());
  addEventListener('keydown', e => { if (e.key === 'Escape') { closePopups(); if (document.activeElement === $('#omni-in')) { $('#omni-in').blur(); updateOmni(true); } } });
})();

function paintIcons() {
  const set = (id, html) => { $(id).innerHTML = html + ($(id).innerHTML.includes('<b') || $(id).querySelector('.ring') ? '' : ''); };
  $('#newtab').innerHTML = I.plus; $('#back').innerHTML = I.back; $('#fwd').innerHTML = I.fwd; $('#reload').innerHTML = I.reload;
  $('#site').innerHTML = I.fox; $('#star').innerHTML = I.star;
  const prepend = (id, html) => $(id).insertAdjacentHTML('afterbegin', html);
  prepend('#b-ai', I.spark); prepend('#b-split', I.split); prepend('#b-reader', I.reader); prepend('#b-pip', I.pip); prepend('#b-shot', I.shot);
  prepend('#b-shield', I.shield); prepend('#b-dl', I.download); prepend('#b-menu', I.menu);
  $('.fi').innerHTML = I.find; $('#find-prev').innerHTML = I.up; $('#find-next').innerHTML = I.down; $('#find-close').innerHTML = I.close;
  $('#site svg').style.cssText = 'width:16px;height:16px';
  if (!F.split) $('#b-split').style.display = 'none';
  if (!F.assistant) $('#b-ai').style.display = 'none';
}

// ------------------------------------------------------------------ decorative petals
function buildPetals() {
  const fx = $('#fx'); fx.innerHTML = '';
  if (K.effectiveAnim() !== 'full') return;
  for (let i = 0; i < 9; i++) {
    const s = document.createElement('span'); const w = 5 + Math.random() * 7;
    s.style.cssText = `left:${Math.random() * 100}%;width:${w}px;height:${K.settings.theme === 'neon' || K.settings.theme === 'rain' ? w * 2.2 : w}px;animation-duration:${6 + Math.random() * 7}s;animation-delay:${-Math.random() * 10}s`;
    fx.appendChild(s);
  }
}

// ------------------------------------------------------------------ rendering
const cont = id => (S.containers || []).find(c => c.id === id);
function nameFor(t) {
  if (/^kitsune:\/\/newtab/.test(t.url)) return 'New Tab';
  return t.title || K.host(t.url) || t.url || 'New Tab';
}
function mkTab(t) {
  const el = document.createElement('div');
  el.className = 'tab enter'; el.draggable = true; el.dataset.id = t.id;
  el.innerHTML = '<span class="fav"></span><span class="ttl"></span><span class="aud"></span><button class="x" tabindex="-1"></button>';
  el.querySelector('.x').innerHTML = I.close;
  el.addEventListener('animationend', e => { if (e.animationName === 'tabIn') el.classList.remove('enter'); });
  el.addEventListener('mousedown', e => { if (e.button === 0 && !e.target.closest('.x') && !e.target.closest('.aud')) call('tab.activate', +el.dataset.id); });
  el.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); call('tab.close', +el.dataset.id); } });
  el.addEventListener('contextmenu', e => { e.preventDefault(); call('tab.menu', +el.dataset.id); });
  el.querySelector('.x').addEventListener('click', e => { e.stopPropagation(); call('tab.close', +el.dataset.id); });
  el.querySelector('.aud').addEventListener('click', e => { e.stopPropagation(); call('cmd', 'mute', +el.dataset.id); });
  el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/kitsune-tab', el.dataset.id); e.dataTransfer.effectAllowed = 'move'; });
  el.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('text/kitsune-tab')) return; e.preventDefault();
    const r = el.getBoundingClientRect(); const before = e.clientX < r.left + r.width / 2;
    clearDrop(); el.classList.add(before ? 'dropb' : 'dropa'); el._before = before;
  });
  el.addEventListener('dragleave', () => { el.classList.remove('dropb', 'dropa'); });
  el.addEventListener('drop', e => {
    e.preventDefault(); const id = +e.dataTransfer.getData('text/kitsune-tab'); clearDrop();
    if (id === +el.dataset.id) return;
    let beforeId = +el.dataset.id;
    if (!el._before) { const n = el.nextElementSibling; while (n && n.classList.contains('leave')) n = n.nextElementSibling; beforeId = n ? +n.dataset.id : null; }
    call('tab.move', id, beforeId);
  });
  el.addEventListener('dragend', clearDrop);
  return el;
}
function clearDrop() { document.querySelectorAll('.dropb,.dropa').forEach(x => x.classList.remove('dropb', 'dropa')); }

function paintFav(el, t) {
  const fav = el.querySelector('.fav'); const sig = (t.loading ? 'L' : '') + '|' + t.favicon + '|' + (/^kitsune:/.test(t.url) ? 'k' : '') + '|' + t.sleeping;
  if (fav._sig === sig) return; fav._sig = sig;
  fav.classList.toggle('spin', !!t.loading); fav.innerHTML = '';
  if (t.loading) return;
  if (t.sleeping) { fav.innerHTML = I.moon; return; }
  if (/^kitsune:/.test(t.url)) { fav.innerHTML = I.fox; return; }
  if (t.favicon) { const im = new Image(); im.src = t.favicon; im.onerror = () => { fav.innerHTML = I.globe; }; fav.appendChild(im); } else fav.innerHTML = I.globe;
}

function renderTabs() {
  const ws = snap.workspace;
  const list = snap.tabs.filter(t => ws === 'all' || t.container === ws || t.pinned);
  const strip = $('#tabs'); const seen = new Set();
  let prev = null;
  for (const t of list) {
    seen.add(t.id);
    let el = tabEls.get(t.id);
    if (!el) { el = mkTab(t); tabEls.set(t.id, el); strip.appendChild(el); }
    el.classList.toggle('active', t.id === snap.activeId);
    el.classList.toggle('split', t.id === snap.splitId);
    el.classList.toggle('pinned', t.pinned); el.classList.toggle('sleep', t.sleeping);
    el.classList.toggle('audible', t.audible && !t.muted); el.classList.toggle('muted', t.muted);
    const name = nameFor(t); const ttl = el.querySelector('.ttl'); if (ttl.textContent !== name) ttl.textContent = name;
    el.title = name + (t.sleeping ? ' (sleeping)' : '');
    const aud = el.querySelector('.aud'); if (t.audible || t.muted) { const w = t.muted ? 'm' : 's'; if (aud._w !== w) { aud._w = w; aud.innerHTML = t.muted ? I.mute : I.sound; } }
    const c = cont(t.container); if (c && F.containers && t.container !== 'default') el.style.setProperty('--c', c.color); else el.style.removeProperty('--c');
    paintFav(el, t);
    // keep DOM order identical to state order
    const want = prev ? prev.nextElementSibling : strip.firstElementChild;
    if (want !== el) {
      let ref = want; while (ref && ref !== el && ref.classList.contains('leave')) ref = ref.nextElementSibling;
      if (ref !== el) strip.insertBefore(el, want);
    }
    prev = el;
  }
  for (const [id, el] of tabEls) if (!seen.has(id)) {
    tabEls.delete(id); el.classList.add('leave'); el.classList.remove('enter'); setTimeout(() => el.remove(), 200);
  }
  strip.classList.toggle('crowded', list.length > 9);
}

function displayUrl(u) {
  if (!u || /^kitsune:\/\/newtab/.test(u)) return null;
  if (/^kitsune:\/\//.test(u)) return { host: u.replace(/\/$/, ''), rest: '' };
  try { const x = new URL(u); const host = x.host.replace(/^www\./, ''); let rest = (x.pathname + x.search + x.hash).replace(/^\/$/, ''); return { host, rest: x.protocol === 'http:' ? rest : rest, scheme: x.protocol }; } catch (_) { return { host: u, rest: '' }; }
}

function updateOmni(force) {
  const a = snap.tabs.find(t => t.id === snap.activeId); const inp = $('#omni-in');
  const focused = document.activeElement === inp;
  const url = a ? a.url : '';
  const shown = /^kitsune:\/\/newtab/.test(url) ? '' : url;
  if (!focused || force) { inp.value = shown; typing = false; }
  const d = displayUrl(url);
  $('#urlview').innerHTML = d ? `<b>${K.esc(d.host)}</b><em>${K.esc(d.rest.length > 80 ? d.rest.slice(0, 80) + '…' : d.rest)}</em>` : `<span class="ph">Search or enter address</span>`;
  const site = $('#site'); site.classList.remove('ok', 'bad');
  if (a && /^https:/.test(url)) { site.innerHTML = I.lock; site.classList.add('ok'); } else if (a && /^http:/.test(url)) { site.innerHTML = I.warn; site.classList.add('bad'); } else site.innerHTML = I.fox;
  site.querySelector('svg').style.cssText = 'width:16px;height:16px';
  site.title = a && /^https:/.test(url) ? 'Connection is secure' : a && /^http:/.test(url) ? 'Connection is not secure' : 'Kitsune';
}

function renderAll() {
  renderTabs();
  const a = snap.tabs.find(t => t.id === snap.activeId);
  $('#back').disabled = !(a && a.canBack); $('#fwd').disabled = !(a && a.canFwd);
  $('#reload').innerHTML = a && a.loading ? I.stop : I.reload; $('#reload').title = a && a.loading ? 'Stop' : 'Reload';
  $('#progress').classList.toggle('on', !!(a && a.loading));
  $('#star').innerHTML = snap.bookmarked ? I.starFill : I.star; $('#star').classList.toggle('on', snap.bookmarked);
  $('#b-split').classList.toggle('on', !!snap.splitId); $('#b-ai').classList.toggle('on', !!snap.aiOpen);
  $('#privpill').hidden = !snap.private;
  const badge = $('.badge'); const n = a ? a.blocked : 0; badge.hidden = !n; badge.textContent = n > 99 ? '99+' : n;
  const dl = $('#b-dl'); const p = snap.downloads; dl.classList.toggle('active', !!(p && p.active));
  if (p && p.active) dl.querySelector('.ring').style.strokeDashoffset = String(94.2 * (1 - (p.progress || 0.05)));
  document.body.classList.toggle('find-on', !!snap.findOpen);
  updateOmni();
  if (!$('#shieldp').hidden) buildShield();
  if (!$('#menu').hidden) { const z = $('#zoomv'); if (z) z.textContent = snap.zoom + '%'; }
}

// ------------------------------------------------------------------ bookmarks bar
function renderBar() {
  const bar = $('#bar'); bar.innerHTML = '';
  if (!S || !S.showBookmarksBar) return;
  const items = bookmarks.filter(b => b.bar);
  const more = [];
  const room = bar.clientWidth - 60; let used = 0;
  for (const b of items) {
    const chip = document.createElement('button'); chip.className = 'chip'; chip.title = b.url;
    chip.innerHTML = `<img src="${K.favicon(b.url)}" onerror="this.style.display='none'"><span>${K.esc(b.title)}</span>`;
    chip.addEventListener('click', e => { if (e.ctrlKey || e.metaKey) call('cmd', 'newTab', b.url); else call('nav', b.url); });
    chip.addEventListener('auxclick', e => { if (e.button === 1) call('cmd', 'newTab', b.url); });
    chip.addEventListener('contextmenu', e => { e.preventDefault(); toast('Manage bookmarks in the Bookmarks page'); });
    bar.appendChild(chip);
    used += Math.min(chip.offsetWidth, 170) + 4;
    if (used > room) { chip.remove(); more.push(b); }
  }
  if (more.length) {
    const m = document.createElement('button'); m.className = 'chip more'; m.innerHTML = I.fwd.replace('width="18"', 'width="14"') + '<span>' + more.length + '</span>';
    m.addEventListener('click', () => openMore(more)); bar.appendChild(m);
  }
  if (!items.length) bar.innerHTML = '<span style="color:var(--muted);font-size:12px;padding:0 6px">Press ' + MOD() + 'D to bookmark pages — they show up here.</span>';
}
function openMore(list) {
  const p = $('#morep'); p.innerHTML = list.map(b => `<button class="mi" data-u="${K.esc(b.url)}"><i><img src="${K.favicon(b.url)}" width="16" height="16"></i><span>${K.esc(b.title)}</span></button>`).join('');
  p.querySelectorAll('.mi').forEach(x => x.addEventListener('click', () => { call('nav', x.dataset.u); closePopups(); }));
  showPanel(p);
}

// ------------------------------------------------------------------ panels & expansion
function syncExpand() { call('ui.expand', Math.max(need.panel, need.toast)); }
const chromeH = () => $('#chrome').offsetHeight;
function showPanel(el, opts) {
  opts = opts || {};
  ['#suggest', '#menu', '#shieldp', '#dlp', '#morep'].forEach(s => { if ($(s) !== el) $(s).hidden = true; });
  $('#overlay').hidden = false; el.hidden = false;
  el.style.top = (chromeH() + 6) + 'px'; if (snap && snap.h) el.style.maxHeight = Math.max(180, snap.h - chromeH() - 28) + 'px';
  $('#backdrop').style.background = opts.clear ? 'transparent' : '';
  requestAnimationFrame(() => { need.panel = Math.min(900, el.getBoundingClientRect().bottom + 14); syncExpand(); });
}
function closePopups() {
  if ($('#overlay').hidden && !need.panel) return;
  ['#suggest', '#menu', '#shieldp', '#dlp', '#morep'].forEach(s => { $(s).hidden = true; });
  need.panel = 0; if (!need.toast) $('#overlay').hidden = true; syncExpand();
  sugg = []; selIdx = -1;
}
$('#backdrop').addEventListener('mousedown', closePopups);

let toastTimer = 0;
function toast(text, kind) {
  const t = $('#toast'); t.textContent = text; t.className = kind || ''; t.hidden = false; t.style.top = (chromeH() + 10) + 'px';
  $('#overlay').hidden = false; need.toast = chromeH() + 56; syncExpand();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; need.toast = 0; if (!need.panel) $('#overlay').hidden = true; syncExpand(); }, 2000);
}

// ------------------------------------------------------------------ omnibox
function focusOmni(prefix) {
  const i = $('#omni-in'); i.focus();
  if (prefix) { i.value = prefix; typing = true; onOmniInput(); } else i.select();
}
function onOmniInput() {
  typing = true; clearTimeout(omniTimer);
  omniTimer = setTimeout(async () => {
    const text = $('#omni-in').value; const my = ++omniSeq;
    if (!text.trim()) { closePopups(); return; }
    const r = await call('omni.suggest', text);
    if (my !== omniSeq || document.activeElement !== $('#omni-in')) return;
    sugg = r; selIdx = r.length && r[0].type !== 'cmd' ? -1 : (r.length ? 0 : -1);
    renderSuggest();
  }, 70);
}
const TAGS = { tab: 'Switch to tab', bookmark: 'Bookmark', history: 'History', search: 'Search', cmd: 'Command', go: '' };
function renderSuggest() {
  const p = $('#suggest');
  if (!sugg.length) { closePopups(); return; }
  const o = $('#omni').getBoundingClientRect();
  p.style.left = o.left + 'px'; p.style.width = o.width + 'px'; p.style.right = 'auto';
  p.innerHTML = sugg.map((s, i) => {
    let ic = I.search;
    if (s.type === 'go') ic = /^https?:|^kitsune:/.test(s.url || '') && !/\s/.test($('#omni-in').value) && /[./:]/.test($('#omni-in').value) ? I.globe : I.search;
    if (s.type === 'cmd') ic = I.fox; if (s.type === 'bookmark') ic = I.star; if (s.type === 'history') ic = I.clock; if (s.type === 'tab') ic = s.icon ? `<img src="${K.esc(s.icon)}">` : I.globe;
    const label = s.type === 'go' ? (ic === I.globe ? 'Go to ' : 'Search for ') + '“' + s.title + '”' : s.title;
    return `<div class="sg${i === selIdx ? ' sel' : ''}" data-i="${i}"><span class="ic">${ic}</span><span class="t">${K.esc(label)}</span><span class="u">${s.type === 'go' || s.type === 'cmd' || s.type === 'search' ? '' : K.esc(K.host(s.url))}</span>${TAGS[s.type] ? `<span class="tag">${TAGS[s.type]}</span>` : ''}</div>`;
  }).join('');
  p.querySelectorAll('.sg').forEach(el => { el.addEventListener('mousedown', e => { e.preventDefault(); act(sugg[+el.dataset.i]); }); el.addEventListener('mousemove', () => { if (selIdx !== +el.dataset.i) { selIdx = +el.dataset.i; p.querySelectorAll('.sg').forEach((x, j) => x.classList.toggle('sel', j === selIdx)); } }); });
  showPanel(p, { clear: true });
}
function act(s, newTab) {
  if (!s) return;
  closePopups(); $('#omni-in').blur();
  if (s.type === 'tab') call('tab.activate', s.tabId);
  else if (s.type === 'cmd') { call('cmd', s.cmd.startsWith('page:') ? 'openPage' : s.cmd, s.cmd.startsWith('page:') ? s.cmd.slice(5) : undefined); }
  else if (newTab) call('cmd', 'newTab', s.url); else call('nav', s.url);
}
const oi = $('#omni-in');
oi.addEventListener('focus', () => { oi.select(); });
oi.addEventListener('blur', () => { setTimeout(() => { if (document.activeElement !== oi) { closePopups(); updateOmni(true); } }, 120); });
oi.addEventListener('input', onOmniInput);
oi.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!sugg.length) return; e.preventDefault();
    selIdx = (selIdx + (e.key === 'ArrowDown' ? 1 : -1) + sugg.length + 1) % (sugg.length + 1); if (selIdx === sugg.length) selIdx = -1;
    document.querySelectorAll('.sg').forEach((x, j) => x.classList.toggle('sel', j === selIdx));
    if (selIdx >= 0 && sugg[selIdx].type !== 'cmd' && sugg[selIdx].type !== 'go') oi.value = sugg[selIdx].url;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (selIdx >= 0) return act(sugg[selIdx], e.altKey);
    const v = oi.value.trim(); if (v.startsWith('>') && sugg[0]) return act(sugg[0]);
    closePopups(); oi.blur(); if (e.altKey) call('cmd', 'newTab', undefined).then(() => call('nav', v)); else call('nav', v);
  }
});

// ------------------------------------------------------------------ static buttons
function bindStatic() {
  $('#newtab').onclick = () => call('cmd', 'newTab');
  $('#back').onclick = () => call('cmd', 'back'); $('#fwd').onclick = () => call('cmd', 'forward');
  $('#reload').onclick = e => call('cmd', snap && snap.tabs.find(t => t.id === snap.activeId && t.loading) ? 'stop' : (e.shiftKey ? 'hardReload' : 'reload'));
  $('#star').onclick = () => call('cmd', 'bookmark');
  $('#b-ai').onclick = () => call('cmd', 'assistant'); $('#b-split').onclick = () => call('cmd', 'split'); $('#b-reader').onclick = () => call('cmd', 'reader');
  $('#b-pip').onclick = () => call('cmd', 'pip'); $('#b-shot').onclick = () => call('cmd', 'screenshot');
  $('#b-menu').onclick = () => { if (!$('#menu').hidden) return closePopups(); buildMenu(); showPanel($('#menu')); };
  $('#b-shield').onclick = () => { if (!$('#shieldp').hidden) return closePopups(); buildShield(); showPanel($('#shieldp')); };
  $('#b-dl').onclick = async () => { if (!$('#dlp').hidden) return closePopups(); downloads = await call('dl.list'); buildDl(); showPanel($('#dlp')); };
  $('#site').onclick = () => { if (!$('#shieldp').hidden) return closePopups(); buildShield(); showPanel($('#shieldp')); };
  const fi = $('#find-in');
  fi.addEventListener('input', () => call('find', fi.value, { next: false }));
  fi.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); call('find', fi.value, { next: true, forward: !e.shiftKey }); } if (e.key === 'Escape') call('cmd', 'closeFind'); });
  $('#find-next').onclick = () => call('find', fi.value, { next: true, forward: true }); $('#find-prev').onclick = () => call('find', fi.value, { next: true, forward: false });
  $('#find-close').onclick = () => call('cmd', 'closeFind');
  kitsune.on('cmd', c => { if (c === 'findClosed') { fi.value = ''; $('#find-count').textContent = ''; } });
}

// ------------------------------------------------------------------ menu
function buildMenu() {
  const m = $('#menu'); const M = MOD();
  const item = (cmd, icon, label, kb, arg) => `<button class="mi" data-c="${cmd}"${arg ? ` data-a="${arg}"` : ''}><i>${icon}</i><span>${label}</span><kbd>${kb || ''}</kbd></button>`;
  const themes = F.themes || [];
  const COL = { sakura: '#ff8fb8', neon: '#3df0ff', umbra: '#a77bff', aqua: '#4fd1ff', crimson: '#ff4d5e', dusk: '#ff9d4d', hanami: '#ffb3cf', rain: '#6cf5c2' };
  m.innerHTML =
    item('newTab', I.plus, 'New tab', M + 'T') + item('newWindow', I.globe, 'New window', M + 'N') + item('newPrivate', I.shield, 'New private window', M + 'Shift+N') + '<div class="sep"></div>' +
    item('openPage', I.anime, 'Anime Hub', '', 'anime') + item('openPage', I.book, 'Bookmarks', M + 'Shift+O', 'bookmarks') + item('openPage', I.clock, 'History', M + (MAC ? 'Y' : 'H'), 'history') + item('openPage', I.download, 'Downloads', M + 'J', 'downloads') + '<div class="sep"></div>' +
    `<div class="zoomrow"><span>Zoom</span><button class="ib sm" data-c="zoomOut">−</button><b id="zoomv">${snap ? snap.zoom : 100}%</b><button class="ib sm" data-c="zoomIn">+</button><button class="ib sm" data-c="zoomReset" title="Reset">↺</button></div><div class="sep"></div>` +
    item('find', I.find, 'Find in page', M + 'F') + (F.assistant ? item('assistant', I.spark, 'AI assistant', M + 'Shift+A') : '') + item('reader', I.reader, 'Reader view', 'F9') + (F.split ? item('split', I.split, 'Split view', '') : '') + item('pip', I.pip, 'Picture-in-picture', '') + item('screenshot', I.shot, 'Screenshot', M + 'Shift+S') + item('print', I.print, 'Print…', M + 'P') + item('pdf', I.download, 'Save page as PDF', '') + item('sleepOthers', I.moon, 'Sleep other tabs', '') + '<div class="sep"></div>' +
    `<div class="themes">${themes.map(t => `<span class="sw${S.theme === t ? ' cur' : ''}" data-t="${t}" title="${t}" style="background:${COL[t]}"></span>`).join('')}</div><div class="sep"></div>` +
    item('openPage', I.gear, 'Settings', M + ',', 'settings') + item('devtools', I.fox, 'Developer tools', 'F12');
  m.querySelectorAll('.mi, .zoomrow .ib').forEach(b => b.addEventListener('click', () => { const c = b.dataset.c; call('cmd', c, b.dataset.a); if (!/^zoom/.test(c)) closePopups(); }));
  m.querySelectorAll('.sw').forEach(s => s.addEventListener('click', () => { call('settings.set', { theme: s.dataset.t }); }));
}

// ------------------------------------------------------------------ shield panel
function buildShield() {
  const p = $('#shieldp'); const a = snap && snap.tabs.find(t => t.id === snap.activeId); const n = a ? a.blocked : 0;
  const lv = S.blocker;
  p.innerHTML = `<h4>Tracking protection</h4><div class="big">${n}</div><div class="sub">${n === 1 ? 'tracker' : 'trackers & ads'} blocked on ${K.esc(a ? (K.host(a.url) || 'this page') : 'this page')}</div>
  <div class="seg">${['off', 'standard', 'strict'].map(x => `<button data-l="${x}" class="${lv === x ? 'cur' : ''}">${x[0].toUpperCase() + x.slice(1)}</button>`).join('')}</div>
  <div class="row"><span>HTTPS-only mode</span><div class="tg ${S.httpsOnly ? 'on' : ''}" data-k="httpsOnly"></div></div>
  <div class="row"><span>Send Global Privacy Control</span><div class="tg ${S.sendGPC ? 'on' : ''}" data-k="sendGPC"></div></div>
  <div class="sub" style="padding-bottom:4px">Strict also blocks common ad & tracking URL patterns. Some sites may need Standard.</div>`;
  p.querySelectorAll('.seg button').forEach(b => b.onclick = async () => { await call('settings.set', { blocker: b.dataset.l }); call('cmd', 'reload'); });
  p.querySelectorAll('.tg').forEach(t => t.onclick = () => call('settings.set', { [t.dataset.k]: !S[t.dataset.k] }));
  if (!p.hidden) requestAnimationFrame(() => { need.panel = Math.min(900, p.getBoundingClientRect().bottom + 14); syncExpand(); });
}

// ------------------------------------------------------------------ downloads panel
function buildDl() {
  const p = $('#dlp'); const list = downloads.slice(0, 6);
  p.innerHTML = '<h4>Downloads</h4>' + (list.length ? list.map(d => {
    const pct = d.total ? Math.round(100 * d.received / d.total) : 0;
    const st = d.state === 'progressing' ? `${K.bytes(d.received)} of ${K.bytes(d.total) || '?'}${d.paused ? ' · paused' : ''}` : d.state === 'completed' ? K.bytes(d.total || d.received) : d.state;
    return `<div class="dl" data-id="${d.id}"><div class="n">${K.esc(d.name)}</div>${d.state === 'progressing' ? `<div class="pb"><i style="width:${pct}%"></i></div>` : ''}<div class="m"><span>${st}</span>${d.state === 'completed' ? '<a data-a="open">Open</a><a data-a="show">Show in folder</a>' : d.state === 'progressing' ? '<a data-a="pause">Pause/Resume</a><a data-a="cancel">Cancel</a>' : ''}</div></div>`;
  }).join('') : '<div class="sub">Nothing downloaded yet.</div>') + '<div class="sep"></div><button class="mi" id="dl-all"><i>' + I.folder + '</i><span>Show all downloads</span></button>';
  p.querySelectorAll('.dl a').forEach(a => a.onclick = () => call('dl.' + a.dataset.a, +a.closest('.dl').dataset.id));
  $('#dl-all').onclick = () => { call('cmd', 'openPage', 'downloads'); closePopups(); };
  if (!p.hidden) requestAnimationFrame(() => { need.panel = Math.min(900, p.getBoundingClientRect().bottom + 14); syncExpand(); });
}
