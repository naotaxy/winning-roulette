/* ═══════════════════════════════════════════════════
   WINNING ROULETTE — Full Circle Wheel Engine v4
   ・タイミングゲージ（強さ制御）
   ・物理ベース減速（指数減衰 + スプリング整定）
   ・番号表示 + 外部凡例で高視認性
   ═══════════════════════════════════════════════════ */
'use strict';

const ROULETTE = (() => {

  /* ── HiDPI Canvas ── */
  function makeCanvas(cssW, cssH) {
    const dpr = window.devicePixelRatio || 1;
    const c   = document.createElement('canvas');
    c.width   = cssW * dpr; c.height = cssH * dpr;
    c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
    c.getContext('2d').scale(dpr, dpr);
    return c;
  }

  const PALETTE_12 = [
    '#b71c1c','#e65100','#f57f17','#1b5e20',
    '#0d47a1','#4a148c','#006064','#880e4f',
    '#bf360c','#1a237e','#004d40','#3e2723'
  ];
  const PALETTE_6 = [
    '#c62828','#1565c0','#c8960c','#2e7d32','#6a1b9a','#d84315'
  ];

  function lightenHex(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, ((n >> 16) & 0xff) + Math.round(255 * amt));
    const g = Math.min(255, ((n >>  8) & 0xff) + Math.round(255 * amt));
    const b = Math.min(255,  (n & 0xff)         + Math.round(255 * amt));
    return `rgb(${r},${g},${b})`;
  }

  /* ══════════════════════════════════════════════
     ホイール描画
  ══════════════════════════════════════════════ */
  function draw(canvas, items, colors, rotation, hilite) {
    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.width / dpr, H = canvas.height / dpr;
    const ctx = canvas.getContext('2d');
    const cx  = W / 2, cy = H / 2;
    const n   = items.length;
    const seg = (2 * Math.PI) / n;
    const totalR = Math.min(W, H) / 2;
    const outerR = totalR - 20;
    const hubR   = outerR * 0.13;

    ctx.clearRect(0, 0, W, H);

    /* ── 外縁リム ── */
    ctx.beginPath();
    ctx.arc(cx, cy, totalR - 4, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(10,12,32,0.88)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(212,175,55,0.75)';
    ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, outerR + 2, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(212,175,55,0.5)';
    ctx.lineWidth = 1.5; ctx.stroke();

    /* ── ティックマーク ── */
    for (let i = 0; i < n * 4; i++) {
      const a = (i / (n * 4)) * 2 * Math.PI;
      const major = (i % 4 === 0);
      const r0 = major ? outerR + 3 : outerR + 6;
      const r1 = totalR - 6;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.strokeStyle = major ? 'rgba(212,175,55,0.9)' : 'rgba(212,175,55,0.3)';
      ctx.lineWidth = major ? 2 : 1; ctx.stroke();
    }

    /* ── セグメント ── */
    for (let i = 0; i < n; i++) {
      const a0 = rotation + i * seg - Math.PI / 2;
      const a1 = a0 + seg;
      const isH = (i === hilite);

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, outerR, a0, a1);
      ctx.closePath();

      if (isH) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerR);
        g.addColorStop(0, '#fff9c4'); g.addColorStop(0.5, '#ffe066'); g.addColorStop(1, '#f9a825');
        ctx.fillStyle = g;
      } else {
        const midA = a0 + seg / 2;
        const mx = cx + Math.cos(midA) * outerR * 0.55;
        const my = cy + Math.sin(midA) * outerR * 0.55;
        const g = ctx.createRadialGradient(mx, my, 0, mx, my, outerR * 0.7);
        const base = colors[i % colors.length];
        g.addColorStop(0, lightenHex(base, 0.28)); g.addColorStop(1, base);
        ctx.fillStyle = g;
      }
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    }

    /* ── 仕切り線 ── */
    for (let i = 0; i < n; i++) {
      const a = rotation + i * seg - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * outerR, cy + Math.sin(a) * outerR);
      ctx.strokeStyle = 'rgba(212,175,55,0.25)'; ctx.lineWidth = 0.8; ctx.stroke();
    }

    /* ── 番号バッジ（長い文字は外部凡例で表示）── */
    for (let i = 0; i < n; i++) {
      const a0   = rotation + i * seg - Math.PI / 2;
      const midA = a0 + seg / 2;
      const isH  = (i === hilite);
      const lx   = cx + Math.cos(midA) * outerR * 0.68;
      const ly   = cy + Math.sin(midA) * outerR * 0.68;
      const badge = String(i + 1);

      ctx.save();
      ctx.translate(lx, ly);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

      const fs = n > 8 ? 12 : 16;
      const r  = n > 8 ? 12 : 16;
      ctx.font = `900 ${fs}px 'Orbitron','Noto Sans JP',sans-serif`;

      ctx.shadowColor = isH ? '#fff06a' : 'rgba(0,0,0,0.75)';
      ctx.shadowBlur = isH ? 16 : 6;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-r, -r, r * 2, r * 2, 3);
      else ctx.rect(-r, -r, r * 2, r * 2);
      ctx.fillStyle = isH ? '#fff06a' : 'rgba(7,9,26,0.82)';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = isH ? '#ff1744' : 'rgba(212,175,55,0.75)';
      ctx.lineWidth = isH ? 3 : 1.5;
      ctx.stroke();

      ctx.lineJoin = 'round'; ctx.lineWidth = 3;
      ctx.strokeStyle = isH ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)';
      ctx.strokeText(badge, 0, 1);
      ctx.fillStyle = isH ? '#1a0800' : '#fff7bd';
      ctx.fillText(badge, 0, 1);
      ctx.restore();
    }

    /* ── 当選セグメント外弧グロー ── */
    if (hilite >= 0) {
      const ha0 = rotation + hilite * seg - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, ha0, ha0 + seg);
      ctx.strokeStyle = 'rgba(255,230,80,0.85)';
      ctx.lineWidth = 6;
      ctx.shadowColor = '#ffe066'; ctx.shadowBlur = 20; ctx.stroke();
      ctx.shadowBlur = 0;
    }

    /* ── 中央ハブ ── */
    const hg = ctx.createRadialGradient(cx - hubR*0.3, cy - hubR*0.35, 0, cx, cy, hubR);
    hg.addColorStop(0, '#fff5aa'); hg.addColorStop(0.4, '#d4af37'); hg.addColorStop(1, '#6b4c10');
    ctx.beginPath(); ctx.arc(cx, cy, hubR, 0, 2 * Math.PI);
    ctx.fillStyle = hg; ctx.fill();
    ctx.strokeStyle = 'rgba(212,175,55,0.95)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, hubR * 0.3, 0, 2 * Math.PI);
    ctx.fillStyle = '#fff9e0'; ctx.fill();
  }

  /* ══════════════════════════════════════════════
     タイミングゲージ
  ══════════════════════════════════════════════ */
  const GAUGE = (() => {
    let _value   = 0;     /* 0〜100 */
    let _dir     = 1;
    let _speed   = 1.8;   /* フレームあたりの増分 */
    let _active  = false;
    let _raf     = null;
    let _el      = null;  /* ゲージバーの DOM 要素 */
    let _textEl  = null;

    function start(barEl, textEl) {
      _el     = barEl;
      _textEl = textEl;
      _value  = 0; _dir = 1; _active = true;
      _tick();
    }

    function _tick() {
      if (!_active) return;
      _value += _dir * _speed;
      if (_value >= 100) { _value = 100; _dir = -1; }
      if (_value <= 0)   { _value = 0;   _dir =  1; }

      if (_el) {
        _el.style.width = _value + '%';
        /* 色: 低=青 中=緑 高=赤 */
        const h = Math.round(120 - _value * 1.2);  /* 120°(緑)→0°(赤) */
        _el.style.background = `hsl(${h},90%,50%)`;
      }
      if (_textEl) _textEl.textContent = Math.round(_value) + '%';

      _raf = requestAnimationFrame(_tick);
    }

    function capture() {
      _active = false;
      cancelAnimationFrame(_raf);
      return Math.round(_value);
    }

    function stop() {
      _active = false;
      cancelAnimationFrame(_raf);
    }

    return { start, capture, stop };
  })();

  /* ══════════════════════════════════════════════
     スピン（cubic ease-out）
     ・先行コミット済み結果を優先して停止
     ・整数回転 + 目標角度補正
     ・4.2〜9.5 秒
  ══════════════════════════════════════════════ */
  function spin(state, canvas, items, colors, exclude, onDone, power, forcedTarget) {
    if (state.spinning) return;
    state.spinning = true;

    const pw  = (power !== undefined ? Math.max(5, Math.min(100, power)) : 60);
    const n   = items.length;
    const seg = (2 * Math.PI) / n;

    let tgt = Number.isInteger(forcedTarget) ? forcedTarget : null;
    if (tgt == null || tgt < 0 || tgt >= n || exclude.includes(tgt)) {
      do { tgt = Math.floor(Math.random() * n); }
      while (exclude.includes(tgt));
    }

    /* 目標角度 */
    const jitter   = (Math.random() - 0.5) * seg * 0.25;
    const tgtAngle = -(tgt + 0.5) * seg + jitter;
    const curNorm  = ((state.rot % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
    const tgtNorm  = ((tgtAngle  % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
    const diff     = (tgtNorm - curNorm + 2*Math.PI) % (2*Math.PI);

    /* パワーに応じた整数回転数: 4〜12周 + 差分 */
    const rotations  = 4 + Math.round((pw / 100) * 8);
    const totalDelta = rotations * 2 * Math.PI + diff;
    const finalRot   = state.rot + totalDelta;

    /* 4.2〜9.5 秒 */
    const totalMs  = 4200 + (pw / 100) * 5300;
    const startRot = state.rot;
    const t0       = performance.now();

    function frame(now) {
      const elapsed = now - t0;
      const prog    = Math.min(elapsed / totalMs, 1);
      /* cubic ease-out: 最初は速く → 終盤に急激に減速してドラマを演出 */
      const ease    = 1 - Math.pow(1 - prog, 3);
      state.rot     = startRot + totalDelta * ease;

      const done = prog >= 1;
      draw(canvas, items, colors, state.rot, done ? tgt : -1);

      if (!done) {
        state.animId = requestAnimationFrame(frame);
      } else {
        state.rot    = finalRot;
        state.spinning = false;
        draw(canvas, items, colors, state.rot, tgt);
        onDone(tgt);
      }
    }

    state.animId = requestAnimationFrame(frame);
  }

  /* ── ホイールインスタンス生成 ── */
  function create(containerEl, items, colors) {
    const available = containerEl.offsetWidth || 300;
    const vh        = window.innerHeight || 720;
    const maxByH    = vh < 680 ? 218 : vh < 760 ? 238 : 264;
    const cssW      = Math.min(available - 8, maxByH);
    const canvas    = makeCanvas(cssW, cssW);
    const state     = { rot: 0, spinning: false, animId: null };

    containerEl.appendChild(canvas);
    draw(canvas, items, colors, 0, -1);

    const wheel = {
      canvas, state, GAUGE,
      spin:     (exclude, onDone, power, targetIdx) => spin(state, canvas, items, colors, exclude, onDone, power, targetIdx),
      redraw:   (hilite = -1) => draw(canvas, items, colors, state.rot, hilite),
      resetRot: () => { state.rot = 0; },
      get spinning() { return state.spinning; },
    };
    return wheel;
  }

  return { create, PALETTE_12, PALETTE_6, GAUGE };
})();
