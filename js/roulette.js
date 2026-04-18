/* ═══════════════════════════════════════════════════
   SEMI-CIRCULAR ROULETTE ENGINE
   — Shows only upper 180° of wheel
   — Suspense animation: overshoot → pull-back → settle
   ═══════════════════════════════════════════════════ */

'use strict';

const ROULETTE = (() => {

  /* ── HiDPI canvas factory ── */
  function makeCanvas(cssW, cssH) {
    const dpr = window.devicePixelRatio || 1;
    const c   = document.createElement('canvas');
    c.width   = cssW * dpr;
    c.height  = cssH * dpr;
    c.style.width  = cssW + 'px';
    c.style.height = cssH + 'px';
    c.getContext('2d').scale(dpr, dpr);
    return c;
  }

  /* ── Color set ── */
  const PALETTE_12 = [
    '#c0392b','#d35400','#e59b00','#16a085',
    '#27ae60','#2980b9','#1abc9c','#8e44ad',
    '#e91e63','#3f51b5','#00897b','#6d4c41'
  ];
  const PALETTE_6 = [
    '#e74c3c','#3498db','#d4af37','#2ecc71','#9b59b6','#e67e22'
  ];

  /* ── Draw semi-circular wheel ──
     Center point is at BOTTOM CENTER of canvas.
     We draw the top half (angles -π to 0),
     so only the upper arc is visible.
  ── */
  function draw(canvas, items, colors, rotation, hilite) {
    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.width  / dpr;
    const H   = canvas.height / dpr;
    const ctx = canvas.getContext('2d');

    const cx  = W / 2;
    const cy  = H;         // Center at bottom
    const r   = H - 6;     // Radius nearly fills height
    const n   = items.length;
    const arc = Math.PI / n; // Each segment spans π/n radians

    ctx.clearRect(0, 0, W, H);

    /* Draw each segment */
    for (let i = 0; i < n; i++) {
      // Without rotation, segment i goes from -π + i*arc to -π + (i+1)*arc
      // Add rotation offset
      const a0  = -Math.PI + i * arc + rotation;
      const a1  = a0 + arc;
      const isH = i === hilite;

      /* Segment fill */
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a0, a1);
      ctx.closePath();

      if (isH) {
        ctx.fillStyle = '#fff';
      } else {
        ctx.fillStyle = colors[i % colors.length];
      }
      ctx.fill();

      /* Segment border */
      ctx.strokeStyle = 'rgba(212,175,55,0.4)';
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      /* Label */
      const midA = a0 + arc / 2;
      const tx   = cx + Math.cos(midA) * r * 0.66;
      const ty   = cy + Math.sin(midA) * r * 0.66;

      ctx.save();
      ctx.translate(tx, ty);
      // Orient text perpendicular to radius (readable from outside)
      ctx.rotate(midA + Math.PI / 2);
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';

      const fontSize = n > 8 ? 10 : 13;
      ctx.font        = `700 ${fontSize}px 'Noto Sans JP',sans-serif`;
      ctx.fillStyle   = isH ? '#1a0f00' : '#fff';
      ctx.shadowColor = isH ? 'transparent' : 'rgba(0,0,0,0.7)';
      ctx.shadowBlur  = 2;

      /* Truncate if needed */
      const maxW = r * 0.48;
      let label  = items[i];
      while (ctx.measureText(label).width > maxW && label.length > 1)
        label = label.slice(0, -1);
      if (label !== items[i]) label = label.slice(0, -1) + '…';

      ctx.fillText(label, 0, 0);
      ctx.restore();
    }

    /* Divider line at flat bottom */
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.strokeStyle = 'rgba(212,175,55,0.5)';
    ctx.lineWidth   = 2;
    ctx.stroke();

    /* Center cap (half-circle) */
    ctx.beginPath();
    ctx.arc(cx, cy, 14, -Math.PI, 0);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 5, -Math.PI, 0);
    ctx.fillStyle = '#aaa';
    ctx.fill();

    /* Outer arc highlight */
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI, 0);
    ctx.strokeStyle = 'rgba(212,175,55,0.6)';
    ctx.lineWidth   = 2.5;
    ctx.stroke();
  }

  /* ── Easing ── */
  function easeOutQuint(t) { return 1 - Math.pow(1 - t, 5); }
  function smoothstep(t)   { return t * t * (3 - 2 * t); }

  /* ── Spin with suspense ──
     Keyframe path:
       0.00 → start
       0.80 → just before target (0.35 seg before)
       0.87 → OVERSHOOT 1.4 seg past target ← "goes past!"
       0.93 → PULL BACK 0.45 seg before target ← "comes back!"
       0.97 → tiny forward 0.12 seg past
       1.00 → settle exactly at target
  ── */
  function spin(state, canvas, items, colors, exclude, onDone) {
    if (state.spinning) return;
    state.spinning = true;

    const n    = items.length;
    const arc  = Math.PI / n; // semicircle arc per segment

    /* Pick target (not in exclude) */
    let tgt;
    do { tgt = Math.floor(Math.random() * n); }
    while (exclude.includes(tgt));

    /* Target rotation: center of segment tgt at pointer (angle -π/2)
       Without rotation: center of seg i is at -π + (i+0.5)*arc
       We want: -π + (i+0.5)*arc + rotation = -π/2
       → rotation = π/2 - (i+0.5)*arc                             */
    const jitter   = (Math.random() - 0.5) * arc * 0.4;
    const tgtAngle = Math.PI / 2 - (tgt + 0.5) * arc + jitter;

    /* Normalize diff so we always spin forward (positive direction) */
    const curNorm  = ((state.rot % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
    const tgtNorm  = ((tgtAngle  % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
    const diff     = (tgtNorm - curNorm + 2*Math.PI) % (2*Math.PI);
    const rotations = 4 + Math.floor(Math.random() * 4);
    const finalRot  = state.rot + rotations * 2 * Math.PI + diff;

    /* Suspense keyframes [time, abs_rotation] */
    const KF = [
      [0.00, state.rot],
      [0.80, finalRot - arc * 0.35],
      [0.87, finalRot + arc * 1.4],
      [0.93, finalRot - arc * 0.45],
      [0.97, finalRot + arc * 0.12],
      [1.00, finalRot],
    ];
    const EASE = [easeOutQuint, smoothstep, smoothstep, smoothstep, smoothstep];

    const dur = 4000 + Math.random() * 1500;
    const t0  = performance.now();

    function frame(now) {
      const t = Math.min((now - t0) / dur, 1);

      /* Interpolate through keyframes */
      let rot = KF[KF.length - 1][1];
      for (let i = 1; i < KF.length; i++) {
        if (t <= KF[i][0]) {
          const [ta, ra] = KF[i - 1];
          const [tb, rb] = KF[i];
          const local    = (t - ta) / (tb - ta);
          const e        = EASE[i - 1](local);
          rot = ra + (rb - ra) * e;
          break;
        }
      }

      state.rot = rot;
      draw(canvas, items, colors, state.rot, t >= 1 ? tgt : -1);

      if (t < 1) {
        state.animId = requestAnimationFrame(frame);
      } else {
        state.spinning = false;
        onDone(tgt);
      }
    }

    state.animId = requestAnimationFrame(frame);
  }

  /* ── Create wheel instance ── */
  function create(containerEl, items, colors) {
    const cssW  = containerEl.offsetWidth || 320;
    const cssH  = Math.min(Math.round(cssW * 0.52), 180);
    const canvas = makeCanvas(cssW, cssH);
    const state  = { rot: 0, spinning: false, animId: null };

    containerEl.appendChild(canvas);
    draw(canvas, items, colors, 0, -1);

    return {
      canvas,
      state,
      spin:  (exclude, onDone)        => spin(state, canvas, items, colors, exclude, onDone),
      redraw: (hilite = -1)           => draw(canvas, items, colors, state.rot, hilite),
      resetRot: ()                    => { state.rot = 0; },
      get spinning() { return state.spinning; },
    };
  }

  return { create, PALETTE_12, PALETTE_6 };
})();
