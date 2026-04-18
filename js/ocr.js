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

  /* ── 前処理: 白文字×暗背景 → 黒文字×白背景（スコア数字の誤認識防止）
     ウイコレのスコア・PKスコアは白文字なので反転することで
     Tesseract の数字認識精度が大幅に向上する ── */
  function preprocessForOCR(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const val = lum > 150 ? 0 : 255;
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

    /* ── 領域1: メインスコア（中央広域・前処理あり）
       ステータスバー有無で y位置が異なるため y=19〜55% を広くスキャン。
       HP/スタミナバー（y≈0〜14%）は除外。 ── */
    const scoreCanvas = cropImage(imgEl, 0.20, 0.19, 0.60, 0.36, 3);
    preprocessForOCR(scoreCanvas);
    const scoreResult = await worker.recognize(scoreCanvas);
    const scoreText   = scoreResult.data.text;
    const scoreMatch  = scoreText.match(/(\d+)\s*[-－]\s*(\d+)/);
    const leftScore   = scoreMatch ? parseInt(scoreMatch[1], 10) : null;
    const rightScore  = scoreMatch ? parseInt(scoreMatch[2], 10) : null;

    /* ── 領域2: PKスコア（前処理あり）
       スコア直下の中央帯のみをスキャン（x=24〜76%）。
       左右のチームロゴ（x<24%, x>76%）を除外することで
       ロゴ内の「パ→P」「キ→K」誤読による偽PK検出を防ぐ。

       ★ 点差がある場合は「PK不可」として結果を無効化（最終検証）── */
    const pkCanvas = cropImage(imgEl, 0.24, 0.34, 0.52, 0.22, 3);
    preprocessForOCR(pkCanvas);
    const pkResult = await worker.recognize(pkCanvas);
    const pkText   = pkResult.data.text;
    const pkMatch  = pkText.match(/(\d+)\s*PK\s*(\d+)/i);
    let leftPK  = pkMatch ? parseInt(pkMatch[1], 10) : null;
    let rightPK = pkMatch ? parseInt(pkMatch[2], 10) : null;

    /* 点差があればPKはあり得ない */
    if (leftScore !== null && rightScore !== null && leftScore !== rightScore) {
      leftPK = null;
      rightPK = null;
    }

    /* ── 領域3: 左バッジ（HOME / AWAY 判定） ── */
    const leftBadgeCanvas = cropImage(imgEl, 0.02, 0.12, 0.42, 0.32, 2);
    const leftBadgeResult = await worker.recognize(leftBadgeCanvas);
    const leftBadgeText   = leftBadgeResult.data.text.toUpperCase().replace(/\s/g, '');
    const leftIsHome      = leftBadgeText.includes('HOME');

    /* ── 領域4・5: チーム名（2パス方式）
       【根本問題】単一の広域スキャンではチームロゴ画像と
       スコア数字が混入し、OCR出力が汚染される。

       【対策】チーム名テキスト行のみを2ヶ所ピンポイントでスキャン:
         パスA: y=44〜54%  → JPGレイアウト（ステータスバーなし）のチーム名位置
         パスB: y=57〜67%  → PNGレイアウト（ステータスバーあり）のチーム名位置
       両パスのテキストを結合してファジーマッチング。
       x境界を左=1〜48%、右=52〜99% に分けて中央ギャップを確保。 ── */

    /* 左チーム名 */
    const leftA = cropImage(imgEl, 0.01, 0.44, 0.47, 0.11, 3);
    const leftB = cropImage(imgEl, 0.01, 0.57, 0.47, 0.11, 3);
    const [resLA, resLB] = [
      await worker.recognize(leftA),
      await worker.recognize(leftB),
    ];
    const leftRaw = (resLA.data.text + ' ' + resLB.data.text).trim().replace(/\n/g, ' ');

    /* 右チーム名 */
    const rightA = cropImage(imgEl, 0.52, 0.44, 0.47, 0.11, 3);
    const rightB = cropImage(imgEl, 0.52, 0.57, 0.47, 0.11, 3);
    const [resRA, resRB] = [
      await worker.recognize(rightA),
      await worker.recognize(rightB),
    ];
    const rightRaw = (resRA.data.text + ' ' + resRB.data.text).trim().replace(/\n/g, ' ');

    URL.revokeObjectURL(blobUrl);

    /* ── マッチング & 重複防止
       同一プレイヤーが左右両方にマッチした場合、
       スコアの低い方を null にする（同一プレイヤー同士はあり得ない） ── */
    let leftChar  = matchCharName(leftRaw, playerMap);
    let rightChar = matchCharName(rightRaw, playerMap);

    if (leftChar && rightChar && leftChar.playerName === rightChar.playerName) {
      if ((leftChar.score || 0) >= (rightChar.score || 0)) {
        rightChar = null;
      } else {
        leftChar = null;
      }
    }

    /* ── HOME/AWAY を左右から正しく割り当て ── */
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
    if (normalized.length < 2) return null;  /* 短すぎるOCR出力は無視 */

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

    /* 単語単位での部分一致チェック（複合チーム名対応） */
    const wordsB = b.split(/\s+/);
    for (const w of wordsB) {
      if (w.length >= 3 && a.includes(w)) return 0.75;
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
