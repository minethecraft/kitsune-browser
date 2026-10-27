'use strict';
// Runs in an isolated world in every page. Offers saved logins / verification codes / new passwords from the Kitsune vault.
// Security model: no autofill without a trusted click on the overlay (which lives in a closed shadow root the page can't reach);
// the main process only answers for the frame's own site; the vault is never unlocked from inside a page (so keystrokes can't be sniffed).
const { ipcRenderer } = require('electron');
(function () {
  if (!/^https?:$/.test(location.protocol)) return;
  try { if (window.top !== window && window.top.location.origin !== location.origin) return; } catch (_) { return; }
  const call = (c, ...a) => ipcRenderer.invoke('kpw:' + c, ...a).catch(() => null);
  const send = (c, ...a) => { try { ipcRenderer.send('kpw:' + c, ...a); } catch (_) {} };
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const inputs = () => Array.from(document.querySelectorAll('input')).filter(i => i.type !== 'hidden' && vis(i));
  const isPw = i => i.type === 'password';
  const isUserish = i => ['text', 'email', 'tel', ''].includes(i.type) && !i.readOnly && !i.disabled;
  const OTP = /otp|2fa|totp|mfa|verif|authenticator|one.?time|security.?code|auth.?code|passcode|sms.?code|login.?code/i;
  const isOtp = i => isUserish(i) && ((i.autocomplete || '').includes('one-time-code') || (OTP.test([i.name, i.id, i.placeholder, i.getAttribute('aria-label')].join(' ')) && !/user|email|phone|search/i.test(i.name + i.id)) || ((i.maxLength >= 6 && i.maxLength <= 8) && i.inputMode === 'numeric' && !isPw(i)));
  function userFieldFor(pw) { const all = inputs(); const i = all.indexOf(pw); for (let k = i - 1; k >= 0; k--) if (isUserish(all[k]) && !isOtp(all[k])) return all[k]; return null; }
  function setVal(el, v) { el.focus(); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d && d.set ? d.set.call(el, v) : (el.value = v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }

  // ---------------- overlay (closed shadow root)
  let host = null, root = null, current = null;
  function ensure() {
    if (host && host.isConnected) return; host = document.createElement('div'); host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0';
    root = host.attachShadow({ mode: 'closed' }); const st = document.createElement('style');
    st.textContent = ':host{all:initial}.card{position:fixed;min-width:230px;max-width:340px;background:#1f1330;color:#f6eefc;border:1px solid rgba(255,255,255,.18);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.45);font:13px/1.35 system-ui,sans-serif;padding:6px;animation:i .12s ease-out}@media(prefers-color-scheme:light){.card{background:#fff;color:#2a1633;border-color:rgba(0,0,0,.15)}.sub{color:#715985!important}.it:hover{background:rgba(0,0,0,.06)!important}}@keyframes i{from{opacity:0;transform:translateY(-4px)}}.hd{padding:4px 8px 6px;font-size:11px;opacity:.7;display:flex;gap:6px;align-items:center}.it{display:flex;gap:10px;align-items:center;padding:8px 10px;border-radius:8px;cursor:pointer}.it:hover{background:rgba(255,255,255,.1)}.ic{width:22px;height:22px;border-radius:6px;background:#ff8fb8;color:#2a0b1c;display:grid;place-items:center;font-weight:800;font-size:12px;flex:none}.t{font-weight:600}.sub{color:#cbb7de;font-size:11.5px}.btns{display:flex;gap:8px;padding:6px 8px 4px;flex-wrap:wrap}.b{border:0;border-radius:8px;padding:7px 12px;font:inherit;font-weight:600;cursor:pointer;background:rgba(255,255,255,.12);color:inherit}.b.p{background:#ff8fb8;color:#2a0b1c}';
    root.appendChild(st); document.documentElement.appendChild(host);
  }
  const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const trusted = fn => e => { if (e.isTrusted) fn(e); };
  function place(card, anchor) { const r = anchor.getBoundingClientRect(); card.style.left = Math.max(4, Math.min(innerWidth - 250, r.left)) + 'px'; card.style.top = Math.min(innerHeight - 60, r.bottom + 4) + 'px'; }
  function hide() { if (host && host.isConnected) host.remove(); current = null; }
  function item(icon, title, sub, fn) { const it = mk('div', 'it'); it.appendChild(mk('div', 'ic', icon)); const w = mk('div'); w.appendChild(mk('div', 't', title)); if (sub) w.appendChild(mk('div', 'sub', sub)); it.appendChild(w); it.addEventListener('mousedown', e => e.preventDefault()); it.addEventListener('click', trusted(fn)); return it; }

  async function offer(el) {
    if (!el || el === current) return; const pw = isPw(el), otp = !pw && isOtp(el);
    const form = el.form || document; const pws = Array.from(form.querySelectorAll('input[type=password]')).filter(vis);
    const newPw = pw && ((el.autocomplete || '').includes('new-password') || pws.length >= 2);
    const userish = !pw && !otp && isUserish(el) && (((el.autocomplete || '').match(/username|email/)) || pws.length > 0 || /user|email|login|account/i.test(el.name + el.id));
    if (!pw && !otp && !userish) { hide(); return; }
    const s = await call('state'); if (!s || !s.exists) { hide(); return; }
    ensure(); current = el; root.querySelectorAll('.card').forEach(c => c.remove()); const card = mk('div', 'card'); card.appendChild(mk('div', 'hd', '🦊 Kitsune passwords'));
    if (s.locked) { card.appendChild(item('🔒', 'Unlock to see logins', 'Opens Kitsune passwords', () => { call('unlockPage'); hide(); })); }
    else {
      const list = (await call('list')) || [];
      if (otp) { const l = list.filter(x => x.hasTotp); if (!l.length) { hide(); return; } l.forEach(x => card.appendChild(item(x.title[0].toUpperCase(), 'Fill verification code', x.title + (x.user ? ' · ' + x.user : ''), async () => { const r = await call('fill', x.id, 'code'); if (r && r.code) { setVal(el, r.code); hide(); } }))); }
      else {
        list.filter(x => x.hasPass).forEach(x => card.appendChild(item((x.user || x.title)[0].toUpperCase(), x.user || '(no username)', x.title + (x.exact ? '' : ' · related site'), async () => { const r = await call('fill', x.id, 'login'); if (!r) return; const u = pw ? userFieldFor(el) : el; const p = pw ? el : (form.querySelector && Array.from(form.querySelectorAll('input[type=password]')).find(vis)); if (u && r.user) setVal(u, r.user); if (p) setVal(p, r.pass); hide(); })));
      }
      if (newPw) card.appendChild(item('✦', 'Use a strong password', 'Generates and fills it; Kitsune offers to save it', async () => { const g = await call('generate'); pws.forEach(p => setVal(p, g)); hide(); }));
      if (!card.querySelectorAll('.it').length) { hide(); return; }
    }
    root.appendChild(card); place(card, el);
  }
  document.addEventListener('focusin', e => { const t = e.target; if (t && t.tagName === 'INPUT') offer(t); }, true);
  document.addEventListener('mousedown', e => { if (current && e.target !== current) setTimeout(() => { if (document.activeElement !== current) hide(); }, 150); }, true);
  addEventListener('scroll', () => { if (current && root) { const c = root.querySelector('.card'); if (c) place(c, current); } }, true); addEventListener('resize', hide);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); }, true);

  // ---------------- capture logins for the "save password?" prompt
  let lastSent = '';
  function capture(scope) {
    const form = scope && scope.closest ? (scope.closest('form') || document) : document; const pws = Array.from(form.querySelectorAll('input[type=password]')).filter(i => i.value);
    if (!pws.length) return; const np = pws.find(p => (p.autocomplete || '').includes('new-password')) || (pws.length >= 2 ? pws[1] : pws[0]); const u = userFieldFor(pws[0]); const sig = (u ? u.value : '') + '\u0001' + np.value;
    if (sig === lastSent) return; lastSent = sig; send('capture', { user: u ? u.value : '', pass: np.value });
  }
  document.addEventListener('submit', e => capture(e.target), true);
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') capture(e.target); }, true);
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button, input[type=submit], [role=button]'); if (b && e.isTrusted) capture(b); }, true);

  // ---------------- "Save password?" bar after the login navigates
  async function pendingBar() {
    if (window.top !== window) return; const p = await call('pending'); if (!p) return; ensure(); root.querySelectorAll('.card').forEach(c => c.remove());
    const card = mk('div', 'card'); card.style.cssText = 'right:14px;top:14px;left:auto'; card.appendChild(mk('div', 'hd', '🦊 Kitsune passwords'));
    card.appendChild(mk('div', 't', (p.update ? 'Update password for ' : 'Save password for ') + p.host + '?')); if (p.user) card.appendChild(mk('div', 'sub', p.user));
    const row = mk('div', 'btns'); const btn = (t, cls, fn) => { const b = mk('button', 'b ' + cls, t); b.addEventListener('click', trusted(fn)); row.appendChild(b); };
    if (p.locked) btn('Unlock to save', 'p', () => { call('unlockPage'); hide(); }); else btn(p.update ? 'Update' : 'Save', 'p', async () => { await call('pendingSave'); hide(); });
    btn('Not now', '', () => { call('pendingDrop', false); hide(); }); if (!p.update) btn('Never here', '', () => { call('pendingDrop', true); hide(); });
    card.appendChild(row); root.appendChild(card); setTimeout(() => { if (host && host.isConnected && !current) hide(); }, 25000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pendingBar); else pendingBar();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pendingBar(); }); addEventListener('focus', () => pendingBar());
})();
