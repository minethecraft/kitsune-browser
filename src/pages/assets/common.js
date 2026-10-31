// Shared bootstrap for every internal page: theme, animation level, adaptive accent, tiny helpers.
(function () {
  const K = window.K = { settings: null, runtime: {}, features: {}, edition: 'full', platform: '', state: null };
  const root = document.documentElement;

  function lighten(hex, amt) { // keep adaptive accents readable on dark UI
    const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (l < 0.55) { r = Math.min(255, r + (255 - r) * amt); g = Math.min(255, g + (255 - g) * amt); b = Math.min(255, b + (255 - b) * amt); }
    return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  }
  function textOn(hex) { const n = parseInt(hex.slice(1), 16); const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return l > 0.6 ? '#1a0f1f' : '#ffffff'; }

  K.effectiveAnim = function () {
    const s = K.settings || {}; let a = s.animations || 'full';
    if (a === 'full' && s.batterySaver && K.runtime && K.runtime.onBattery) a = 'reduced';
    if (matchMedia('(prefers-reduced-motion: reduce)').matches && a === 'full') a = 'reduced';
    return a;
  };
  K.particleType = function () {
    const s = K.settings || {}; if (!K.features.particles || K.effectiveAnim() !== 'full') return 'none';
    if (s.particles && s.particles !== 'auto') return s.particles;
    const cp = String(s.theme).startsWith('custom:') ? (s.customThemes || []).find(t => 'custom:' + t.id === s.theme) : null; if (cp && cp.particles) return cp.particles;
    return { sakura: 'sakura', neon: 'rain', umbra: 'firefly', aqua: 'bubbles', crimson: 'ember', dusk: 'ember', hanami: 'sakura', rain: 'rain', aurora: 'aurora', matcha: 'leaves', kitsune: 'lantern', cosmos: 'stars', mono: 'snow' }[s.theme] || 'sakura';
  };

  K.effectiveSfx = function () {
    const s = K.settings || {}; const base = s.sfx || {}; const ct = K.preview || (String(s.theme).startsWith('custom:') ? (s.customThemes || []).find(t => 'custom:' + t.id === s.theme) : null);
    const src = ct && ct.sfx ? ct.sfx : base; return { pack: src.pack, volume: src.volume, hover: src.hover, custom: base.custom || {} };
  };
  function apply() {
    const s = K.settings; if (!s) return;
    const ct = K.preview || (String(s.theme).startsWith('custom:') ? (s.customThemes || []).find(t => 'custom:' + t.id === s.theme) : null);
    root.dataset.theme = ct ? 'sakura' : s.theme; root.dataset.anim = K.effectiveAnim();
    const CV = ['--bg', '--bg2', '--bg3', '--fg', '--muted', '--accent', '--accent2', '--accent-fg', '--glow', '--line', '--scrim'];
    if (ct) {
      const set = (n, v) => v && root.style.setProperty(n, v);
      set('--bg', ct.bg); set('--bg2', ct.bg2 || ct.bg); set('--bg3', ct.bg3 || ct.bg2 || ct.bg); set('--fg', ct.fg); set('--muted', ct.muted || ct.fg);
      set('--accent', ct.accent); set('--accent2', ct.accent2 || ct.accent); set('--accent-fg', textOn(ct.accent || '#ff8fb8')); set('--glow', (ct.accent || '#ff8fb8') + '66');
      set('--line', ct.fg + '24'); set('--scrim', ct.bg + 'a0');
    } else CV.forEach(p => root.style.removeProperty(p));
    const ui = ct && ct.ui; const FONTS = { rounded: 'ui-rounded, "Hiragino Maru Gothic ProN", "Yu Gothic UI", "Segoe UI Variable Display", system-ui, sans-serif', serif: 'Georgia, "Noto Serif", "Times New Roman", serif', mono: 'ui-monospace, "Cascadia Code", Consolas, Menlo, monospace' };
    if (ui) { root.dataset.ui = '1'; root.dataset.density = ui.density || 'normal'; root.dataset.tabs = ui.tabs || 'round'; root.style.setProperty('--radius', (ui.radius == null ? 12 : ui.radius) + 'px'); root.style.setProperty('--blur', (ui.blur == null ? 10 : ui.blur) + 'px'); if (FONTS[ui.font]) root.style.setProperty('--ui-font', FONTS[ui.font]); else root.style.removeProperty('--ui-font'); }
    else { ['ui', 'density', 'tabs'].forEach(a => delete root.dataset[a]); ['--radius', '--blur', '--ui-font'].forEach(p => root.style.removeProperty(p)); }
    if (window.SFX) SFX.config(K.effectiveSfx());
    const dyn = K.runtime && K.runtime.dynamicAccent;
    if (s.adaptiveAccent && dyn && !(ct && ct.lockAccent)) {
      const c = lighten(dyn, 0.35);
      root.style.setProperty('--accent', c); root.style.setProperty('--accent-fg', textOn(c));
      root.style.setProperty('--glow', c + '66');
    } else if (!ct) ['--accent', '--accent-fg', '--glow'].forEach(p => root.style.removeProperty(p));
    document.dispatchEvent(new CustomEvent('k:applied'));
  }

  K.reapply = () => apply();
  K.init = async function () {
    const st = await kitsune.call('state');
    K.state = st; K.settings = st.settings; K.runtime = st.runtime || {}; K.features = st.features; K.edition = st.edition; K.platform = st.platform;
    root.dataset.platform = st.platform; root.dataset.edition = st.edition;
    apply(); if (window.SFX) SFX.bind(document);
    kitsune.on('settings', s => { K.settings = s; apply(); document.dispatchEvent(new CustomEvent('k:settings', { detail: s })); });
    kitsune.on('account', a => document.dispatchEvent(new CustomEvent('k:account', { detail: a })));
    kitsune.on('runtime', r => { K.runtime = r; apply(); });
    return st;
  };

  K.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  K.host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };
  K.favicon = u => { const h = K.host(u); return h ? 'https://icons.duckduckgo.com/ip3/' + h + '.ico' : ''; };
  K.ago = t => { const d = (Date.now() - t) / 1000; if (d < 60) return 'just now'; if (d < 3600) return Math.floor(d / 60) + ' min ago'; if (d < 86400) return Math.floor(d / 3600) + ' h ago'; return new Date(t).toLocaleDateString(); };
  K.bytes = n => { if (!n && n !== 0) return ''; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; };
})();
