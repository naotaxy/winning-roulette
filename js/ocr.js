/* ═══════════════════════════════════════════════════
   OCR — ウイコレ試合結果スクリーンショット解析
   Tesseract.js (jpn+eng) を使用
   ═══════════════════════════════════════════════════ */
'use strict';

const OCR = (() => {
  let _worker = null;

  /* ── Tesseract ワーカー初期化（遅延ロード） ── */
  async function ensureWorker(onProgress) {
    if (_worker) return _worker;
    if (typeof Tesseract === 'undefined') {
      throw new Error('Tesseract.js が読み込まれていません');
    }
    _worker = await Tesseract.createWorker('jpn+eng', 1, {
      logger: m => {
        if (m.status === 'recognizing text' && onProgress) {
          onProgress(Math.round(m.progress * 100));
        }
      }
    });
    return _worker;
  }

  /* ── 画像の特定領域をクロップ（比率指定、拡大スケール付き） ── */
  function cropImage(imgEl, relX, relY, relW, relH, scale = 2) {
    const W = imgEl.naturalWidth;
    const H = imgEl.naturalHeight;
    const srcX = Math.round(W * relX);
    const srcY = Math.round(H * relY);
    const srcW = Math.round(W * relW);
    const srcH = Math.round(H * relH);
    const canvas = document.createElement('canvas');
    canvas.width  = srcW * scale;
    canvas.height = srcH * scale;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(imgEl, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  /* ── スコアと チーム名を解析 ── */
  async function parseMatchResult(imgFile, playerMap, onProgress) {
    const blobUrl = URL.createObjectURL(imgFile);
    const imgEl   = await loadImage(blobUrl);

    const worker = await ensureWorker(onProgress);

    /* ── 領域1: メインスコア（中央）
       比率: x=39.7%〜60.9%, y=26.4%〜32.9% ── */
    const scoreCanvas = cropImage(imgEl, 0.397, 0.264, 0.212, 0.065, 3);
    const scoreResult = await worker.recognize(scoreCanvas);
    const scoreText   = scoreResult.data.text;

    const scoreMatch = scoreText.match(/(\d+)\s*[-－]\s*(\d+)/);
    const awayScore  = scoreMatch ? parseInt(scoreMatch[1], 10) : null;
    const homeScore  = scoreMatch ? parseInt(scoreMatch[2], 10) : null;

    /* ── 領域2: PKスコア（スコア下）
       比率: x=39.0%〜61.6%, y=33.5%〜37.1% ── */
    const pkCanvas = cropImage(imgEl, 0.390, 0.335, 0.226, 0.036, 3);
    const pkResult = await worker.recognize(pkCanvas);
    const pkText   = pkResult.data.text;

    const pkMatch = pkText.match(/(\d+)\s*PK\s*(\d+)/i);
    const awayPK  = pkMatch ? parseInt(pkMatch[1], 10) : null;
    const homePK  = pkMatch ? parseInt(pkMatch[2], 10) : null;

    /* ── 領域3: AWAYプレイヤー名（左）
       比率: x=14.9%〜41.1%, y=36.5%〜39.7% ── */
    const awayCanvas = cropImage(imgEl, 0.149, 0.365, 0.262, 0.032, 3);
    const awayResult = await worker.recognize(awayCanvas);
    const awayRaw    = awayResult.data.text.trim().replace(/\n/g, ' ');

    /* ── 領域4: HOMEプレイヤー名（右）
       比率: x=60.2%〜91.4%, y=36.5%〜39.7% ── */
    const homeCanvas = cropImage(imgEl, 0.602, 0.365, 0.312, 0.032, 3);
    const homeResult = await worker.recognize(homeCanvas);
    const homeRaw    = homeResult.data.text.trim().replace(/\n/g, ' ');

    URL.revokeObjectURL(blobUrl);

    const awayChar = matchCharName(awayRaw, playerMap);
    const homeChar = matchCharName(homeRaw, playerMap);

    return {
      awayScore, homeScore,
      awayPK, homePK,
      awayChar, homeChar,
      awayRaw, homeRaw,
      scoreRaw: scoreText.trim(),
    };
  }

  /* ── OCRテキストとキャラクター名を照合 ── */
  function matchCharName(ocrText, playerMap) {
    if (!ocrText || !playerMap) return null;
    const normalized = ocrText.replace(/\s+/g, '').toLowerCase();

    let best = null, bestScore = 0;
    for (const [charName, playerName] of Object.entries(playerMap)) {
      const charNorm = charName.replace(/\s+/g, '').toLowerCase();
      const score    = similarity(normalized, charNorm);
      if (score > bestScore && score > 0.35) {
        bestScore = score;
        best = { charName, playerName, score };
      }
    }
    return best;
  }

  /* ── 文字列類似度（Jaccard + 部分一致ボーナス） ── */
  function similarity(a, b) {
    if (!a || !b) return 0;
    if (a.includes(b) || b.includes(a)) return 0.85;

    /* N-gram (bigram) による Jaccard 係数 */
    const ngA = ngrams(a, 2);
    const ngB = ngrams(b, 2);
    if (ngA.size === 0 || ngB.size === 0) return 0;

    let intersection = 0;
    for (const g of ngA) if (ngB.has(g)) intersection++;
    const union = ngA.size + ngB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  function ngrams(str, n) {
    const s = new Set();
    for (let i = 0; i <= str.length - n; i++) s.add(str.slice(i, i + n));
    return s;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = reject;
      img.src     = url;
    });
  }

  return { parseMatchResult, matchCharName };
})();
