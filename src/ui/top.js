'use strict';
const $ = s => document.querySelector(s);
const call = (n, ...a) => kitsune.call(n, ...a);
const MAC = /Mac/.test(navigator.platform) || document.documentElement.dataset.platform === 'darwin';
const MOD = () => (K.platform === 'darwin' ? '⌘' : 'Ctrl+');
let snap = null, S = null, F = {}, downloads = [], bookmarks = [];
const tabEls = new Map();
const need = { panel: 0, toast: 0 };
let omniSeq = 0, sugg = [], selIdx = -1, omniTimer = 0, typing = false, lastActiveId = null, dlDragging = false;
const PANELS = ['#suggest', '#menu', '#shieldp', '#sitep', '#dlp', '#morep', '#ctxm', '#editp'];
const activeTab = () => snap && snap.tabs.find(t => t.id === snap.activeId);

// ------------------------------------------------------------------ boot
(async function boot() {
  const st = await K.init();
  S = st.settings; F = st.features; snap = st.snapshot; downloads = st.downloads || [];
  paintIcons(); bindStatic(); buildPetals(); bindDnD(); bindWindowControls();
  bookmarks = await call('bm.list');
  document.body.classList.toggle('bar-on', !!S.showBookmarksBar);
  if (snap) renderAll();
  renderBar();

  let lastTabs = null; kitsune.on('tabs', s => { const n = s.tabs.length; if (lastTabs !== null && window.SFX) { if (n > lastTabs) SFX.play(s.tabs.find(t => t.id === s.activeId && /^kitsune:\/\/newtab/.test(t.url || '')) ? 'newTab' : 'tabOpen'); else if (n < lastTabs) SFX.play('tabClose'); } lastTabs = n; snap = s; renderAll(); });
  kitsune.on('settings', s => { S = s; document.body.classList.toggle('bar-on', !!S.showBookmarksBar); buildPetals(); renderBar(); if (!$('#menu').hidden) buildMenu(); });
  kitsune.on('bookmarks', async () => { bookmarks = await call('bm.list'); renderBar(); });
  kitsune.on('downloads', d => { if (window.SFX && downloads.length && d.filter(x => x.state === 'completed').length > downloads.filter(x => x.state === 'completed').length) SFX.play('success'); downloads = d; if (!$('#dlp').hidden && !dlDragging) buildDl(); });
  kitsune.on('update', u => { const b = $('#b-update'); const show = u.status === 'available' || u.status === 'ready' || u.status === 'downloading'; b.hidden = !show; b.title = u.status === 'available' ? 'Kitsune ' + u.latest + ' is available' : 'Update ' + u.status; });
  call('update.state').then(u => { const b = $('#b-update'); if (u && (u.status === 'available' || u.status === 'ready')) b.hidden = false; }).catch(() => {});
  kitsune.on('toast', (t, k) => { toast(t, k); if (window.SFX && k === 'error') SFX.play('error'); });
  kitsune.on('find-result', r => { $('#find-count').textContent = r.total ? `${r.active}/${r.total}` : ($('#find-in').value ? 'No matches' : ''); });
  kitsune.on('ctxmenu', m => showCtx(m.items, m.x, m.y));
  kitsune.on('cmd', (c, arg) => {
    if (c === 'focusOmnibox') focusOmni('', arg === 'clear');
    else if (c === 'palette') focusOmni('>');
    else if (c === 'find') { const i = $('#find-in'); i.focus(); i.select(); }
    else if (c === 'closePopups') closePopups();
    else if (c === 'editBookmark') { const b = bookmarks.find(x => x.id === arg); if (b) openEdit(b); }
  });
  document.addEventListener('k:applied', () => buildPetals());
  addEventListener('blur', () => { if (!typing) closePopups(); });
  addEventListener('resize', () => renderBar());
  addEventListener('keydown', onKey);
})();

function onKey(e) {
  if (e.key === 'Escape') { closePopups(); if (document.activeElement === $('#omni-in')) { $('#omni-in').blur(); updateOmni(true); } return; }
  const m = $('#ctxm');
  if (!m.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) {
    e.preventDefault();
    const items = [...m.querySelectorAll('.mi[data-i]:not(.dis)')]; if (!items.length) return;
    let i = items.findIndex(x => x.classList.contains('sel'));
    if (e.key === 'Enter') { if (i >= 0) items[i].click(); return; }
    items.forEach(x => x.classList.remove('sel')); i = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items[i].classList.add('sel'); items[i].scrollIntoView({ block: 'nearest' });
  }
}

const I_WIN = {
  min: '<svg viewBox="0 0 12 12"><path d="M1 6h10"/></svg>',
  max: '<svg viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9"/></svg>',
  restore: '<svg viewBox="0 0 12 12"><path d="M3.5 3.5v-2h7v7h-2"/><rect x="1.5" y="3.5" width="7" height="7"/></svg>',
  close: '<svg viewBox="0 0 12 12"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9"/></svg>'
};
function bindWindowControls() {
  if (K.platform === 'darwin') return;          // macOS keeps its native traffic lights
  $('#wc').hidden = false;
  $('#wc-min').innerHTML = I_WIN.min; $('#wc-max').innerHTML = I_WIN.max; $('#wc-x').innerHTML = I_WIN.close;
  $('#wc-min').onclick = () => call('win.min'); $('#wc-max').onclick = () => call('win.max'); $('#wc-x').onclick = () => call('win.close');
}

