'use strict';
// Parallel (multi-connection) HTTP downloader. Pure Node: the caller passes the fetch function
// (Electron's session.fetch, so cookies and the VPN proxy apply), which also lets us test it without Electron.
const fs = require('fs');
const { EventEmitter } = require('events');

const MB = 1024 * 1024;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Ask for one byte. Resolves { total, etag } when the server supports byte ranges, else null. */
async function probe(fetchFn, url, init) {
  const res = await fetchFn(url, Object.assign({}, init, { headers: Object.assign({}, init && init.headers, { Range: 'bytes=0-0' }) }));
  try {
    if (res.status !== 206) { try { res.body && res.body.cancel(); } catch (_) {} return null; }
    const m = /\/(\d+)\s*$/.exec(res.headers.get('content-range') || '');
    await res.arrayBuffer();
    if (!m) return null;
    return { total: +m[1], etag: res.headers.get('etag') || res.headers.get('last-modified') || '' };
  } catch (_) { return null; }
}

class Job extends EventEmitter {
  /** opts: { fetchFn, url, init, file, total, etag, conns=8, chunk=2MB } */
  constructor(opts) {
    super();
    Object.assign(this, { conns: 8, chunk: 2 * MB }, opts);
    this.received = 0; this.paused = false; this.cancelled = false; this.state = 'progressing';
    this.speed = 0; this.samples = [];
    this.ctrls = new Set(); this.resumeWaiters = [];
    const n = Math.ceil(this.total / this.chunk);
    this.chunks = Array.from({ length: n }, (_, i) => ({ start: i * this.chunk, end: Math.min(this.total, (i + 1) * this.chunk) - 1, done: 0 }));
    this.queue = this.chunks.slice();
    this.tick = 0;
  }

  async start() {
    try {
      this.fh = await fs.promises.open(this.file, 'w');
      await this.fh.truncate(this.total);
    } catch (e) { return this._finish('interrupted', e); }
    this.t0 = Date.now();
    this.timer = setInterval(() => this._progress(), 250);
    const workers = Math.min(this.conns, this.chunks.length);
    try {
      await Promise.all(Array.from({ length: workers }, () => this._worker()));
      if (this.cancelled) return;
      if (this.failed) throw this.failed;
      if (this.received < this.total) throw new Error('incomplete');
      await this._finish('completed');
    } catch (e) { if (!this.cancelled) await this._finish('interrupted', e); }
  }

  async _worker() {
    for (;;) {
      if (this.cancelled || this.failed) return;
      const c = this.queue.shift(); if (!c) return;
      let tries = 0;
      while (!this.cancelled && c.start + c.done <= c.end) {
        if (this.paused) { await new Promise(r => this.resumeWaiters.push(r)); continue; }
        const before = c.done;
        try { await this._get(c); }
        catch (e) {
          if (this.cancelled) return;
          if (this.paused) continue;               // we aborted it ourselves to pause
          if (c.done > before) tries = 0;          // it got further than last time: not a dead end
          if (++tries > 4) { this.failed = e; return; }
          await sleep(150 * tries);
        }
      }
    }
  }

  async _get(c) {
    const ctrl = new AbortController(); this.ctrls.add(ctrl);
    try {
      const headers = Object.assign({}, this.init && this.init.headers, { Range: `bytes=${c.start + c.done}-${c.end}` });
      if (this.etag) headers['If-Range'] = this.etag;
      const res = await this.fetchFn(this.url, Object.assign({}, this.init, { headers, signal: ctrl.signal }));
      if (res.status !== 206) { try { res.body && res.body.cancel(); } catch (_) {} throw new Error('server stopped honouring ranges (HTTP ' + res.status + ')'); }
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const room = c.end - (c.start + c.done) + 1; if (value.length > room) throw new Error('server sent too much data');
        await this.fh.write(value, 0, value.length, c.start + c.done);
        c.done += value.length; this.received += value.length;
      }
      if (c.start + c.done <= c.end) throw new Error('connection closed early');
    } finally { this.ctrls.delete(ctrl); }
  }

  _progress() {
    const now = Date.now(); this.samples.push([now, this.received]);
    while (this.samples.length > 2 && now - this.samples[0][0] > 4000) this.samples.shift();
    const a = this.samples[0], b = this.samples[this.samples.length - 1];
    this.speed = this.paused || b[0] === a[0] ? 0 : Math.max(0, (b[1] - a[1]) / ((b[0] - a[0]) / 1000));
    this.emit('progress', this.snapshot());
  }
  snapshot() {
    const left = this.total - this.received;
    return { received: this.received, total: this.total, speed: this.speed, eta: this.speed > 1 ? Math.ceil(left / this.speed) : null, paused: this.paused };
  }

  pause() { if (this.paused || this.state !== 'progressing') return; this.paused = true; this.ctrls.forEach(c => c.abort()); this.speed = 0; this.emit('progress', this.snapshot()); }
  resume() { if (!this.paused) return; this.paused = false; this.samples = []; const w = this.resumeWaiters.splice(0); w.forEach(r => r()); }
  async cancel() { if (this.cancelled || this.state !== 'progressing') return; this.cancelled = true; this.ctrls.forEach(c => c.abort()); this.resume(); await this._finish('cancelled', null, true); }

  async _finish(state, err, remove) {
    if (this.state !== 'progressing') return;
    this.state = state; clearInterval(this.timer);
    try { if (this.fh) await this.fh.close(); } catch (_) {}
    if (remove || state === 'interrupted') { try { fs.rmSync(this.file, { force: true }); } catch (_) {} }
    this.emit('done', state, err || this.failed || null);
  }
}

module.exports = { probe, Job, MB };
