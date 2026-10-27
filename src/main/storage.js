'use strict';
// Tiny JSON persistence layer: one file per store, debounced writes, atomic rename.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const stores = new Map();

class Store {
  constructor(name, defaults) {
    this.file = path.join(app.getPath('userData'), name + '.json');
    this.tmp = this.file + '.tmp';
    this.data = JSON.parse(JSON.stringify(defaults));
    this.timer = null;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(defaults)) this.data = Array.isArray(raw) ? raw : this.data;
      else this.data = Object.assign(this.data, raw);
    } catch (_) { /* first run or corrupt file -> defaults */ }
  }
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }
  flush() {
    clearTimeout(this.timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.tmp, JSON.stringify(this.data));
      fs.renameSync(this.tmp, this.file);
    } catch (e) { console.error('store flush failed', this.file, e.message); }
  }
}

function open(name, defaults) {
  if (!stores.has(name)) stores.set(name, new Store(name, defaults));
  return stores.get(name);
}
function flushAll() { for (const s of stores.values()) s.flush(); }

module.exports = { open, flushAll };
