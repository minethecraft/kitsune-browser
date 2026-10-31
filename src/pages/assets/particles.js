// Kitsune particle engine v2. Canvas 2D, no dependencies.
// Types: sakura · leaves · ember · lantern · snow · rain · firefly · stars · bubbles · aurora
// Depth (z) layers give parallax, particles react to the pointer, glows are pre-rendered sprites (no per-frame shadowBlur),
// the loop pauses when the page is hidden, and the frame rate / DPR are capped to stay light on battery.
(function () {
  const TAU = Math.PI * 2;
  const R = (a, b) => a + Math.random() * (b - a);
  const hex = h => { h = String(h || '#ffffff').trim(); if (/^#[0-9a-f]{3}$/i.test(h)) h = '#' + h.slice(1).split('').map(c => c + c).join(''); const n = parseInt(h.slice(1, 7), 16); return isNaN(n) ? [255, 255, 255] : [n >> 16, (n >> 8) & 255, n & 255]; };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map(Math.round);

  function glowSprite(c, size) { // soft round glow
    const s = document.createElement('canvas'); s.width = s.height = size; const g = s.getContext('2d');
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, rgba(c, 1)); gr.addColorStop(0.25, rgba(c, 0.55)); gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr; g.fillRect(0, 0, size, size); return s;
  }

  window.Particles = {
    types: ['sakura', 'leaves', 'ember', 'lantern', 'snow', 'rain', 'firefly', 'stars', 'bubbles', 'aurora'],
    start(canvas, type, opts) {
      opts = opts || {};
      if (!canvas || !type || type === 'none') return () => {};
      const ctx = canvas.getContext('2d');
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const css = getComputedStyle(document.documentElement);
      const c1 = hex(opts.color || css.getPropertyValue('--fx').trim() || '#ffb3cf');
      const c2 = hex(css.getPropertyValue('--accent2').trim() || '#ffc86b');
      const c3 = hex(css.getPropertyValue('--accent').trim() || '#ff8fb8');
      let W = 0, H = 0, raf = 0, last = 0, alive = true, mx = -9999, my = -9999, wind = 0;
      const resize = () => { W = canvas.clientWidth; H = canvas.clientHeight; canvas.width = Math.max(1, W * dpr); canvas.height = Math.max(1, H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
      resize();
      const onResize = () => { resize(); };
      const onMove = e => { const r = canvas.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; };
      const onLeave = () => { mx = my = -9999; };
      window.addEventListener('resize', onResize);
      if (opts.pointer !== false) { window.addEventListener('pointermove', onMove, { passive: true }); document.addEventListener('pointerleave', onLeave); }

      const area = Math.max(W * H, 1);
      const base = { sakura: 26000, leaves: 34000, ember: 30000, lantern: 90000, snow: 15000, rain: 11000, firefly: 38000, stars: 5200, bubbles: 42000, aurora: 1, }[type] || 26000;
      const count = Math.max(opts.min || 6, Math.round(Math.min(opts.max || 90, area / base) * (opts.density || 1)));
      const glowS = { c1: glowSprite(c1, 64), c2: glowSprite(c2, 64), c3: glowSprite(c3, 64) };
      const pick = () => { const r = Math.random(); return r < .6 ? c1 : r < .85 ? c2 : c3; };
      const ripples = [], shooters = [];

      function make(init) {
        const z = R(0.35, 1.25);                         // depth: small/slow/faint = far, big/fast = near
        const p = { x: R(-20, W + 20), y: init ? R(0, H) : R(-30, -8), z, s: z, a: R(0, TAU), v: R(0.5, 1.2) * z, ph: R(0, TAU), sw: R(0.5, 2), c: pick(), life: R(0.6, 1), spin: R(-1, 1) };
        if (type === 'ember' || type === 'firefly' || type === 'bubbles' || type === 'lantern') p.y = init ? R(0, H) : H + R(8, 40);
        if (type === 'rain') { p.v = R(9, 17) * z; p.len = R(10, 22) * z; p.y = init ? R(0, H) : R(-40, -5); p.gy = H - R(2, Math.max(8, H * 0.34)); }
        if (type === 'stars') { p.y = R(0, H); p.r = R(0.4, 1.5) * (0.6 + z * 0.5); p.tw = R(0.4, 1.8); }
        if (type === 'lantern') { p.z = R(0.6, 1.3); p.v = R(0.18, 0.42) * p.z; }
        if (type === 'bubbles') { p.r = R(3, 12) * z; p.v = R(0.35, 1) * z; }
        if (type === 'snow') p.r = R(1, 3.4) * z;
        return p;
      }
      const ps = Array.from({ length: type === 'aurora' ? 0 : count }, () => make(true));

      // pointer push: nearby particles are nudged away, strength falls off with distance
      function push(p, dt, k) {
        const dx = p.x - mx, dy = p.y - my, d2 = dx * dx + dy * dy, r = 110;
        if (d2 < r * r && d2 > 1) { const d = Math.sqrt(d2), f = (1 - d / r) * k * dt; p.x += dx / d * f; p.y += dy / d * f; }
      }

      const drawPetal = (p, t) => {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.scale(1, 0.55 + 0.45 * Math.sin(t / 650 + p.ph));
        ctx.globalAlpha = 0.28 + 0.5 * (p.z / 1.25); const s = p.s * 1.1;
        const gr = ctx.createLinearGradient(0, 0, 0, 10 * s); gr.addColorStop(0, rgba(p.c, 1)); gr.addColorStop(1, rgba(mix(p.c, [255, 255, 255], 0.35), 1));
        ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.bezierCurveTo(7 * s, -5 * s, 11 * s, 3 * s, 1 * s, 10 * s); ctx.lineTo(0, 8 * s); ctx.lineTo(-1 * s, 10 * s);
        ctx.bezierCurveTo(-11 * s, 3 * s, -7 * s, -5 * s, 0, 0); ctx.fill(); ctx.restore();
      };
      const drawLeaf = (p, t) => {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a + Math.sin(t / 700 + p.ph) * 0.5); ctx.scale(1, 0.6 + 0.4 * Math.cos(t / 800 + p.ph));
        ctx.globalAlpha = 0.35 + 0.5 * (p.z / 1.25); const s = p.s * 1.3;
        ctx.fillStyle = rgba(p.c, 1); ctx.beginPath(); ctx.moveTo(0, -8 * s);
        ctx.bezierCurveTo(7 * s, -4 * s, 7 * s, 5 * s, 0, 9 * s); ctx.bezierCurveTo(-7 * s, 5 * s, -7 * s, -4 * s, 0, -8 * s); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(0, -7 * s); ctx.lineTo(0, 9 * s); ctx.stroke(); ctx.restore();
      };
      const spr = (img, x, y, r, a) => { ctx.globalAlpha = Math.max(0, Math.min(1, a)); ctx.drawImage(img, x - r, y - r, r * 2, r * 2); };
      const sprFor = c => c === c1 ? glowS.c1 : c === c2 ? glowS.c2 : glowS.c3;

      function frame(t) {
        if (!alive) return; raf = requestAnimationFrame(frame);
        if (document.hidden || t - last < 24) return;
        const dt = Math.min((t - last) / 16.7, 3); last = t;
        ctx.clearRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over';
        wind = Math.sin(t / 5200) * 0.55 + Math.sin(t / 1700) * 0.25;   // slow gusts

        if (type === 'aurora') { drawAurora(t); ctx.globalAlpha = 1; return; }

        if (type === 'stars') {
          for (const p of ps) {
            const tw = 0.45 + 0.55 * Math.sin(t / 700 * p.tw + p.ph);
            const ox = (mx > -999 ? (mx / W - 0.5) * -10 * p.z : 0), oy = (my > -999 ? (my / H - 0.5) * -6 * p.z : 0);
            ctx.globalAlpha = 0.15 + 0.85 * tw * (0.5 + p.z / 2.5); ctx.fillStyle = rgba(p.c === c3 ? c1 : p.c, 1);
            ctx.beginPath(); ctx.arc(p.x + ox, p.y + oy, p.r, 0, TAU); ctx.fill();
            if (p.r > 1.15 && tw > 0.85) { ctx.globalAlpha = 0.5 * tw; ctx.fillRect(p.x + ox - 3.5, p.y + oy - 0.4, 7, 0.8); ctx.fillRect(p.x + ox - 0.4, p.y + oy - 3.5, 0.8, 7); }
          }
          if (Math.random() < 0.006 * dt && shooters.length < 2) shooters.push({ x: R(W * 0.1, W), y: R(0, H * 0.45), vx: -R(7, 11), vy: R(3, 6), life: 1 });
          for (let i = shooters.length - 1; i >= 0; i--) {
            const s = shooters[i]; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= 0.016 * dt;
            const g = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 7, s.y - s.vy * 7); g.addColorStop(0, rgba(c1, 1)); g.addColorStop(1, rgba(c1, 0));
            ctx.globalAlpha = Math.max(0, s.life); ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 7, s.y - s.vy * 7); ctx.stroke();
            if (s.life <= 0 || s.x < -60 || s.y > H + 60) shooters.splice(i, 1);
          }
          ctx.globalAlpha = 1; return;
        }

        if (type === 'rain') {
          ctx.lineCap = 'round';
          for (const p of ps) {
            p.y += p.v * dt; p.x += (p.v * 0.16 + wind * 2) * dt;
            ctx.globalAlpha = 0.14 + 0.3 * p.z / 1.25; ctx.strokeStyle = rgba(p.c === c3 ? c1 : p.c, 1); ctx.lineWidth = 0.7 + p.z * 0.6;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - (p.v * 0.16 + wind * 2) * 1.2, p.y - p.len); ctx.stroke();
            if (p.y >= p.gy) { if (ripples.length < 40 && Math.random() < 0.7) ripples.push({ x: p.x, y: p.gy, r: 1, a: 0.5 * p.z }); Object.assign(p, make(false)); p.x = R(-60, W); }
          }
          for (let i = ripples.length - 1; i >= 0; i--) {
            const r = ripples[i]; r.r += 0.7 * dt; r.a -= 0.012 * dt;
            if (r.a <= 0) { ripples.splice(i, 1); continue; }
            ctx.globalAlpha = r.a; ctx.strokeStyle = rgba(c1, 1); ctx.lineWidth = 0.9; ctx.beginPath(); ctx.ellipse(r.x, r.y, r.r * 2.2, r.r * 0.7, 0, 0, TAU); ctx.stroke();
          }
          ctx.globalAlpha = 1; return;
        }

        // glow types are drawn additively
        if (type === 'ember' || type === 'firefly' || type === 'lantern') ctx.globalCompositeOperation = 'lighter';
        for (const p of ps) {
          if (mx > -999) push(p, dt, type === 'lantern' ? 0.5 : 2.2);
          if (type === 'sakura') {
            p.y += (0.55 + p.v * 0.9) * dt; p.x += (Math.sin(t / 1000 + p.ph) * p.sw * 0.45 + 0.3 + wind * 1.4 * p.z) * dt; p.a += (0.012 + p.spin * 0.01) * dt; drawPetal(p, t);
            if (p.y > H + 24 || p.x > W + 30 || p.x < -40) Object.assign(p, make(false), { x: R(-60, W) });
          } else if (type === 'leaves') {
            p.y += (0.5 + p.v * 0.8) * dt; p.x += (Math.sin(t / 650 + p.ph) * 1.1 * p.z + wind * 1.8 * p.z) * dt; p.a += p.spin * 0.02 * dt; drawLeaf(p, t);
            if (p.y > H + 24 || p.x > W + 30 || p.x < -40) Object.assign(p, make(false), { x: R(-60, W) });
          } else if (type === 'snow') {
            p.y += (0.35 + p.v * 0.55) * dt; p.x += (Math.sin(t / 1300 + p.ph) * 0.35 + wind * 0.9 * p.z) * dt;
            spr(glowS.c1, p.x, p.y, p.r * 2.2, 0.28 + 0.5 * p.z / 1.25);
            if (p.y > H + 6 || p.x > W + 10 || p.x < -10) Object.assign(p, make(false), { x: R(-10, W) });
          } else if (type === 'ember') {
            p.y -= (0.4 + p.v * 0.9) * dt; p.x += (Math.sin(t / 700 + p.ph) * 0.5 + wind * 0.8) * dt; p.life -= 0.0016 * dt;
            const fl = 0.6 + 0.4 * Math.sin(t / 90 + p.ph * 5), l = Math.max(0, p.y / H);
            spr(sprFor(p.c), p.x, p.y, (2 + p.z * 4.5) * (0.6 + l * 0.6), (0.2 + 0.75 * l) * fl * Math.min(1, p.life * 3));
            if (p.y < -12 || p.life <= 0) Object.assign(p, make(false), { x: R(0, W) });
          } else if (type === 'firefly') {
            p.x += (Math.sin(t / 1500 + p.ph) * 0.45 + Math.sin(t / 430 + p.ph * 2) * 0.12) * dt; p.y += (Math.cos(t / 1700 + p.ph) * 0.38 - 0.06) * dt;
            const tw = 0.5 + 0.5 * Math.sin(t / 520 + p.ph * 3); spr(sprFor(p.c), p.x, p.y, 3 + p.z * 6, 0.08 + 0.9 * tw * tw);
            if (p.y < -12 || p.y > H + 12 || p.x < -20 || p.x > W + 20) Object.assign(p, make(true));
          } else if (type === 'lantern') {
            p.y -= p.v * dt; p.x += (Math.sin(t / 2200 + p.ph) * 0.3 + wind * 0.5) * dt;
            const fl = 0.8 + 0.2 * Math.sin(t / 140 + p.ph * 6), sz = 7 + p.z * 7;
            spr(sprFor(p.c), p.x, p.y, sz * 3.2, 0.35 * fl);
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 0.85;
            ctx.fillStyle = rgba(mix(p.c, [255, 240, 200], 0.55), 1); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(p.x - sz * 0.45, p.y - sz * 0.55, sz * 0.9, sz * 1.1, sz * 0.18) : ctx.rect(p.x - sz * 0.45, p.y - sz * 0.55, sz * 0.9, sz * 1.1); ctx.fill();
            ctx.globalCompositeOperation = 'lighter';
            if (p.y < -30) Object.assign(p, make(false), { x: R(0, W) });
          } else if (type === 'bubbles') {
            p.y -= p.v * dt; p.x += (Math.sin(t / 900 + p.ph) * 0.45 + wind * 0.4) * dt;
            ctx.globalAlpha = 0.3 + 0.35 * p.z / 1.25; ctx.strokeStyle = rgba(p.c, 1); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke();
            ctx.globalAlpha *= 0.35; ctx.fillStyle = rgba(p.c, 1); ctx.fill();
            ctx.globalAlpha = 0.6; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.68, Math.PI * 1.1, Math.PI * 1.45); ctx.stroke();
            if (p.y < -20) Object.assign(p, make(false), { x: R(0, W) });
          }
        }
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      }

      // aurora: stacked curtains, each a wavy band of vertical gradient strips (additive)
      const bands = [{ c: c1, o: 0.0, f: 1.0 }, { c: c2, o: 2.1, f: 0.72 }, { c: c3, o: 4.2, f: 1.3 }];
      function drawAurora(t) {
        ctx.globalCompositeOperation = 'lighter'; const step = Math.max(6, Math.round(W / 140)); const bh = H * 0.7;
        for (const b of bands) {
          const g = ctx.createLinearGradient(0, 0, 0, bh); g.addColorStop(0, rgba(b.c, 0)); g.addColorStop(0.45, rgba(b.c, 0.5)); g.addColorStop(1, rgba(b.c, 0));
          ctx.fillStyle = g;
          for (let x = 0; x < W + step; x += step) {
            const y = H * 0.12 + Math.sin(x / (170 / b.f) + t / 2600 + b.o) * H * 0.1 + Math.sin(x / 70 + t / 1500 + b.o * 2) * H * 0.03;
            ctx.globalAlpha = 0.16 + 0.12 * Math.sin(x / 130 + t / 1900 + b.o);
            ctx.save(); ctx.translate(0, y - H * 0.04); ctx.fillRect(x, 0, step + 1, bh); ctx.restore();
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      raf = requestAnimationFrame(frame);
      return () => { alive = false; cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); window.removeEventListener('pointermove', onMove); document.removeEventListener('pointerleave', onLeave); ctx.clearRect(0, 0, W, H); };
    }
  };
})();