function paintIcons() {
  $('#newtab').innerHTML = I.plus; $('#back').innerHTML = I.back; $('#fwd').innerHTML = I.fwd; $('#reload').innerHTML = I.reload;
  $('#site').innerHTML = I.fox; $('#star').innerHTML = I.star;
  const prepend = (id, html) => $(id).insertAdjacentHTML('afterbegin', html);
  prepend('#b-ai', I.spark); prepend('#b-split', I.split); prepend('#b-reader', I.reader); prepend('#b-pip', I.pip); prepend('#b-shot', I.shot);
  prepend('#b-update', I.update); prepend('#b-shield', I.shield); prepend('#b-dl', I.download); prepend('#b-menu', I.menu);
  $('.fi').innerHTML = I.find; $('#find-prev').innerHTML = I.up; $('#find-next').innerHTML = I.down; $('#find-close').innerHTML = I.close;
  $('#site svg').style.cssText = 'width:16px;height:16px';
  if (!F.split) $('#b-split').style.display = 'none';
  if (!F.assistant) $('#b-ai').style.display = 'none';
}

// ------------------------------------------------------------------ tab-bar particles (same engine as the new tab page)
let stopFx = () => {};
function buildPetals() {
  stopFx(); stopFx = () => {};
  if (K.effectiveAnim() !== 'full') return;
  const t = K.particleType(); if (t === 'none') return;
  stopFx = Particles.start($('#fx'), t, { max: 18, min: 6 });
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
  el.addEventListener('contextmenu', e => { e.preventDefault(); call('tab.menu', +el.dataset.id, Math.round(e.clientX), Math.round(e.clientY)); });
  el.querySelector('.x').addEventListener('click', e => { e.stopPropagation(); call('tab.close', +el.dataset.id); });
  el.querySelector('.aud').addEventListener('click', e => { e.stopPropagation(); call('cmd', 'mute', +el.dataset.id); });
  el.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/kitsune-tab', el.dataset.id); e.dataTransfer.effectAllowed = 'copyMove';
    const t = snap && snap.tabs.find(x => x.id === +el.dataset.id); if (t && /^https?:/.test(t.url)) { e.dataTransfer.setData('text/uri-list', t.url); e.dataTransfer.setData('text/plain', t.url); }
  });
  el.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('text/kitsune-tab')) return; e.preventDefault();
    const r = el.getBoundingClientRect(); const before = e.clientX < r.left + r.width / 2;
    clearDrop(); el.classList.add(before ? 'dropb' : 'dropa'); el._before = before;
  });
  el.addEventListener('dragleave', () => { el.classList.remove('dropb', 'dropa'); });
  el.addEventListener('drop', e => {
    if (!e.dataTransfer.types.includes('text/kitsune-tab')) return;
    e.preventDefault(); const id = +e.dataTransfer.getData('text/kitsune-tab'); clearDrop();
    if (id === +el.dataset.id) return;
    let beforeId = +el.dataset.id;
    if (!el._before) { let n = el.nextElementSibling; while (n && n.classList.contains('leave')) n = n.nextElementSibling; beforeId = n ? +n.dataset.id : null; }
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
  strip.classList.toggle('crowded', list.length > 11);
}

function displayUrl(u) {
  if (!u || /^kitsune:\/\/newtab/.test(u)) return null;
  if (/^kitsune:\/\//.test(u)) return { host: u.replace(/\/$/, ''), rest: '' };
  try { const x = new URL(u); const host = x.host.replace(/^www\./, ''); let rest = (x.pathname + x.search + x.hash).replace(/^\/$/, ''); return { host, rest, scheme: x.protocol }; } catch (_) { return { host: u, rest: '' }; }
}

function updateOmni(force) {
  const a = activeTab(); const inp = $('#omni-in');
  const focused = document.activeElement === inp;
  const url = a ? a.url : '';
  const switched = snap.activeId !== lastActiveId; lastActiveId = snap.activeId;   // a different tab came to the front
  const shown = /^kitsune:\/\/newtab/.test(url) ? '' : url;
  if (!focused || force || (switched && !typing)) { inp.value = shown; typing = false; if (focused && switched && !shown) inp.select(); }
  const d = displayUrl(url);
  $('#urlview').innerHTML = d ? `<b>${K.esc(d.host)}</b><em>${K.esc(d.rest.length > 80 ? d.rest.slice(0, 80) + '…' : d.rest)}</em>` : `<span class="ph">Search or enter address</span>`;
  const site = $('#site'); site.classList.remove('ok', 'bad');
  if (a && /^https:/.test(url)) { site.innerHTML = I.lock; site.classList.add('ok'); } else if (a && /^http:/.test(url)) { site.innerHTML = I.warn; site.classList.add('bad'); } else site.innerHTML = I.fox;
  site.querySelector('svg').style.cssText = 'width:16px;height:16px';
  site.title = a && /^https:/.test(url) ? 'Connection is secure. Click for site info; drag to share or bookmark this page.' : a && /^http:/.test(url) ? 'Connection is not secure. Click for details.' : 'Kitsune';
}

function renderAll() {
  renderTabs();
  const a = activeTab();
  $('#back').disabled = !(a && a.canBack); $('#fwd').disabled = !(a && a.canFwd);
  $('#reload').innerHTML = a && a.loading ? I.stop : I.reload; $('#reload').title = a && a.loading ? 'Stop' : 'Reload';
  $('#progress').classList.toggle('on', !!(a && a.loading));
  $('#star').innerHTML = snap.bookmarked ? I.starFill : I.star; $('#star').classList.toggle('on', snap.bookmarked);
  $('#b-split').classList.toggle('on', !!snap.splitId); $('#b-ai').classList.toggle('on', !!snap.aiOpen);
  $('#privpill').hidden = !snap.private;
  const badge = $('#b-shield .badge'); const n = a ? a.blocked : 0; badge.hidden = !n; badge.textContent = n > 99 ? '99+' : n;
  const dl = $('#b-dl'); const p = snap.downloads; dl.classList.toggle('active', !!(p && p.active));
  if (p && p.active) dl.querySelector('.ring').style.strokeDashoffset = String(94.2 * (1 - (p.progress || 0.05)));
  document.body.classList.toggle('find-on', !!snap.findOpen);
  const wm = $('#wc-max'); if (wm && !$('#wc').hidden) { const r = snap.maximized ? I_WIN.restore : I_WIN.max; if (wm._i !== r) { wm._i = r; wm.innerHTML = r; wm.title = snap.maximized ? 'Restore down' : 'Maximize'; } }
  updateOmni();
  if (!$('#shieldp').hidden) buildShield();
  if (!$('#menu').hidden) { const z = $('#zoomv'); if (z) z.textContent = snap.zoom + '%'; }
}

// ------------------------------------------------------------------ bookmarks bar
function bmMenu(b, x, y) {
  showCtx([
    { label: 'Open', run: () => call('nav', b.url) },
    { label: 'Open in New Tab', run: () => call('cmd', 'newTab', b.url) },
    { label: 'Open in Private Window', run: () => call('cmd', 'privateUrl', b.url) },
    { type: 'sep' },
    { label: 'Edit…', run: () => openEdit(b) },
    { label: 'Copy Link Address', run: () => call('clip.write', b.url) },
    { label: b.bar ? 'Remove from Bookmarks Bar' : 'Show in Bookmarks Bar', run: () => call('bm.update', b.id, { bar: !b.bar }) },
    { type: 'sep' },
    { label: 'Delete', danger: true, run: () => call('bm.remove', b.id) }
  ], x, y);
}
function renderBar() {
  const bar = $('#bar'); bar.innerHTML = '';
  if (!S || !S.showBookmarksBar) return;
  const items = bookmarks.filter(b => b.bar);
  const more = [];
  const room = bar.clientWidth - 60; let used = 0;
  for (const b of items) {
    const chip = document.createElement('button'); chip.className = 'chip'; chip.title = b.title + '\n' + b.url + '\nRight-click to edit';
    chip.innerHTML = `<img src="${K.favicon(b.url)}" onerror="this.style.display='none'"><span>${K.esc(b.title)}</span>`;
    chip.addEventListener('click', e => { if (e.ctrlKey || e.metaKey) call('cmd', 'newTab', b.url); else call('nav', b.url); });
    chip.addEventListener('auxclick', e => { if (e.button === 1) call('cmd', 'newTab', b.url); });
    chip.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); bmMenu(b, e.clientX, e.clientY); });
    bar.appendChild(chip);
    used += Math.min(chip.offsetWidth, 170) + 4;
    if (used > room) { chip.remove(); more.push(b); }
  }
  if (more.length) {
    const m = document.createElement('button'); m.className = 'chip more'; m.title = more.length + ' more bookmarks'; m.innerHTML = I.fwd.replace('width="18"', 'width="14"') + '<span>' + more.length + '</span>';
    m.addEventListener('click', () => openMore(more)); bar.appendChild(m);
  }
  if (!items.length) bar.innerHTML = '<span style="color:var(--muted);font-size:12px;padding:0 6px">Press ' + MOD() + 'D to bookmark pages, or drag the lock icon here. They show up here.</span>';
}
$('#bar').addEventListener('contextmenu', e => {
  e.preventDefault();
  const a = activeTab(); const can = a && /^(https?|file):/.test(a.url);
  showCtx([
    { label: snap && snap.bookmarked ? 'Edit Bookmark for This Page…' : 'Bookmark This Page', enabled: !!can, run: () => { if (snap && snap.bookmarked) { const b = bookmarks.find(x => x.url === a.url); if (b) openEdit(b); } else call('cmd', 'bookmark'); } },
    { label: 'Manage Bookmarks', run: () => call('cmd', 'openPage', 'bookmarks') },
    { type: 'sep' },
    { label: 'Hide Bookmarks Bar', run: () => call('settings.set', { showBookmarksBar: false }) }
  ], e.clientX, e.clientY);
});
function openMore(list) {
  const p = $('#morep');
  if (!p.hidden) return closePopups();             // second press closes it
  p.innerHTML = list.map((b, i) => `<button class="mi" data-i="${i}"><i><img src="${K.favicon(b.url)}" width="16" height="16"></i><span>${K.esc(b.title)}</span></button>`).join('');
  p.querySelectorAll('.mi').forEach(x => {
    const b = list[+x.dataset.i];
    x.addEventListener('click', () => { call('nav', b.url); closePopups(); });
    x.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); bmMenu(b, e.clientX, e.clientY); });
  });
  showPanel(p);
}

