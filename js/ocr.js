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

  /* ── スコアとチーム名を解析 ── */
  async function parseMatchResult(imgFile, playerMap, onProgress) {
    const blobUrl = URL.createObjectURL(imgFile);
    const imgEl   = await loadImage(blobUrl);

    const worker = await ensureWorker(onProgress);

    /* ── 領域1: メインスコア（中央広域）
       画像によってステータスバーの有無でY位置が変わるため
       y=16%〜62% の広い範囲をスキャン ── */
    const scoreCanvas = cropImage(imgEl, 0.18, 0.16, 0.64, 0.46, 3);
    const scoreResult = await worker.recognize(scoreCanvas);
    const scoreText   = scoreResult.data.text;
    const scoreMatch  = scoreText.match(/(\d+)\s*[-－]\s*(\d+)/);
    const leftScore   = scoreMatch ? parseInt(scoreMatch[1], 10) : null;
    const rightScore  = scoreMatch ? parseInt(scoreMatch[2], 10) : null;

    /* ── 領域2: PKスコア（広域）
       PKスコアはメインスコアのすぐ下に出るため同じ広域でスキャン ── */
    const pkCanvas = cropImage(imgEl, 0.18, 0.26, 0.64, 0.46, 3);
    const pkResult = await worker.recognize(pkCanvas);
    const pkText   = pkResult.data.text;
    const pkMatch  = pkText.match(/(\d+)\s*PK\s*(\d+)/i);
    const leftPK   = pkMatch ? parseInt(pkMatch[1], 10) : null;
    const rightPK  = pkMatch ? parseInt(pkMatch[2], 10) : null;

    /* ── 領域3: 左側バッジ（HOME / AWAY 判定）
       左チームのバッジが HOME か AWAY かを検出して正しく割り当てる
       y=13%〜42% をスキャン（ステータスバー有無両対応） ── */
    const leftBadgeCanvas = cropImage(imgEl, 0.02, 0.13, 0.42, 0.30, 2);
    const leftBadgeResult = await worker.recognize(leftBadgeCanvas);
    const leftBadgeText   = leftBadgeResult.data.text.toUpperCase().replace(/\s/g, '');
    /* "HOME" が含まれれば左=HOME、含まれなければ左=AWAY（デフォルト） */
    const leftIsHome = leftBadgeText.includes('HOME');

    /* ── 領域4: 左チーム名
       チーム名はスコアより下、y=36%〜68% で左半分をスキャン ── */
    const leftNameCanvas = cropImage(imgEl, 0.00, 0.36, 0.52, 0.32, 3);
    const leftNameResult = await worker.recognize(leftNameCanvas);
    const leftRaw        = leftNameResult.data.text.trim().replace(/\n/g, ' ');

    /* ── 領域5: 右チーム名
       y=36%〜68% で右半分をスキャン ── */
    const rightNameCanvas = cropImage(imgEl, 0.44, 0.36, 0.56, 0.32, 3);
    const rightNameResult = await worker.recognize(rightNameCanvas);
    const rightRaw        = rightNameResult.data.text.trim().replace(/\n/g, ' ');

    URL.revokeObjectURL(blobUrl);

    /* ── HOME/AWAY を左右から正しく割り当て ── */
    const leftChar  = matchCharName(leftRaw, playerMap);
    const rightChar = matchCharName(rightRaw, playerMap);

    const homeScore = leftIsHome ? leftScore : rightScore;
    const awayScore = leftIsHome ? rightScore : leftScore;
    const homePK    = leftIsHome ? leftPK    : rightPK;
    const awayPK    = leftIsHome ? rightPK   : leftPK;
    const homeChar  = leftIsHome ? leftChar  : rightChar;
    const awayChar  = leftIsHome ? rightChar : leftChar;
    const homeRaw   = leftIsHome ? leftRaw   : rightRaw;
    const awayRaw   = leftIsHome ? rightRaw  : leftRaw;

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
