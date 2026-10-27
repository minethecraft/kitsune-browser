'use strict';
// Frame preload for the streaming sites Kiroku tracks. It only forwards raw playback times to the main process
// (which decides, per Settings, whether to report them); it never reads or sends anything else from the page.
const { ipcRenderer } = require('electron');
(() => {
  const h = location.hostname.toLowerCase();
  if (!['crunchyroll.com', 'hidive.com', 'adultswim.com', 'hulu.com', 'netflix.com', 'disneyplus.com'].some(x => h === x || h.endsWith('.' + x))) return;
  let lastSent = 0;
  const isVideo = e => e && e.isTrusted && e.target instanceof HTMLVideoElement && isFinite(e.target.duration) && e.target.duration > 0;
  const send = (v, ended) => { try { ipcRenderer.send('kiroku:video', { time: v.currentTime, duration: v.duration, ended: !!ended }); } catch (_) {} };
  document.addEventListener('timeupdate', e => { if (!isVideo(e) || e.target.paused) return; const n = Date.now(); if (n - lastSent < 10000) return; lastSent = n; send(e.target, false); }, true);
  document.addEventListener('playing', e => { if (!isVideo(e)) return; const n = Date.now(); if (n - lastSent < 3000) return; lastSent = n; setTimeout(() => { if (e.target.duration > 0) send(e.target, false); }, 2500); }, true);
  document.addEventListener('pause', e => { if (isVideo(e) && !e.target.ended) { lastSent = Date.now(); send(e.target, false); } }, true);
  document.addEventListener('ended', e => { if (isVideo(e)) { lastSent = Date.now(); send(e.target, true); } }, true);
})();