// ------------------------------------------------------------------ bookmark editor (also used when you drop a link on the bar)
function openEdit(b) {
  const p = $('#editp'); const isNew = !b.id;
  p.innerHTML = `<h4>${isNew ? 'Add bookmark' : 'Edit bookmark'}</h4>
    <label>Name</label><input type="text" id="ed-t" value="${K.esc(b.title || '')}" spellcheck="false">
    <label>Address</label><input type="text" id="ed-u" value="${K.esc(b.url || '')}" spellcheck="false">
    <label class="chk"><input type="checkbox" id="ed-b" ${b.bar !== false ? 'checked' : ''}> Show in the bookmarks bar</label>
    <div class="btns">${isNew ? '' : '<button class="pbtn dng" id="ed-d">Delete</button>'}<span class="sp"></span><button class="pbtn" id="ed-c">Cancel</button><button class="pbtn pri" id="ed-s">Save</button></div>`;
  showPanel(p, { clear: true });
  const fix = u => { u = u.trim(); return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u; };
  const save = async () => {
    const t = $('#ed-t').value.trim(), u = fix($('#ed-u').value); if (!u || u === 'https://') return;
    const patch = { title: t || K.host(u) || u, url: u, bar: $('#ed-b').checked };
    if (isNew) await call('bm.add', patch); else await call('bm.update', b.id, patch);
    closePopups(); toast(isNew ? 'Bookmark added' : 'Bookmark saved', 'ok');
  };
  $('#ed-s').onclick = save; $('#ed-c').onclick = closePopups;
  if ($('#ed-d')) $('#ed-d').onclick = async () => { await call('bm.remove', b.id); closePopups(); toast('Bookmark deleted'); };
  p.querySelectorAll('input[type=text]').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } }));
  setTimeout(() => { const i = $('#ed-t'); if (i) { i.focus(); i.select(); } }, 30);
}

