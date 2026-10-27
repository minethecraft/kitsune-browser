// Lightweight canvas particle engine: sakura, ember, snow, rain, firefly. Pauses when hidden. Capped DPR.
(function () {
  window.Particles = {
    start(canvas, type, opts) {
      opts = opts || {};
      if (!canvas || type === 'none') return () => {};
      const ctx = canvas.getContext('2d');
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      let W = 0, H = 0, raf = 0, last = 0, alive = true;
      const color = opts.color || getComputedStyle(document.documentElement).getPropertyValue('--fx').trim() || '#ffb3cf';
      const resize = () => { W = canvas.clientWidth; H = canvas.clientHeight; canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
      resize(); window.addEventListener('resize', resize);
      const count = Math.round(Math.min(opts.max || 70, Math.max(16, (W * H) / 26000)) * (opts.density || 1));
      const R = (a, b) => a + Math.random() * (b - a);
      const make = (init) => {
        const p = { x: R(0, W), y: init ? R(0, H) : -20, s: R(0.5, 1.4), a: R(0, 6.28), v: R(0.4, 1.2), sw: R(0.5, 2), ph: R(0, 6.28) };
        if (type === 'ember' || type === 'firefly') p.y = init ? R(0, H) : H + 10;
        if (type === 'rain') { p.x = R(-100, W); p.v = R(9, 16); p.s = R(8, 18); }
        return p;
      };
      const ps = Array.from({ length: count }, () => make(true));
      function petal(p, t) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.scale(1, 0.6 + 0.4 * Math.sin(t / 600 + p.ph));
        ctx.globalAlpha = 0.55 * p.s / 1.4 + 0.2; ctx.fillStyle = color;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(6 * p.s, -4 * p.s, 10 * p.s, 3 * p.s, 0, 9 * p.s); ctx.bezierCurveTo(-10 * p.s, 3 * p.s, -6 * p.s, -4 * p.s, 0, 0); ctx.fill(); ctx.restore();
      }
      function frame(t) {
        if (!alive) return; raf = requestAnimationFrame(frame);
        if (document.hidden || t - last < 28) return; // ~35fps cap
        const dt = Math.min((t - last) / 16.7, 3); last = t;
        ctx.clearRect(0, 0, W, H);
        for (const p of ps) {
          if (type === 'sakura') { p.y += p.v * p.s * dt * 0.9; p.x += Math.sin(t / 900 + p.ph) * p.sw * 0.5 * dt + 0.35 * dt; p.a += 0.012 * dt; petal(p, t); if (p.y > H + 20 || p.x > W + 20) Object.assign(p, make(false), { x: R(-40, W) }); }
          else if (type === 'snow') { p.y += p.v * 0.6 * dt; p.x += Math.sin(t / 1200 + p.ph) * 0.4 * dt; ctx.globalAlpha = 0.35 + 0.4 * p.s / 1.4; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, 1 + p.s * 1.2, 0, 6.28); ctx.fill(); if (p.y > H + 5) Object.assign(p, make(false)); }
          else if (type === 'ember') { p.y -= p.v * 0.9 * dt; p.x += Math.sin(t / 700 + p.ph) * 0.5 * dt; const l = Math.max(0, p.y / H); ctx.globalAlpha = 0.15 + 0.7 * l; ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(p.x, p.y, 1 + p.s, 0, 6.28); ctx.fill(); ctx.shadowBlur = 0; if (p.y < -10) Object.assign(p, make(false)); }
          else if (type === 'firefly') { p.x += Math.sin(t / 1500 + p.ph) * 0.35 * dt; p.y += Math.cos(t / 1700 + p.ph) * 0.3 * dt - 0.08 * dt; const tw = 0.5 + 0.5 * Math.sin(t / 500 + p.ph * 3); ctx.globalAlpha = 0.1 + 0.8 * tw; ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.beginPath(); ctx.arc(p.x, p.y, 1.2 + p.s, 0, 6.28); ctx.fill(); ctx.shadowBlur = 0; if (p.y < -10 || p.y > H + 10) Object.assign(p, make(true)); }
          else if (type === 'rain') { p.y += p.v * dt; p.x += p.v * 0.18 * dt; ctx.globalAlpha = 0.25; ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.s * 0.18, p.y - p.s); ctx.stroke(); if (p.y > H + 20) Object.assign(p, make(false), { y: -20 }); }
        }
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(frame);
      return () => { alive = false; cancelAnimationFrame(raf); window.removeEventListener('resize', resize); ctx.clearRect(0, 0, W, H); };
    }
  };
})();
