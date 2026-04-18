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

  /* ── スコア・PK用前処理: 白数字×暗背景 → 黒数字×白背景 ── */
  function preprocessForScorePK(canvas) {
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

  /* ── チーム名用前処理: 白文字→黒文字の閾値反転
     白文字(lum>128)→黒、暗背景→白。Tesseract は黒文字×白背景が最適 ── */
  function preprocessForTeamName(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const val = lum > 128 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = val;
      d[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  /* ── テキスト正規化（全角半角統一・空白除去・記号吸収） ── */
  function normalizeText(str) {
    if (!str) return '';
    return str
      .normalize('NFKC')             // 全角英数→半角、合成文字統一
      .replace(/[？]/g, '?')         // 全角?→半角?
      .replace(/[・．。、\-_]/g, '')  // 句読点・区切り除去
      .replace(/\s+/g, '')           // 空白除去
      .toLowerCase();
  }

  /* ── チーム名マッチング（辞書照合・閾値0.78未満はnull）
     低品質OCRを無理にどこかへ割り当てないのが原則 ── */
  function matchTeamName(ocrText, playerMap) {
    if (!ocrText || !playerMap) return null;
    const normalized = normalizeText(ocrText);
    if (normalized.length < 2) return null;

    let best = null, bestScore = 0;

    for (const [charName, playerName] of Object.entries(playerMap)) {
      const charNorm = normalizeText(charName);
      if (!charNorm) continue;
      let score = 0;

      /* ① 完全包含一致（サブストリングが3文字以上の場合のみ有効） */
      const minLen = Math.min(normalized.length, charNorm.length);
      if (minLen >= 3) {
        if (normalized.includes(charNorm) || charNorm.includes(normalized)) {
          score = 0.90;
        }
      }

      /* ② トークン単位マッチ（チーム名をスペースで分割して部分一致） */
      if (score === 0) {
        const tokens = charNorm.split(/\s+/).filter(t => t.length >= 3);
        const matchedTokens = tokens.filter(t => normalized.includes(t));
        if (matchedTokens.length > 0) {
          score = 0.70 + 0.20 * (matchedTokens.length / Math.max(tokens.length, 1));
        }
      }

      /* ③ bigram Jaccard（フォールバック） */
      if (score === 0) {
        const ngA = ngrams(normalized, 2);
        const ngB = ngrams(charNorm, 2);
        if (ngA.size > 0 && ngB.size > 0) {
          let intersection = 0;
          for (const g of ngA) if (ngB.has(g)) intersection++;
          const union = ngA.size + ngB.size - intersection;
          score = union > 0 ? intersection / union : 0;
        }
      }

      /* 閾値 0.65 未満は採用しない */
      if (score > bestScore && score >= 0.65) {
        bestScore = score;
        best = { charName, playerName, score };
      }
    }

    return best;
  }

  function ngrams(str, n) {
    const s = new Set();
    for (let i = 0; i <= str.length - n; i++) s.add(str.slice(i, i + n));
    return s;
  }

  /* ── スコアとチーム名を解析 ── */
  async function parseMatchResult(imgFile, playerMap, onProgress) {
    const blobUrl = URL.createObjectURL(imgFile);
    const imgEl   = await loadImage(blobUrl);
    const worker  = await ensureWorker(onProgress);

    /* ── 領域1: メインスコア（中央・前処理あり）
       y=19〜55% をスキャン（HP/スタミナバー y<14% を除外） ── */
    const scoreCanvas = cropImage(imgEl, 0.20, 0.19, 0.60, 0.36, 3);
    preprocessForScorePK(scoreCanvas);
    const scoreResult = await worker.recognize(scoreCanvas);
    const scoreText   = scoreResult.data.text;
    const scoreMatch  = scoreText.match(/(\d+)\s*[-－]\s*(\d+)/);
    const leftScore   = scoreMatch ? parseInt(scoreMatch[1], 10) : null;
    const rightScore  = scoreMatch ? parseInt(scoreMatch[2], 10) : null;

    /* ── 領域2: PKスコア（中央帯・前処理あり）
       x=24〜76% に限定してロゴ領域を除外。
       点差がある場合は「PK不可」として強制nullに。 ── */
    const pkCanvas = cropImage(imgEl, 0.24, 0.34, 0.52, 0.22, 3);
    preprocessForScorePK(pkCanvas);
    const pkResult = await worker.recognize(pkCanvas);
    const pkText   = pkResult.data.text;
    const pkMatch  = pkText.match(/(\d+)\s*PK\s*(\d+)/i);
    let leftPK  = pkMatch ? parseInt(pkMatch[1], 10) : null;
    let rightPK = pkMatch ? parseInt(pkMatch[2], 10) : null;

    if (leftScore !== null && rightScore !== null && leftScore !== rightScore) {
      leftPK = null;
      rightPK = null;
    }

    /* ── 領域3: 左バッジ（HOME / AWAY 判定） ── */
    const leftBadgeCanvas = cropImage(imgEl, 0.02, 0.12, 0.42, 0.32, 2);
    const leftBadgeResult = await worker.recognize(leftBadgeCanvas);
    const leftBadgeText   = leftBadgeResult.data.text.toUpperCase().replace(/\s/g, '');
    const leftIsHome      = leftBadgeText.includes('HOME');

    /* ── 領域4: 左チーム名（検証済み座標・前処理あり・scale=4）
       座標検証結果 (複数解像度で一致):
         706×1536: (105,561)-(290,610) → x=14.9〜41.1%, y=36.5〜39.7%
         720×1496: (107,546)-(296,594) → x=14.9〜41.1%, y=36.5〜39.7%
         870×1882: (130,687)-(358,747) → x=14.9〜41.1%, y=36.5〜39.7%
       安全マージン付き: x=12%, y=35.5%, w=32%, h=5.5% ── */
    /* PSM 7 = 単一テキスト行モード（チーム名帯は1行なので精度向上） */
    await worker.setParameters({ tessedit_pageseg_mode: '7' });

    const leftNameCanvas = cropImage(imgEl, 0.12, 0.355, 0.32, 0.055, 4);
    preprocessForTeamName(leftNameCanvas);
    const leftNameResult = await worker.recognize(leftNameCanvas);
    const leftTeamRaw    = leftNameResult.data.text.trim().replace(/\n/g, ' ');

    /* ── 領域5: 右チーム名（検証済み座標）
         右チーム: x=60.2〜91.4%, y=36.5〜39.7%
       安全マージン付き: x=58%, y=35.5%, w=32%, h=5.5% ── */
    const rightNameCanvas = cropImage(imgEl, 0.58, 0.355, 0.32, 0.055, 4);
    preprocessForTeamName(rightNameCanvas);
    const rightNameResult = await worker.recognize(rightNameCanvas);
    const rightTeamRaw    = rightNameResult.data.text.trim().replace(/\n/g, ' ');

    /* PSM をデフォルト（自動）に戻す */
    await worker.setParameters({ tessedit_pageseg_mode: '3' });

    URL.revokeObjectURL(blobUrl);

    /* ── デバッグログ ── */
    const leftTeamNorm  = normalizeText(leftTeamRaw);
    const rightTeamNorm = normalizeText(rightTeamRaw);
    let leftTeamMatch  = matchTeamName(leftTeamRaw, playerMap);
    let rightTeamMatch = matchTeamName(rightTeamRaw, playerMap);

    console.log('[OCR]', {
      leftScore, rightScore, leftPK, rightPK,
      leftBadgeText, leftIsHome,
      leftTeamRaw, rightTeamRaw,
      leftTeamNorm, rightTeamNorm,
      leftTeamMatch, rightTeamMatch,
    });

    /* ── 同一プレイヤー重複チェック
       左右が同じプレイヤーになった場合は両方 null として再判定させる
       （高い方だけ残すと誤爆を温存するため） ── */
    if (leftTeamMatch && rightTeamMatch &&
        leftTeamMatch.playerName === rightTeamMatch.playerName) {
      console.warn('[OCR] 左右が同一プレイヤー → 両方 null にリセット',
        leftTeamMatch.playerName);
      leftTeamMatch  = null;
      rightTeamMatch = null;
    }

    /* ── HOME/AWAY を左右から正しく割り当て ── */
    const homeScore = leftIsHome ? leftScore  : rightScore;
    const awayScore = leftIsHome ? rightScore : leftScore;
    const homePK    = leftIsHome ? leftPK     : rightPK;
    const awayPK    = leftIsHome ? rightPK    : leftPK;
    const homeChar  = leftIsHome ? leftTeamMatch  : rightTeamMatch;
    const awayChar  = leftIsHome ? rightTeamMatch : leftTeamMatch;
    const homeRaw   = leftIsHome ? leftTeamRaw    : rightTeamRaw;
    const awayRaw   = leftIsHome ? rightTeamRaw   : leftTeamRaw;

    return {
      awayScore, homeScore,
      awayPK, homePK,
      awayChar, homeChar,
      awayRaw, homeRaw,
      scoreRaw: scoreText.trim(),
    };
  }

  /* matchCharName は後方互換性のために残す（外部から呼ばれる場合） */
  function matchCharName(ocrText, playerMap) {
    return matchTeamName(ocrText, playerMap);
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
