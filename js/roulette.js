/* ═══════════════════════════════════════════════════
   WINNING ROULETTE — Full Circle Wheel Engine v4
   ・タイミングゲージ（強さ制御）
   ・物理ベース減速（指数減衰 + スプリング整定）
   ・アウトライン文字で高視認性
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

    /* ── ラベル（高視認性：背景ピル + アウトライン）── */
    for (let i = 0; i < n; i++) {
      const a0   = rotation + i * seg - Math.PI / 2;
      const midA = a0 + seg / 2;
      const isH  = (i === hilite);
      const lx   = cx + Math.cos(midA) * outerR * 0.63;
      const ly   = cy + Math.sin(midA) * outerR * 0.63;

      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(midA + Math.PI / 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

      const fs = n > 8 ? (outerR > 100 ? 11 : 9) : 14;
      ctx.font = `700 ${fs}px 'Noto Sans JP',sans-serif`;

      const maxW = outerR * 0.46;
      let label = items[i];
      while (ctx.measureText(label).width > maxW && label.length > 1)
        label = label.slice(0, -1);
      if (label !== items[i]) label = label.slice(0, -1) + '…';

      /* 背景ピル */
      const tw = Math.min(ctx.measureText(label).width + 8, maxW + 8);
      const th = fs + 6;
      ctx.fillStyle = isH ? 'rgba(255,240,80,0.3)' : 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-tw/2, -th/2, tw, th, 3);
      else ctx.rect(-tw/2, -th/2, tw, th);
      ctx.fill();

      /* アウトライン */
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
      ctx.lineJoin = 'round'; ctx.lineWidth = 3;
      ctx.strokeStyle = isH ? 'rgba(120,70,0,0.95)' : 'rgba(0,0,0,0.95)';
      ctx.strokeText(label, 0, 0);

      /* 本文 */
      ctx.fillStyle = isH ? '#1a0800' : '#ffffff';
      ctx.fillText(label, 0, 0);
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
     スピン（物理ベース減速）
     ① 等速高速回転フェーズ
     ② 指数減衰フェーズ（v = v0 * e^{-k*t}）
     ③ スプリング整定フェーズ（微小振動→収束）
  ══════════════════════════════════════════════ */
  function spin(state, canvas, items, colors, exclude, onDone, power) {
    if (state.spinning) return;
    state.spinning = true;

    const pw  = (power !== undefined ? Math.max(5, Math.min(100, power)) : 60);
    const n   = items.length;
    const seg = (2 * Math.PI) / n;

    let tgt;
    do { tgt = Math.floor(Math.random() * n); }
    while (exclude.includes(tgt));

    /* 目標角度 */
    const jitter   = (Math.random() - 0.5) * seg * 0.25;
    const tgtAngle = -(tgt + 0.5) * seg + jitter;
    const curNorm  = ((state.rot % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
    const tgtNorm  = ((tgtAngle  % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
    const diff     = (tgtNorm - curNorm + 2*Math.PI) % (2*Math.PI);

    /* パワーで回転数決定 (3〜9) */
    const rotations = 3 + Math.floor((pw / 100) * 6);
    const totalDelta = rotations * 2 * Math.PI + diff;
    const finalRot   = state.rot + totalDelta;

    /* ─ アニメーションフェーズ定義 ─
       Phase A [0, tA]  : 等速（高速）
       Phase B [tA, tB] : 指数減衰 v = vA * e^{-k*(t-tA)}
       Phase C [tB, tC] : スプリング整定
    */
    const totalMs = 3500 + (pw / 100) * 3500;  /* パワーが強いほど長い */
    const tA  = totalMs * 0.10;                  /* 等速フェーズ終了 */
    const tB  = totalMs * 0.88;                  /* 減衰フェーズ終了 */
    const tC  = totalMs;                          /* 整定フェーズ終了 */

    /* フェーズAでの回転量 = 全体の20% */
    const rotA     = totalDelta * 0.18;
    const vA       = rotA / (tA / 1000);         /* A フェーズの角速度 [rad/s] */

    /* フェーズBでの残り回転量（指数減衰で到達） */
    const rotB_total = totalDelta * 0.78;
    const tB_s       = (tB - tA) / 1000;
    /* v0/k*(1 - e^{-k*tB_s}) = rotB_total → k を数値的に解く (近似) */
    const k = 3.5 / tB_s;                         /* k ≈ ln(70) / tB_s で99% decay */

    /* Phase B 終了時点の推定角度 */
    const rotB_end = state.rot + rotA + rotB_total;

    /* Phase C: スプリング。finalRot への微小振動収束 */
    /* overshoot amplitude */
    const amp = seg * 0.55;

    const t0 = performance.now();

    function frame(now) {
      const elapsed = now - t0;
      let rot;

      if (elapsed < tA) {
        /* ─ Phase A: 等速 ─ */
        const p = elapsed / (tA / 1000) / 1000;
        rot = state.rot + vA * (elapsed / 1000);

      } else if (elapsed < tB) {
        /* ─ Phase B: 指数減衰 ─
           θ(t) = θ_A + (vA/k) * (1 - e^{-k*t})
           ここで t = elapsed - tA
        */
        const t  = (elapsed - tA) / 1000;
        const dθ = (vA / k) * (1 - Math.exp(-k * t));
        rot = state.rot + rotA + dθ;

      } else {
        /* ─ Phase C: スプリング整定 ─
           finalRot + overshoot * e^{-ζ*t} * cos(ω*t)
        */
        const t    = (elapsed - tB) / 1000;
        const tC_s = (tC - tB) / 1000;
        const prog = Math.min(t / tC_s, 1);
        const zeta = 6.0;   /* 減衰率 */
        const omega = 18.0; /* 振動数 */
        const env  = Math.exp(-zeta * t);
        rot = finalRot + amp * env * Math.cos(omega * t + Math.PI) * (1 - prog);
      }

      state.rot = rot;
      const done = elapsed >= tC;
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
    const cssW      = Math.min(available - 8, 284);
    const canvas    = makeCanvas(cssW, cssW);
    const state     = { rot: 0, spinning: false, animId: null };

    containerEl.appendChild(canvas);
    draw(canvas, items, colors, 0, -1);

    const wheel = {
      canvas, state, GAUGE,
      spin:     (exclude, onDone, power) => spin(state, canvas, items, colors, exclude, onDone, power),
      redraw:   (hilite = -1) => draw(canvas, items, colors, state.rot, hilite),
      resetRot: () => { state.rot = 0; },
      get spinning() { return state.spinning; },
    };
    return wheel;
  }

  return { create, PALETTE_12, PALETTE_6, GAUGE };
})();