// ------------------------------------------------------------------ panels & expansion
function syncExpand() { call('ui.expand', Math.max(need.panel, need.toast)); }
const chromeH = () => $('#chrome').offsetHeight;
function showPanel(el, opts) {
  opts = opts || {};
  PANELS.forEach(s => { if ($(s) !== el) $(s).hidden = true; });
  $('#overlay').hidden = false; el.hidden = false; document.body.classList.toggle('ctx-on', el.id === 'ctxm');   // menus can sit on top of the toolbar
  if (opts.at) { el.style.left = opts.at.x + 'px'; el.style.top = opts.at.y + 'px'; el.style.right = 'auto'; el.style.maxHeight = ''; }
  else { el.style.top = (chromeH() + 6) + 'px'; if (snap && snap.h) el.style.maxHeight = Math.max(180, snap.h - chromeH() - 28) + 'px'; }
  requestAnimationFrame(() => { need.panel = opts.full ? (snap && snap.h) || 900 : Math.min(900, (el.offsetTop + el.offsetHeight) + 14); syncExpand(); });
}
function closePopups() {
  if ($('#overlay').hidden && !need.panel) return;
  const hadCtx = !$('#ctxm').hidden;
  PANELS.forEach(s => { $(s).hidden = true; }); document.body.classList.remove('ctx-on');
  need.panel = 0; if (!need.toast) $('#overlay').hidden = true; syncExpand();
  sugg = []; selIdx = -1; if (hadCtx) call('ctx.close');
}
$('#backdrop').addEventListener('mousedown', closePopups);
$('#backdrop').addEventListener('contextmenu', e => { e.preventDefault(); closePopups(); });

let toastTimer = 0;
function toast(text, kind) {
  const t = $('#toast'); t.textContent = text; t.className = kind || ''; t.hidden = false; t.style.top = (chromeH() + 10) + 'px';
  $('#overlay').hidden = false; need.toast = chromeH() + 56; syncExpand();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; need.toast = 0; if (!need.panel) $('#overlay').hidden = true; syncExpand(); }, 2000);
}

// ------------------------------------------------------------------ custom context menu (replaces the OS menu everywhere)
/** items: { label, icon?, kbd?, enabled?, danger?, checked?, type: 'sep'|'hd', run? | id? } */
function showCtx(items, x, y) {
  const m = $('#ctxm');
  m.innerHTML = items.map((it, i) => it.type === 'sep' ? '<div class="sep"></div>' : it.type === 'hd' ? `<div class="mi hd"><span>${K.esc(it.label)}</span></div>`
    : `<button class="mi${it.enabled === false ? ' dis' : ''}${it.danger ? ' danger' : ''}${it.checked ? ' chk' : ''}" data-i="${i}"><i>${it.icon || ''}</i><span>${K.esc(it.label)}</span><kbd>${K.esc(it.kbd || '')}</kbd></button>`).join('');
  m.querySelectorAll('.mi[data-i]').forEach(b => {
    b.onclick = () => { const it = items[+b.dataset.i]; const run = it.run, id = it.id; m.querySelectorAll('.mi').forEach(n => n.classList.remove('sel')); $('#ctxm').hidden = true; closePopups(); if (run) run(); else if (id) call('ctx.run', id); };
    b.onmousemove = () => { m.querySelectorAll('.mi.sel').forEach(n => n.classList.remove('sel')); };
  });
  showPanel(m, { clear: true, full: true, at: { x: Math.max(4, x), y: Math.max(4, y) } });
  const H = (snap && snap.h) || innerHeight, Wd = innerWidth;
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(6, Math.min(x, Wd - w - 8)) + 'px';
  m.style.top = Math.max(6, y + h > H - 6 ? Math.max(6, y - h) : y) + 'px';
  m.style.transformOrigin = (y + h > H - 6 ? 'bottom' : 'top') + ' left';
}
$('#ctxm').addEventListener('mousedown', e => e.preventDefault());   // keep focus (and the address bar text) where it was

