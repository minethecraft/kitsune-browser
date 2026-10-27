'use strict';
// Hosted-demo mode (KITSUNE_DEMO=1): the browser runs on the Kitsune website inside a throw-away container.
// It cannot touch private networks, download files, import/sync data or use the AI key.
const net = require('net');
const on = !!process.env.KITSUNE_DEMO;
const PRIV = /^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;
function priv(h) {
  h = String(h).replace(/^\[|\]$/g, '');
  if (PRIV.test(h)) return true;
  if (net.isIPv4(h)) { const [a, b] = h.split('.').map(Number); return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127); }
  if (net.isIPv6(h)) return /^(::1?|fe80|fc|fd)/i.test(h);
  return false;
}
function blocked(url) {
  if (!on) return false;
  try { const u = new URL(url); if (!/^https?:|^wss?:/.test(u.protocol)) return false; return priv(u.hostname); } catch (_) { return false; }
}
module.exports = { on, blocked, priv };
