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

  /* ── 画像の特定領域をキャンバスでクロップ ── */
  function cropImage(imgEl, relX, relY, relW, relH) {
    const canvas = document.createElement('canvas');
    const W = imgEl.naturalWidth;
    const H = imgEl.naturalHeight;
    canvas.width  = Math.round(W * relW);
    canvas.height = Math.round(H * relH);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(
      imgEl,
      Math.round(W * relX), Math.round(H * relY),
      canvas.width, canvas.height,
      0, 0, canvas.width, canvas.height
    );
    return canvas;
  }

  /* ── スコアと チーム名を解析 ── */
  async function parseMatchResult(imgFile, playerMap, onProgress) {
    /* imgFile: File オブジェクト */
    const blobUrl = URL.createObjectURL(imgFile);
    const imgEl   = await loadImage(blobUrl);

    const worker = await ensureWorker(onProgress);

    /* ── 領域1: スコアエリア（画像上半分の中央） ── */
    const scoreCanvas = cropImage(imgEl, 0.2, 0.10, 0.6, 0.22);
    const scoreResult = await worker.recognize(scoreCanvas);
    const scoreText   = scoreResult.data.text;

    /* スコアパターン: 数字 - 数字 */
    const scoreMatch = scoreText.match(/(\d+)\s*[-－]\s*(\d+)/);
    const awayScore = scoreMatch ? parseInt(scoreMatch[1], 10) : null;
    const homeScore = scoreMatch ? parseInt(scoreMatch[2], 10) : null;

    /* ── 領域2: AWAYチーム名（左側） ── */
    const awayCanvas = cropImage(imgEl, 0.02, 0.20, 0.40, 0.20);
    const awayResult = await worker.recognize(awayCanvas);
    const awayRaw    = awayResult.data.text.trim().replace(/\n/g, ' ');

    /* ── 領域3: HOMEチーム名（右側） ── */
    const homeCanvas = cropImage(imgEl, 0.55, 0.20, 0.43, 0.20);
    const homeResult = await worker.recognize(homeCanvas);
    const homeRaw    = homeResult.data.text.trim().replace(/\n/g, ' ');

    URL.revokeObjectURL(blobUrl);

    /* OCRテキストとキャラクター名を照合（部分一致・類似） */
    const awayChar = matchCharName(awayRaw, playerMap);
    const homeChar = matchCharName(homeRaw, playerMap);

    return {
      awayScore, homeScore,
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
