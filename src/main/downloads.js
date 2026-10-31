'use strict';
const fs = require('fs');
const path = require('path');
const { app, shell, Notification, nativeImage } = require('electron');
const S = require('./state');
const storage = require('./storage');
const pdl = require('./pdl');

let store = null;
let list = [];
let seq = 0;
const MIN_PARALLEL = 6 * pdl.MB;      // smaller files finish before extra connections would help

function init() {
  store = storage.open('downloads', { items: [] });
  list = store.data.items.map(x => Object.assign({}, x, { state: x.state === 'progressing' ? 'interrupted' : x.state }));
  seq = list.reduce((m, x) => Math.max(m, x.id), 0);
}

function persist() {
  store.data.items = list.slice(0, 100).map(serialize);
  store.save();
}

function serialize(r) {
  return {
    id: r.id, name: r.name, path: r.path, url: r.url, total: r.total, received: r.received, state: r.state, started: r.started, paused: !!r.paused,
    speed: r.state === 'progressing' && !r.paused ? Math.round(r.speed || 0) : 0, eta: r.state === 'progressing' && !r.paused ? (r.eta == null ? null : r.eta) : null,
    conns: r.conns || 1, missing: r.state === 'completed' && !!r.path && !fs.existsSync(r.path)
  };
}

function unique(dir, name) {
  const ext = path.extname(name), stem = path.basename(name, ext);
  let n = name, i = 1;
  while (fs.existsSync(path.join(dir, n))) n = `${stem} (${i++})${ext}`;
  return n;
}

// speed over the last few seconds (smooths out bursts) → ETA
function sample(rec) {
  const now = Date.now(); rec.samples = rec.samples || [];
  rec.samples.push([now, rec.received]);
  while (rec.samples.length > 2 && now - rec.samples[0][0] > 4000) rec.samples.shift();
  const a = rec.samples[0], b = rec.samples[rec.samples.length - 1];
  rec.speed = b[0] > a[0] ? Math.max(0, (b[1] - a[1]) / ((b[0] - a[0]) / 1000)) : 0;
  rec.eta = rec.total > 0 && rec.speed > 1 ? Math.ceil((rec.total - rec.received) / rec.speed) : null;
}

function done(rec, state, notify) {
  rec.state = state; rec.paused = false; delete rec._item; delete rec._job; rec.speed = 0; rec.eta = null; delete rec.samples;
  persist(); notify(true);
  if (state === 'completed' && Notification.isSupported()) { try { new Notification({ title: 'Download complete', body: rec.name }).show(); } catch (_) {} }
}

function handle(item, notify, wc) {
  const dir = S.get().downloadDir || app.getPath('downloads');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const name = unique(dir, item.getFilename() || 'download');
  const p = path.join(dir, name);
  item.setSavePath(p);
  const url = item.getURL();
  const rec = { id: ++seq, name, path: p, url, total: item.getTotalBytes(), received: 0, state: 'progressing', started: Date.now(), paused: false, _item: item, speed: 0, eta: null, conns: 1 };
  list.unshift(rec);

  item.on('updated', (e, state) => {
    if (rec._job) return;
    rec.received = item.getReceivedBytes(); rec.total = item.getTotalBytes();
    rec.state = state === 'interrupted' ? 'interrupted' : 'progressing'; rec.paused = item.isPaused();
    sample(rec); notify(false);
  });
  item.once('done', (e, state) => {
    if (rec._job) return;                       // we cancelled it ourselves to take over (see below)
    rec.received = item.getReceivedBytes();
    done(rec, state, notify);
  });

  // Fast path: for ordinary http(s) downloads whose server allows byte ranges, fetch the file over several connections at once.
  if (S.get().fastDownloads !== false && /^https?:/i.test(url)) {
    const ses = wc && wc.session;
    if (ses && typeof ses.fetch === 'function') {
      item.pause();                             // hold the normal download while we check what the server supports
      const init = { credentials: 'include', headers: {} };
      try { const ref = wc.getURL(); if (/^https?:/i.test(ref)) init.referrer = ref; } catch (_) {}
      pdl.probe((u, i) => ses.fetch(u, i), url, init).then(info => {
        if (rec.state !== 'progressing' || item.getState() === 'cancelled') return;
        if (!info || info.total < MIN_PARALLEL) { item.resume(); return; }
        const job = new pdl.Job({ fetchFn: (u, i) => ses.fetch(u, i), url, init, file: p + '.kitsune-part', total: info.total, etag: info.etag, conns: info.total > 200 * pdl.MB ? 12 : 8 });
        rec._job = job; rec.total = info.total; rec.conns = job.conns; rec.samples = [];
        item.cancel();                          // drop the single-connection download
        job.on('progress', s => { rec.received = s.received; rec.speed = s.speed; rec.eta = s.eta; rec.paused = s.paused; notify(false); });
        job.on('done', st => {
          // written under a temporary name so cancelling the original (single-connection) download can't delete it
          if (st === 'completed') { try { fs.renameSync(p + '.kitsune-part', p); } catch (_) { st = 'interrupted'; } }
          rec.received = st === 'completed' ? rec.total : rec.received; done(rec, st, notify);
        });
        job.start();
        notify(true);
      }).catch(() => { try { item.resume(); } catch (_) {} });
    }
  }
  notify(true);
}

const find = id => list.find(x => x.id === id);
const iconPath = path.join(S.SRC, '..', 'build', 'icon.png');
let dragIcon = null;

module.exports = {
  init, handle,
  list: () => list.map(serialize),
  active: () => list.filter(x => x.state === 'progressing').length,
  progress: () => {
    const a = list.filter(x => x.state === 'progressing' && x.total > 0);
    if (!a.length) return null;
    return a.reduce((s, x) => s + x.received, 0) / a.reduce((s, x) => s + x.total, 0);
  },
  open: id => { const r = find(id); if (r) shell.openPath(r.path).then(err => err && require('./browser').broadcast('toast', 'Could not open the file: ' + err, 'error')); },
  show: id => { const r = find(id); if (r) shell.showItemInFolder(r.path); },
  cancel: id => { const r = find(id); if (!r) return; if (r._job) r._job.cancel(); else if (r._item) r._item.cancel(); },
  pause: id => {
    const r = find(id); if (!r) return;
    if (r._job) { r._job.paused ? r._job.resume() : r._job.pause(); r.paused = r._job.paused; }
    else if (r._item) { r._item.isPaused() ? r._item.resume() : r._item.pause(); }
  },
  remove: id => { list = list.filter(x => x.id !== id); persist(); },
  clear: () => { list = list.filter(x => x.state === 'progressing'); persist(); },
  /** Start an OS-level file drag so the download can be dropped into any folder or app. */
  drag: (id, sender) => {
    const r = find(id); if (!r || r.state !== 'completed' || !fs.existsSync(r.path)) return false;
    if (!dragIcon) { try { dragIcon = nativeImage.createFromPath(iconPath).resize({ width: 40, height: 40 }); } catch (_) { dragIcon = nativeImage.createEmpty(); } }
    sender.startDrag({ file: r.path, icon: dragIcon });
    return true;
  }
};
