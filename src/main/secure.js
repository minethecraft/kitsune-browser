'use strict';
// Small encrypted secret store (OS keychain-backed via safeStorage when available). Secrets never go in settings or sync.
const { safeStorage } = require('electron');
const storage = require('./storage');
let store = null;
const st = () => store || (store = storage.open('secrets', { v: {} }));
function get(name) {
  const t = st().data.v[name]; if (!t) return '';
  try { if (t.startsWith('e:')) return safeStorage.decryptString(Buffer.from(t.slice(2), 'base64')); } catch (_) { return ''; }
  return t.startsWith('p:') ? Buffer.from(t.slice(2), 'base64').toString('utf8') : '';
}
function set(name, val) {
  val = String(val || '');
  if (!val) delete st().data.v[name];
  else st().data.v[name] = safeStorage.isEncryptionAvailable() ? 'e:' + safeStorage.encryptString(val).toString('base64') : 'p:' + Buffer.from(val, 'utf8').toString('base64');
  st().save();
}
module.exports = { get, set };