// ------------------------------------------------------------------ omnibox
function focusOmni(prefix, clear) {
  const i = $('#omni-in');
  if (clear) { i.value = ''; typing = false; }
  i.focus();
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
oi.addEventListener('blur', () => { setTimeout(() => { if (document.activeElement !== oi && $('#ctxm').hidden) { closePopups(); updateOmni(true); } }, 120); });
oi.addEventListener('input', onOmniInput);
oi.addEventListener('contextmenu', async e => {
  e.preventDefault(); e.stopPropagation();
  const sel = oi.selectionStart !== oi.selectionEnd; const clip = await call('clip.read').catch(() => '');
  const ed = fn => () => { oi.focus(); fn(); };
  showCtx([
    { label: 'Cut', kbd: MOD() + 'X', enabled: sel, run: ed(() => document.execCommand('cut')) },
    { label: 'Copy', kbd: MOD() + 'C', enabled: sel, run: ed(() => document.execCommand('copy')) },
    { label: 'Paste', kbd: MOD() + 'V', enabled: !!clip, run: ed(() => { document.execCommand('insertText', false, clip); onOmniInput(); }) },
    { label: 'Paste and Go', enabled: !!clip, run: () => call('nav', clip.trim()) },
    { type: 'sep' },
    { label: 'Select All', kbd: MOD() + 'A', run: ed(() => oi.select()) }
  ], e.clientX, e.clientY);
});
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

// ------------------------------------------------------------------ drag & drop of links
// Dragging the lock (or the star) out gives you the page's link. Dropping a link on the tab bar opens it in a new tab,
// dropping it on the bookmarks bar (or the star) bookmarks it.
function linkFromDrop(dt) {
  if (!dt) return null;
  const types = [...dt.types];
  const uris = types.includes('text/uri-list') ? dt.getData('text/uri-list').split(/\r?\n/).filter(l => l && !l.startsWith('#')) : [];
  let url = uris[0] || '', title = '';
  const moz = types.includes('text/x-moz-url') ? dt.getData('text/x-moz-url').split(/\r?\n/) : [];
  if (!url && moz[0]) url = moz[0];
  if (moz[1]) title = moz[1];
  if (!url && types.includes('text/plain')) { const t = dt.getData('text/plain').trim(); if (/^(https?|file):\/\/\S+$/i.test(t)) url = t; else if (/^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(t)) url = 'https://' + t; }
  if (!/^(https?|file):/i.test(url)) return null;
  if (!title && types.includes('text/html')) { const m = /<a[^>]*>([\s\S]*?)<\/a>/i.exec(dt.getData('text/html')); if (m) title = m[1].replace(/<[^>]+>/g, '').trim(); }
  if (!title && types.includes('text/x-kitsune-title')) title = dt.getData('text/x-kitsune-title');
  return { url, title: title || K.host(url) || url };
}
const isExtLink = e => { const t = [...(e.dataTransfer ? e.dataTransfer.types : [])]; return !t.includes('text/kitsune-tab') && (t.includes('text/uri-list') || t.includes('text/x-moz-url') || t.includes('text/plain')); };

function bindDnD() {
  const strip = $('#tabstrip'), bar = $('#bar'), star = $('#star'), site = $('#site');
  const on = () => document.body.classList.add('dragging-link'), off = () => { document.body.classList.remove('dragging-link'); clearDrop(); };
  document.addEventListener('dragenter', e => { if (isExtLink(e)) on(); });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) off(); });
  document.addEventListener('dragend', off); document.addEventListener('drop', off);

  // lock + star are link handles
  const handle = el => {
    el.addEventListener('dragstart', e => {
      const a = activeTab(); if (!a || !/^(https?|file):/.test(a.url)) { e.preventDefault(); return; }
      const dt = e.dataTransfer; dt.effectAllowed = 'copyLink';
      dt.setData('text/uri-list', a.url); dt.setData('text/plain', a.url); dt.setData('text/x-moz-url', a.url + '\n' + nameFor(a)); dt.setData('text/x-kitsune-title', nameFor(a));
      const g = document.createElement('div'); g.className = 'dragghost'; g.style.cssText = 'position:fixed;left:-999px;top:-999px;padding:7px 14px;border-radius:999px;background:var(--accent);color:var(--accent-fg);font:600 13px system-ui;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      g.textContent = '🔗 ' + nameFor(a); document.body.appendChild(g); dt.setDragImage(g, 16, 16); setTimeout(() => g.remove(), 0);
      on();
    });
    el.addEventListener('dragend', off);
  };
  handle(site); handle(star);

  // tab bar: open dropped links in new tabs
  strip.addEventListener('dragover', e => {
    if (!isExtLink(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    clearDrop(); const t = e.target.closest && e.target.closest('.tab');
    if (t) { const r = t.getBoundingClientRect(); const before = e.clientX < r.left + r.width / 2; t.classList.add(before ? 'dropb' : 'dropa'); t._before = before; }
    else { const last = [...document.querySelectorAll('#tabs .tab:not(.leave)')].pop(); if (last) last.classList.add('dropa'); }
  });
  strip.addEventListener('drop', e => {
    if (!isExtLink(e)) return; e.preventDefault(); const l = linkFromDrop(e.dataTransfer); const t = e.target.closest && e.target.closest('.tab'); clearDrop();
    if (!l) { toast('That isn’t a link'); return; }
    let beforeId = null;
    if (t) { if (t._before) beforeId = +t.dataset.id; else { let n = t.nextElementSibling; while (n && n.classList.contains('leave')) n = n.nextElementSibling; beforeId = n ? +n.dataset.id : null; } }
    call('tab.newAt', l.url, beforeId);
  });

  // bookmarks bar + star: bookmark dropped links
  const addDrop = el => {
    el.addEventListener('dragover', e => { if (!isExtLink(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    el.addEventListener('drop', async e => {
      if (!isExtLink(e)) return; e.preventDefault(); const l = linkFromDrop(e.dataTransfer); off();
      if (!l) { toast('That isn’t a link'); return; }
      if (bookmarks.some(b => b.url === l.url)) { toast('Already bookmarked'); return; }
      await call('bm.add', { url: l.url, title: l.title, bar: true }); toast('Bookmarked ★', 'ok');
    });
  };
  addDrop(bar); addDrop(star);
}

// ------------------------------------------------------------------ static buttons
function bindStatic() {
  $('#newtab').onclick = () => call('cmd', 'newTab');
  $('#back').onclick = () => call('cmd', 'back'); $('#fwd').onclick = () => call('cmd', 'forward');
  $('#reload').onclick = e => call('cmd', snap && snap.tabs.find(t => t.id === snap.activeId && t.loading) ? 'stop' : (e.shiftKey ? 'hardReload' : 'reload'));
  $('#star').onclick = () => call('cmd', 'bookmark');
  $('#star').addEventListener('contextmenu', e => {
    e.preventDefault(); const a = activeTab(); const b = a && bookmarks.find(x => x.url === a.url);
    if (b) openEdit(b); else if (a && /^(https?|file):/.test(a.url)) openEdit({ title: nameFor(a), url: a.url, bar: true });
  });
  $('#b-update').onclick = () => call('cmd', 'openPage', 'updates'); $('#b-ai').onclick = () => call('cmd', 'assistant'); $('#b-split').onclick = () => call('cmd', 'split'); $('#b-reader').onclick = () => call('cmd', 'reader');
  $('#b-pip').onclick = () => call('cmd', 'pip'); $('#b-shot').onclick = () => call('cmd', 'screenshot');
  $('#b-menu').onclick = () => { if (!$('#menu').hidden) return closePopups(); buildMenu(); showPanel($('#menu')); };
  $('#b-shield').onclick = () => { if (!$('#shieldp').hidden) return closePopups(); buildShield(); showPanel($('#shieldp')); };
  $('#b-dl').onclick = async () => { if (!$('#dlp').hidden) return closePopups(); downloads = await call('dl.list'); buildDl(); showPanel($('#dlp')); };
  $('#site').onclick = async () => { if (!$('#sitep').hidden) return closePopups(); await buildSite(); showPanel($('#sitep')); };
  const fi = $('#find-in');
  fi.addEventListener('input', () => call('find', fi.value, { next: false }));
  fi.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); call('find', fi.value, { next: true, forward: !e.shiftKey }); } if (e.key === 'Escape') call('cmd', 'closeFind'); });
  $('#find-next').onclick = () => call('find', fi.value, { next: true, forward: true }); $('#find-prev').onclick = () => call('find', fi.value, { next: true, forward: false });
  $('#find-close').onclick = () => call('cmd', 'closeFind');
  kitsune.on('cmd', c => { if (c === 'findClosed') { fi.value = ''; $('#find-count').textContent = ''; } });
  // the same custom menu for the find box
  fi.addEventListener('contextmenu', async e => {
    e.preventDefault(); const sel = fi.selectionStart !== fi.selectionEnd; const clip = await call('clip.read').catch(() => ''); const ed = fn => () => { fi.focus(); fn(); };
    showCtx([{ label: 'Cut', enabled: sel, run: ed(() => document.execCommand('cut')) }, { label: 'Copy', enabled: sel, run: ed(() => document.execCommand('copy')) }, { label: 'Paste', enabled: !!clip, run: ed(() => { document.execCommand('insertText', false, clip); fi.dispatchEvent(new Event('input')); }) }, { type: 'sep' }, { label: 'Select All', run: ed(() => fi.select()) }], e.clientX, e.clientY);
  });
}

// ------------------------------------------------------------------ menu
function buildMenu() {
  const m = $('#menu'); const M = MOD();
  const item = (cmd, icon, label, kb, arg) => `<button class="mi" data-c="${cmd}"${arg ? ` data-a="${arg}"` : ''}><i>${icon}</i><span>${label}</span><kbd>${kb || ''}</kbd></button>`;
  const themes = F.themes || [];
  const COL = { sakura: '#ff8fb8', neon: '#3df0ff', umbra: '#a77bff', aqua: '#4fd1ff', crimson: '#ff4d5e', dusk: '#ff9d4d', hanami: '#ffb3cf', rain: '#6cf5c2', aurora: '#5cffc4', matcha: '#a8e063', kitsune: '#ff7a1a', cosmos: '#7aa2ff', mono: '#e8e8e8' };
  m.innerHTML =
    item('newTab', I.plus, 'New tab', M + 'T') + item('newWindow', I.globe, 'New window', M + 'N') + item('newPrivate', I.shield, 'New private window', M + 'Shift+N') + '<div class="sep"></div>' +
    item('openPage', I.anime, 'Anime Hub', '', 'anime') + item('openPage', I.book, 'Bookmarks', M + 'Shift+O', 'bookmarks') + item('openPage', I.clock, 'History', M + (MAC ? 'Y' : 'H'), 'history') + item('openPage', I.download, 'Downloads', M + 'J', 'downloads') + (F.extensions ? item('openPage', I.pin, 'Extensions', '', 'extensions') : '') + '<div class="sep"></div>' +
    `<div class="zoomrow"><span>Zoom</span><button class="ib sm" data-c="zoomOut">−</button><b id="zoomv">${snap ? snap.zoom : 100}%</b><button class="ib sm" data-c="zoomIn">+</button><button class="ib sm" data-c="zoomReset" title="Reset">↺</button></div><div class="sep"></div>` +
    item('find', I.find, 'Find in page', M + 'F') + (F.assistant ? item('assistant', I.spark, 'AI assistant', M + 'Shift+A') : '') + item('reader', I.reader, 'Reader view', 'F9') + (F.split ? item('split', I.split, 'Split view', '') : '') + item('pip', I.pip, 'Picture-in-picture', '') + item('screenshot', I.shot, 'Screenshot', M + 'Shift+S') + item('print', I.print, 'Print…', M + 'P') + item('pdf', I.download, 'Save page as PDF', '') + item('sleepOthers', I.moon, 'Sleep other tabs', '') + '<div class="sep"></div>' +
    `<div class="themes">${themes.map(t => `<span class="sw${S.theme === t ? ' cur' : ''}" data-t="${t}" title="${t}" style="background:${COL[t] || '#888'}"></span>`).join('')}</div><div class="sep"></div>` +
    item('openPage', I.palette, 'Backgrounds & themes', '', 'backgrounds') + item('openPage', I.key, 'Passwords', '', 'passwords') + item('openPage', I.users, 'Community', '', 'community') + item('openPage', I.update, 'Update Kitsune', '', 'updates') + item('openPage', I.gear, 'Settings', M + ',', 'settings') + item('devtools', I.fox, 'Developer tools', 'F12');
  m.querySelectorAll('.mi, .zoomrow .ib').forEach(b => b.addEventListener('click', () => { const c = b.dataset.c; call('cmd', c, b.dataset.a); if (!/^zoom/.test(c)) closePopups(); }));
  m.querySelectorAll('.sw').forEach(s => s.addEventListener('click', () => { call('settings.set', { theme: s.dataset.t }); }));
}

// ------------------------------------------------------------------ site information (the lock)
const PERM_LABEL = { media: 'Camera & microphone', geolocation: 'Location', notifications: 'Notifications', midi: 'MIDI devices', 'clipboard-read': 'Clipboard (read)', 'display-capture': 'Screen sharing' };
async function buildSite() {
  const p = $('#sitep'); const info = await call('site.info');
  if (!info) { p.innerHTML = '<div class="sub">No page open.</div>'; return; }
  const kind = info.kind;
  const head = kind === 'secure' ? ['Connection is secure', 'Your connection to this site is encrypted (HTTPS).', I.lock, ''] : kind === 'insecure' ? ['Connection is not secure', 'Anything you send to this site can be read by others. Don’t enter passwords or card numbers.', I.warn, 'bad']
    : kind === 'internal' ? ['Kitsune page', 'This page is part of Kitsune and runs on your device.', I.fox, 'int'] : ['Local file', 'This page is a file on your computer.', I.fox, 'int'];
  const web = kind === 'secure' || kind === 'insecure';
  p.innerHTML = `<div class="si-h"><div class="li ${head[3]}">${head[2]}</div><div><b>${head[0]}</b><small>${K.esc(info.host || info.url)}</small></div></div>
    <div class="sub" style="padding:0 12px 6px">${head[1]}</div>
    ${web ? `<div class="si-sec">Permissions for this site</div>${info.perms.map(x => `<div class="si-r"><span>${PERM_LABEL[x.key] || x.key}</span><select data-p="${x.key}"><option value="ask" ${x.state === 'ask' ? 'selected' : ''}>Ask</option><option value="allow" ${x.state === 'allow' ? 'selected' : ''}>Allow</option><option value="block" ${x.state === 'block' ? 'selected' : ''}>Block</option></select></div>`).join('')}
    <div class="si-sec">Site data</div><div class="si-r"><span>${info.cookies} cookie${info.cookies === 1 ? '' : 's'} in use</span></div>
    <button class="si-btn" id="si-clear"><i>${I.trash}</i><span>Clear cookies &amp; site data</span></button>` : ''}
    <div class="sep"></div>
    ${web ? `<button class="si-btn" id="si-copy"><i>${I.external}</i><span>Copy link</span></button><button class="si-btn" id="si-shield"><i>${I.shield}</i><span>Tracking protection${info.blocked ? ' · ' + info.blocked + ' blocked' : ''}</span></button>` : ''}
    <button class="si-btn" id="si-set"><i>${I.gear}</i><span>All site settings</span></button>`;
  p.querySelectorAll('select[data-p]').forEach(s => s.onchange = () => call('site.setPerm', info.origin, s.dataset.p, s.value));
  const c = $('#si-clear'); if (c) c.onclick = async () => { if (!c.dataset.sure) { c.dataset.sure = 1; c.querySelector('span').textContent = 'Click again to sign out and clear this site'; return; } await call('site.clear'); closePopups(); toast('Cleared data for ' + info.host, 'ok'); };
  const cp = $('#si-copy'); if (cp) cp.onclick = () => { call('clip.write', info.url); closePopups(); toast('Link copied', 'ok'); };
  const sh = $('#si-shield'); if (sh) sh.onclick = () => { buildShield(); showPanel($('#shieldp')); };
  $('#si-set').onclick = () => { call('cmd', 'openPage', 'settings'); closePopups(); };
}

// ------------------------------------------------------------------ shield panel
function buildShield() {
  const p = $('#shieldp'); const a = activeTab(); const n = a ? a.blocked : 0;
  const lv = S.blocker;
  p.innerHTML = `<h4>Tracking protection</h4><div class="big">${n}</div><div class="sub">${n === 1 ? 'tracker' : 'trackers & ads'} blocked on ${K.esc(a ? (K.host(a.url) || 'this page') : 'this page')}</div>
  <div class="seg">${['off', 'standard', 'strict'].map(x => `<button data-l="${x}" class="${lv === x ? 'cur' : ''}">${x[0].toUpperCase() + x.slice(1)}</button>`).join('')}</div>
  <div class="row"><span>HTTPS-only mode</span><div class="tg ${S.httpsOnly ? 'on' : ''}" data-k="httpsOnly"></div></div>
  <div class="row"><span>Send Global Privacy Control</span><div class="tg ${S.sendGPC ? 'on' : ''}" data-k="sendGPC"></div></div>
  <div class="sub" style="padding-bottom:4px">Strict also blocks common ad & tracking URL patterns. Some sites may need Standard.</div>`;
  p.querySelectorAll('.seg button').forEach(b => b.onclick = async () => { await call('settings.set', { blocker: b.dataset.l }); call('cmd', 'reload'); });
  p.querySelectorAll('.tg').forEach(t => t.onclick = () => call('settings.set', { [t.dataset.k]: !S[t.dataset.k] }));
  if (!p.hidden) requestAnimationFrame(() => { need.panel = Math.min(900, (p.offsetTop + p.offsetHeight) + 14); syncExpand(); });
}

// ------------------------------------------------------------------ downloads panel
const fmtEta = s => s == null ? '' : s < 5 ? 'a few seconds left' : s < 60 ? `${s}s left` : s < 3600 ? `${Math.ceil(s / 60)} min left` : `${Math.floor(s / 3600)} h ${Math.ceil((s % 3600) / 60)} min left`;
function buildDl() {
  const p = $('#dlp'); const list = downloads.slice(0, 6);
  p.innerHTML = '<h4>Downloads</h4>' + (list.length ? list.map(d => {
    const pct = d.total ? Math.round(100 * d.received / d.total) : 0; const done = d.state === 'completed' && !d.missing;
    const st = d.state === 'progressing' ? `${K.bytes(d.received)} of ${K.bytes(d.total) || '?'}${d.paused ? ' · paused' : ''}` : d.state === 'completed' ? (d.missing ? 'File moved or deleted' : K.bytes(d.total || d.received)) : d.state;
    const live = d.state === 'progressing' && !d.paused ? [d.speed ? K.bytes(d.speed) + '/s' : '', fmtEta(d.eta)].filter(Boolean).join(' · ') : '';
    return `<div class="dl${done ? ' done' : ''}${d.missing ? ' gone' : ''}" data-id="${d.id}"${done ? ' draggable="true" title="Click to open. Drag into a folder to copy it there."' : ''}><div class="n">${K.esc(d.name)}</div>${d.state === 'progressing' ? `<div class="pb"><i style="width:${pct}%"></i></div>` : ''}<div class="m"><span>${st}</span>${live ? `<span class="sp">${live}</span>` : ''}${done ? '<a data-a="open">Open</a><a data-a="show">Show in folder</a>' : d.state === 'progressing' ? `<a data-a="pause">${d.paused ? 'Resume' : 'Pause'}</a><a data-a="cancel">Cancel</a>` : ''}</div></div>`;
  }).join('') : '<div class="sub">Nothing downloaded yet.</div>') + '<div class="sep"></div><button class="mi" id="dl-all"><i>' + I.folder + '</i><span>Show all downloads</span></button>';
  p.querySelectorAll('.dl a').forEach(a => a.onclick = e => { e.stopPropagation(); call('dl.' + a.dataset.a, +a.closest('.dl').dataset.id); });
  p.querySelectorAll('.dl.done').forEach(r => {
    r.onclick = () => { call('dl.open', +r.dataset.id); closePopups(); };
    r.addEventListener('dragstart', e => { e.preventDefault(); dlDragging = true; call('dl.drag', +r.dataset.id); setTimeout(() => { dlDragging = false; }, 1500); });
    r.addEventListener('contextmenu', e => { e.preventDefault(); const id = +r.dataset.id; showCtx([{ label: 'Open', run: () => call('dl.open', id) }, { label: 'Show in Folder', run: () => call('dl.show', id) }, { type: 'sep' }, { label: 'Remove from List', danger: true, run: () => call('dl.remove', id) }], e.clientX, e.clientY); });
  });
  $('#dl-all').onclick = () => { call('cmd', 'openPage', 'downloads'); closePopups(); };
  if (!p.hidden) requestAnimationFrame(() => { need.panel = Math.min(900, (p.offsetTop + p.offsetHeight) + 14); syncExpand(); });
}
