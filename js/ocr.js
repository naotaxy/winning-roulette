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

  /* ── 前処理: 白文字×暗背景 → 黒文字×白背景（Tesseract精度向上）
     ウイコレのスコア数字は白文字なので、反転することで
     誤認識（1→4 など）が大幅に減少する ── */
  function preprocessForOCR(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const val = lum > 150 ? 0 : 255;  /* 明 → 黒文字、暗 → 白背景 */
      d[i] = d[i + 1] = d[i + 2] = val;
      d[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  /* ── スコアとチーム名を解析 ── */
  async function parseMatchResult(imgFile, playerMap, onProgress) {
    const blobUrl = URL.createObjectURL(imgFile);
    const imgEl   = await loadImage(blobUrl);
    const worker  = await ensureWorker(onProgress);

    /* ── 領域1: メインスコア（中央）
       ステータスバー有無でY位置が異なるため y=19〜55% を広めにスキャン。
       HP/スタミナバー（y≈0〜14%）と統計テーブル（y≈60%〜）は除外。
       前処理で白数字を黒文字化し誤認識を防ぐ ── */
    const scoreCanvas = cropImage(imgEl, 0.20, 0.19, 0.60, 0.36, 3);
    preprocessForOCR(scoreCanvas);
    const scoreResult = await worker.recognize(scoreCanvas);
    const scoreText   = scoreResult.data.text;
    const scoreMatch  = scoreText.match(/(\d+)\s*[-－]\s*(\d+)/);
    const leftScore   = scoreMatch ? parseInt(scoreMatch[1], 10) : null;
    const rightScore  = scoreMatch ? parseInt(scoreMatch[2], 10) : null;

    /* ── 領域2: PKスコア（スコア直下）
       y=32〜57% に限定して統計テーブル（y≈58%〜）への侵入を防ぐ。
       これにより「パスカット回数」などが「PK」に誤読される問題を解消。
       PKスコアのある画像: JPG y≈38〜45%, PNG y≈50〜57%（どちらも範囲内）
       前処理で精度向上 ── */
    const pkCanvas = cropImage(imgEl, 0.20, 0.32, 0.60, 0.25, 3);
    preprocessForOCR(pkCanvas);
    const pkResult = await worker.recognize(pkCanvas);
    const pkText   = pkResult.data.text;
    const pkMatch  = pkText.match(/(\d+)\s*PK\s*(\d+)/i);
    const leftPK   = pkMatch ? parseInt(pkMatch[1], 10) : null;
    const rightPK  = pkMatch ? parseInt(pkMatch[2], 10) : null;

    /* ── 領域3: 左バッジ（HOME / AWAY 判定）
       左チームのバッジが "HOME"（緑）か "AWAY"（赤）かを検出。
       これで左右のスコアとチーム名を正しく割り当てる ── */
    const leftBadgeCanvas = cropImage(imgEl, 0.02, 0.12, 0.42, 0.32, 2);
    const leftBadgeResult = await worker.recognize(leftBadgeCanvas);
    const leftBadgeText   = leftBadgeResult.data.text.toUpperCase().replace(/\s/g, '');
    const leftIsHome      = leftBadgeText.includes('HOME');

    /* ── 領域4・5: チーム名（左右）
       y=40〜70% をスキャン。
       JPGレイアウト: チーム名 y≈43〜51%（範囲内）
       PNGレイアウト: チーム名 y≈58〜66%（範囲内）
       得点者リスト（y≈58〜68%）が混入する可能性があるが
       ファジーマッチングで既知チーム名に絞るため影響は軽微 ── */
    const leftNameCanvas  = cropImage(imgEl, 0.00, 0.40, 0.52, 0.30, 3);
    const leftNameResult  = await worker.recognize(leftNameCanvas);
    const leftRaw         = leftNameResult.data.text.trim().replace(/\n/g, ' ');

    const rightNameCanvas = cropImage(imgEl, 0.44, 0.40, 0.56, 0.30, 3);
    const rightNameResult = await worker.recognize(rightNameCanvas);
    const rightRaw        = rightNameResult.data.text.trim().replace(/\n/g, ' ');

    URL.revokeObjectURL(blobUrl);

    /* ── HOME/AWAY を左右から正しく割り当て ── */
    const leftChar  = matchCharName(leftRaw, playerMap);
    const rightChar = matchCharName(rightRaw, playerMap);

    const homeScore = leftIsHome ? leftScore  : rightScore;
    const awayScore = leftIsHome ? rightScore : leftScore;
    const homePK    = leftIsHome ? leftPK     : rightPK;
    const awayPK    = leftIsHome ? rightPK    : leftPK;
    const homeChar  = leftIsHome ? leftChar   : rightChar;
    const awayChar  = leftIsHome ? rightChar  : leftChar;
    const homeRaw   = leftIsHome ? leftRaw    : rightRaw;
    const awayRaw   = leftIsHome ? rightRaw   : leftRaw;

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
      if (score > bestScore && score > 0.30) {
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

    /* 単語単位での部分一致チェック */
    const wordsB = b.split(/\s+/);
    for (const w of wordsB) {
      if (w.length >= 2 && a.includes(w)) return 0.75;
    }

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
