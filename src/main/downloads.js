'use strict';
const fs = require('fs');
const path = require('path');
const { app, shell, Notification } = require('electron');
const S = require('./state');
const storage = require('./storage');

let store = null;
let list = [];
let seq = 0;

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
  return { id: r.id, name: r.name, path: r.path, url: r.url, total: r.total, received: r.received, state: r.state, started: r.started, paused: !!r.paused };
}

function unique(dir, name) {
  const ext = path.extname(name), stem = path.basename(name, ext);
  let n = name, i = 1;
  while (fs.existsSync(path.join(dir, n))) n = `${stem} (${i++})${ext}`;
  return n;
}

function handle(item, notify) {
  const dir = S.get().downloadDir || app.getPath('downloads');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const name = unique(dir, item.getFilename() || 'download');
  const p = path.join(dir, name);
  item.setSavePath(p);
  const rec = { id: ++seq, name, path: p, url: item.getURL(), total: item.getTotalBytes(), received: 0, state: 'progressing', started: Date.now(), paused: false, _item: item };
  list.unshift(rec);
  item.on('updated', (e, state) => {
    rec.received = item.getReceivedBytes(); rec.total = item.getTotalBytes();
    rec.state = state === 'interrupted' ? 'interrupted' : 'progressing'; rec.paused = item.isPaused();
    notify(false);
  });
  item.once('done', (e, state) => {
    rec.received = item.getReceivedBytes(); rec.state = state; rec.paused = false; delete rec._item;
    persist(); notify(true);
    if (state === 'completed' && Notification.isSupported()) {
      try { new Notification({ title: 'Download complete', body: name }).show(); } catch (_) {}
    }
  });
  notify(true);
}

const find = id => list.find(x => x.id === id);
module.exports = {
  init, handle,
  list: () => list.map(serialize),
  active: () => list.filter(x => x.state === 'progressing').length,
  progress: () => {
    const a = list.filter(x => x.state === 'progressing' && x.total > 0);
    if (!a.length) return null;
    return a.reduce((s, x) => s + x.received, 0) / a.reduce((s, x) => s + x.total, 0);
  },
  open: id => { const r = find(id); if (r) shell.openPath(r.path); },
  show: id => { const r = find(id); if (r) shell.showItemInFolder(r.path); },
  cancel: id => { const r = find(id); if (r && r._item) r._item.cancel(); },
  pause: id => { const r = find(id); if (r && r._item) { r._item.isPaused() ? r._item.resume() : r._item.pause(); } },
  remove: id => { list = list.filter(x => x.id !== id); persist(); },
  clear: () => { list = list.filter(x => x.state === 'progressing'); persist(); }
};
