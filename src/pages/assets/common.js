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
    return { sakura: 'sakura', neon: 'rain', umbra: 'firefly', aqua: 'firefly', crimson: 'ember', dusk: 'ember', hanami: 'sakura', rain: 'rain' }[s.theme] || 'sakura';
  };

  function apply() {
    const s = K.settings; if (!s) return;
    root.dataset.theme = s.theme; root.dataset.anim = K.effectiveAnim();
    const dyn = K.runtime && K.runtime.dynamicAccent;
    if (s.adaptiveAccent && dyn) {
      const c = lighten(dyn, 0.35);
      root.style.setProperty('--accent', c); root.style.setProperty('--accent-fg', textOn(c));
      root.style.setProperty('--glow', c + '66');
    } else ['--accent', '--accent-fg', '--glow'].forEach(p => root.style.removeProperty(p));
    document.dispatchEvent(new CustomEvent('k:applied'));
  }

  K.init = async function () {
    const st = await kitsune.call('state');
    K.state = st; K.settings = st.settings; K.runtime = st.runtime || {}; K.features = st.features; K.edition = st.edition; K.platform = st.platform;
    root.dataset.platform = st.platform; root.dataset.edition = st.edition;
    apply();
    kitsune.on('settings', s => { K.settings = s; apply(); document.dispatchEvent(new CustomEvent('k:settings', { detail: s })); });
    kitsune.on('runtime', r => { K.runtime = r; apply(); });
    return st;
  };

  K.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  K.host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };
  K.favicon = u => { const h = K.host(u); return h ? 'https://icons.duckduckgo.com/ip3/' + h + '.ico' : ''; };
  K.ago = t => { const d = (Date.now() - t) / 1000; if (d < 60) return 'just now'; if (d < 3600) return Math.floor(d / 60) + ' min ago'; if (d < 86400) return Math.floor(d / 3600) + ' h ago'; return new Date(t).toLocaleDateString(); };
  K.bytes = n => { if (!n && n !== 0) return ''; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; };
})();
