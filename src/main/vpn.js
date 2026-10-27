'use strict';
// Browser VPN: routes every tab through your own HTTP(S)/SOCKS5 proxy (see /vpn-server for a ready-made one).
// Fixed proxy rules mean there is no direct fallback (built-in kill switch); WebRTC is locked down to stop IP leaks.
const { app, session, net: enet } = require('electron');
const nodeNet = require('net');
const S = require('./state');
const secure = require('./secure');

const FREE = 'kitsune-free';
let freeUp = true, freeTimer = null, freeState = { status: 'off', error: '' };
const sessions = new Set();
const active = () => { const s = S.get(); return s.vpnOn ? (s.vpnProfiles || []).find(p => p.id === s.vpnActive) || null : null; };
const rules = p => `${p.scheme === 'socks5' ? 'socks5' : p.scheme === 'https' ? 'https' : 'http'}://${p.host}:${p.port}`;
const bypass = () => ['<local>', 'localhost', '127.0.0.1', '[::1]', '*.kitsune'].concat((S.get().vpnBypass || '').split(/[\s,;]+/).filter(Boolean)).join(',');

async function applyTo(ses) {
  sessions.add(ses);
  const p = active();
  // The built-in free VPN fails OPEN (direct) when its server is down so browsing never breaks; your own servers still fail closed.
  if (p && p.builtin && !freeUp) { try { await ses.setProxy({ mode: 'system' }); } catch (_) {} return; }
  try { await ses.setProxy(p ? { mode: 'fixed_servers', proxyRules: rules(p), proxyBypassRules: bypass() } : { mode: S.get().vpnOn ? 'fixed_servers' : 'system' }); } catch (_) {}
  // If VPN is "on" but no valid profile is selected, fail closed instead of leaking.
  if (S.get().vpnOn && !p) { try { await ses.setProxy({ mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:9' }); } catch (_) {} }
}
async function applyAll() { await Promise.all([...sessions].map(applyTo)); for (const w of require('electron').webContents.getAllWebContents()) policy(w); }
function policy(wc) { try { wc.setWebRTCIPHandlingPolicy(S.get().vpnOn && S.get().vpnWebrtc ? 'disable_non_proxied_udp' : 'default_public_interface_only'); } catch (_) {} }

function init() {
  app.on('login', (e, wc, details, authInfo, cb) => {
    if (!authInfo.isProxy) return; const p = active(); if (!p || !p.user) return;
    e.preventDefault(); cb(p.user, secure.get('vpn:' + p.id));
  });
  app.on('web-contents-created', (e, wc) => { policy(wc); });
  S.bus.on('settings', () => { applyAll(); });
}
function setPassword(id, pw) { secure.set('vpn:' + id, pw || ''); }

/** Compare public IP direct vs through a profile, in an isolated throw-away session. */
async function check(profile) {
  const ses = session.fromPartition('vpn-check-' + Date.now());
  const t0 = Date.now();
  const get = async () => { const r = await ses.fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(12000) }); return (await r.json()).ip; };
  const out = {};
  try { await ses.setProxy({ mode: 'direct' }); out.direct = await get(); } catch (_) { out.direct = null; }
  try {
    await ses.setProxy({ mode: 'fixed_servers', proxyRules: rules(profile) });
    if (profile.user) { const h = (e, wc, d, a, cb) => { if (a.isProxy) { e.preventDefault(); cb(profile.user, secure.get('vpn:' + profile.id)); } }; app.on('login', h); setTimeout(() => app.removeListener('login', h), 15000); }
    const t1 = Date.now(); out.vpn = await get(); out.ms = Date.now() - t1; out.ok = !!out.vpn && out.vpn !== out.direct;
  } catch (e) { out.ok = false; out.error = /PROXY|TUNNEL|AUTH|CONNECTION/i.test(String(e.message)) ? 'Could not connect through that proxy.' : String(e.message).slice(0, 120); }
  try { await ses.clearStorageData(); } catch (_) {}
  return out;
}

/** Built-in "Kitsune Free VPN": the site publishes the proxy details at /api/vpn; it's added automatically, can't be deleted, and is on by default. */
async function fetchFree() {
  const base = (S.get().accountServer || '').replace(/\/+$/, ''); if (!base) return;
  try {
    const res = await enet.fetch(base + '/api/vpn', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) }); if (!res.ok) throw new Error('HTTP ' + res.status);
    const c = await res.json(); if (!c.enabled || !c.host || !c.port) { freeState = { status: 'unavailable', error: '' }; return; }
    const prof = { id: FREE, name: String(c.name || 'Kitsune Free VPN').slice(0, 40), scheme: ['http', 'https'].includes(c.scheme) ? c.scheme : 'http', host: String(c.host), port: +c.port, user: String(c.user || ''), builtin: true };
    if (c.pass) setPassword(FREE, String(c.pass));
    const cur = S.get(); const old = (cur.vpnProfiles || []).find(x => x.id === FREE);
    const changed = !old || JSON.stringify(old) !== JSON.stringify(prof);
    const patch = {}; if (changed) patch.vpnProfiles = (cur.vpnProfiles || []).filter(x => x.id !== FREE).concat([prof]);
    if (!cur.vpnFreeInit) { patch.vpnFreeInit = true; patch.vpnOn = true; patch.vpnActive = FREE; }
    if (Object.keys(patch).length) S.patch(patch); freeState = { status: 'ready', error: '' };
  } catch (e) { freeState = { status: 'offline', error: String(e.message).slice(0, 80) }; }
}
function probeFree() {
  const p = (S.get().vpnProfiles || []).find(x => x.id === FREE); if (!p) return Promise.resolve();
  return new Promise(res => { const sock = nodeNet.connect({ host: p.host, port: p.port, timeout: 4000 }); let done = false; const fin = up => { if (done) return; done = true; sock.destroy(); const was = freeUp; freeUp = up; if (was !== up) applyAll(); res(); }; sock.on('connect', () => fin(true)); sock.on('timeout', () => fin(false)); sock.on('error', () => fin(false)); });
}
function startFree() {
  const tick = async () => { await fetchFree(); await probeFree(); };
  setTimeout(tick, 1500); clearInterval(freeTimer); freeTimer = setInterval(() => { const s = S.get(); if (s.vpnOn && s.vpnActive === FREE) probeFree(); }, 45000); setInterval(fetchFree, 6 * 3600 * 1000).unref();
}
const freeStatus = () => Object.assign({ up: freeUp }, freeState);
module.exports = { probeFree, startFree, fetchFree, freeStatus, FREE, init, applyTo, applyAll, setPassword, check, active };
