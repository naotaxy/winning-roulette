/* ═══════════════════════════════════════════════════
   WINNING ROULETTE — Full Circle Wheel Engine v3
   Roulette Agent: full 360° wheel, metallic hub,
   tick-mark outer ring, suspense animation
   ═══════════════════════════════════════════════════ */
'use strict';

const ROULETTE = (() => {

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

  const PALETTE_12 = [
    '#b71c1c','#e65100','#f57f17','#1b5e20',
    '#0d47a1','#4a148c','#006064','#880e4f',
    '#bf360c','#1a237e','#004d40','#3e2723'
  ];
  const PALETTE_6 = [
    '#c62828','#1565c0','#c8960c','#2e7d32','#6a1b9a','#d84315'
  ];

  function lightenHex(hex, amount) {
    const num = parseInt(hex.slice(1), 16);
    const r   = Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * amount));
    const g   = Math.min(255, ((num >>  8) & 0xff) + Math.round(255 * amount));
    const b   = Math.min(255,  (num & 0xff)         + Math.round(255 * amount));
    return `rgb(${r},${g},${b})`;
  }

  function draw(canvas, items, colors, rotation, hilite) {
    const dpr    = window.devicePixelRatio || 1;
    const W      = canvas.width  / dpr;
    const H      = canvas.height / dpr;
    const ctx    = canvas.getContext('2d');
    const cx     = W / 2;
    const cy     = H / 2;
    const n      = items.length;
    const segArc = (2 * Math.PI) / n;

    const totalR     = Math.min(W, H) / 2;
    const outerR     = totalR - 20;  // segment area
    const rimInnerR  = outerR + 2;
    const rimOuterR  = totalR - 4;
    const hubR       = outerR * 0.13;

    ctx.clearRect(0, 0, W, H);

    /* ── Outer rim fill ── */
    ctx.beginPath();
    ctx.arc(cx, cy, rimOuterR, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(10,12,32,0.9)';
    ctx.fill();

    /* ── Outer rim border ── */
    ctx.beginPath();
    ctx.arc(cx, cy, rimOuterR, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(212,175,55,0.75)';
    ctx.lineWidth   = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, rimInnerR, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(212,175,55,0.55)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    /* ── Tick marks ── */
    const numTicks = n * 4;
    for (let i = 0; i < numTicks; i++) {
      const a       = (i / numTicks) * 2 * Math.PI;
      const isMajor = (i % 4 === 0);
      const r0      = isMajor ? rimInnerR + 2 : rimInnerR + 5;
      const r1      = rimOuterR - 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.strokeStyle = isMajor ? 'rgba(212,175,55,0.9)' : 'rgba(212,175,55,0.35)';
      ctx.lineWidth   = isMajor ? 2 : 1;
      ctx.stroke();
    }

    /* ── Segments ── */
    for (let i = 0; i < n; i++) {
      const a0 = rotation + i * segArc - Math.PI / 2;
      const a1 = a0 + segArc;
      const isH = (i === hilite);

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, outerR, a0, a1);
      ctx.closePath();

      if (isH) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerR);
        g.addColorStop(0, '#fff9c4');
        g.addColorStop(0.5, '#ffe066');
        g.addColorStop(1,   '#f9a825');
        ctx.fillStyle = g;
      } else {
        const midA = a0 + segArc / 2;
        const mx   = cx + Math.cos(midA) * outerR * 0.55;
        const my   = cy + Math.sin(midA) * outerR * 0.55;
        const g    = ctx.createRadialGradient(mx, my, 0, mx, my, outerR * 0.7);
        const base = colors[i % colors.length];
        g.addColorStop(0, lightenHex(base, 0.28));
        g.addColorStop(1, base);
        ctx.fillStyle = g;
      }
      ctx.fill();

      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth   = 1;
      ctx.stroke();
    }

    /* ── Segment labels ── */
    for (let i = 0; i < n; i++) {
      const a0   = rotation + i * segArc - Math.PI / 2;
      const midA = a0 + segArc / 2;
      const isH  = (i === hilite);

      /* ラベル位置：セグメント中間のやや外寄り */
      const lx = cx + Math.cos(midA) * outerR * 0.63;
      const ly = cy + Math.sin(midA) * outerR * 0.63;

      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(midA + Math.PI / 2);
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';

      /* フォントサイズ：12択は少し大きく（可読性優先） */
      const fs = n > 8 ? (outerR > 100 ? 11 : 9) : 14;
      ctx.font = `700 ${fs}px 'Noto Sans JP',sans-serif`;

      /* テキスト最大幅に合わせてトリム */
      const maxW = outerR * 0.46;
      let label  = items[i];
      while (ctx.measureText(label).width > maxW && label.length > 1)
        label = label.slice(0, -1);
      if (label !== items[i]) label = label.slice(0, -1) + '…';

      /* ── 背景ピル（視認性向上）── */
      const tw = Math.min(ctx.measureText(label).width + 8, maxW + 8);
      const th = fs + 6;
      ctx.fillStyle = isH
        ? 'rgba(255,240,80,0.3)'
        : 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(-tw / 2, -th / 2, tw, th, 3);
      } else {
        ctx.rect(-tw / 2, -th / 2, tw, th);
      }
      ctx.fill();

      /* ── テキスト：アウトライン → 本文の順で描画 ── */
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur  = 0;
      ctx.lineJoin    = 'round';
      ctx.lineWidth   = 3;
      ctx.strokeStyle = isH ? 'rgba(120,70,0,0.95)' : 'rgba(0,0,0,0.95)';
      ctx.strokeText(label, 0, 0);

      ctx.fillStyle = isH ? '#1a0800' : '#ffffff';
      ctx.fillText(label, 0, 0);

      ctx.restore();
    }

    /* ── Separator lines between segments ── */
    for (let i = 0; i < n; i++) {
      const a = rotation + i * segArc - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * outerR, cy + Math.sin(a) * outerR);
      ctx.strokeStyle = 'rgba(212,175,55,0.3)';
      ctx.lineWidth   = 0.8;
      ctx.stroke();
    }

    /* ── Metallic center hub ── */
    const hg = ctx.createRadialGradient(
      cx - hubR * 0.3, cy - hubR * 0.35, 0,
      cx, cy, hubR
    );
    hg.addColorStop(0,   '#fff5aa');
    hg.addColorStop(0.4, '#d4af37');
    hg.addColorStop(1,   '#6b4c10');
    ctx.beginPath();
    ctx.arc(cx, cy, hubR, 0, 2 * Math.PI);
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(212,175,55,0.95)';
    ctx.lineWidth   = 2;
    ctx.stroke();

    /* Hub inner dot */
    ctx.beginPath();
    ctx.arc(cx, cy, hubR * 0.3, 0, 2 * Math.PI);
    ctx.fillStyle = '#fff9e0';
    ctx.fill();

    /* ── Winning segment outer glow arc ── */
    if (hilite >= 0) {
      const ha0  = rotation + hilite * segArc - Math.PI / 2;
      const ha1  = ha0 + segArc;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, ha0, ha1);
      ctx.strokeStyle = 'rgba(255,230,80,0.85)';
      ctx.lineWidth   = 5;
      ctx.shadowColor = '#ffe066';
      ctx.shadowBlur  = 18;
      ctx.stroke();
      ctx.shadowBlur  = 0;
    }
  }

  function easeOutQuint(t) { return 1 - Math.pow(1 - t, 5); }
  function smoothstep(t)   { return t * t * (3 - 2 * t); }

  function spin(state, canvas, items, colors, exclude, onDone) {
    if (state.spinning) return;
    state.spinning = true;

    const n      = items.length;
    const segArc = (2 * Math.PI) / n;

    let tgt;
    do { tgt = Math.floor(Math.random() * n); }
    while (exclude.includes(tgt));

    /* Target: center of segment tgt at pointer (top = -π/2)
       rotation + (tgt+0.5)*segArc - π/2 = -π/2
       → rotation = -(tgt+0.5)*segArc                    */
    const jitter   = (Math.random() - 0.5) * segArc * 0.3;
    const tgtAngle = -(tgt + 0.5) * segArc + jitter;

    const curNorm   = ((state.rot % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
    const tgtNorm   = ((tgtAngle  % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
    const diff      = (tgtNorm - curNorm + 2*Math.PI) % (2*Math.PI);
    const rotations = 5 + Math.floor(Math.random() * 4);
    const finalRot  = state.rot + rotations * 2 * Math.PI + diff;

    const KF = [
      [0.00, state.rot],
      [0.80, finalRot - segArc * 0.35],
      [0.87, finalRot + segArc * 1.4],
      [0.93, finalRot - segArc * 0.45],
      [0.97, finalRot + segArc * 0.12],
      [1.00, finalRot],
    ];
    const EASE = [easeOutQuint, smoothstep, smoothstep, smoothstep, smoothstep];

    const dur = 4200 + Math.random() * 1500;
    const t0  = performance.now();

    function frame(now) {
      const t = Math.min((now - t0) / dur, 1);
      let rot = KF[KF.length - 1][1];
      for (let i = 1; i < KF.length; i++) {
        if (t <= KF[i][0]) {
          const [ta, ra] = KF[i - 1];
          const [tb, rb] = KF[i];
          const local    = (t - ta) / (tb - ta);
          rot = ra + (rb - ra) * EASE[i - 1](local);
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

  function create(containerEl, items, colors) {
    const available = containerEl.offsetWidth || 300;
    const cssW      = Math.min(available - 8, 284);
    const cssH      = cssW; /* square canvas = full circle */
    const canvas    = makeCanvas(cssW, cssH);
    const state     = { rot: 0, spinning: false, animId: null };

    containerEl.appendChild(canvas);
    draw(canvas, items, colors, 0, -1);

    return {
      canvas,
      state,
      spin:     (exclude, onDone) => spin(state, canvas, items, colors, exclude, onDone),
      redraw:   (hilite = -1)     => draw(canvas, items, colors, state.rot, hilite),
      resetRot: ()                => { state.rot = 0; },
      get spinning() { return state.spinning; },
    };
  }

  return { create, PALETTE_12, PALETTE_6 };
})();
