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

  /* ── チーム名用前処理: JPEG圧縮後の白文字(lum≈180-195)も拾うため閾値175 ── */
  function preprocessForTeamName(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const val = lum > 175 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = val;
      d[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  /* ── テキスト正規化（全角半角統一・空白除去・記号吸収） ── */
  function normalizeText(str) {
    if (!str) return '';
    return str
      .normalize('NFKC')
      .replace(/[？?]/g, '')          // ? を両側で除去（LOVE BEER? 対応）
      .replace(/[・．。、\-_]/g, '')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  /* ── Levenshtein 編集距離 ── */
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = [];
    for (let i = 0; i <= m; i++) {
      dp[i] = [i];
      for (let j = 1; j <= n; j++) {
        dp[i][j] = i === 0 ? j
          : a[i-1] === b[j-1]
            ? dp[i-1][j-1]
            : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      }
    }
    return dp[m][n];
  }

  /* ── スライディングウィンドウ部分一致（prefix/suffix 欠落に対応） ── */
  function partialRatio(shorter, longer) {
    if (shorter.length > longer.length) return partialRatio(longer, shorter);
    if (shorter.length === 0) return 0;
    let best = 0;
    for (let i = 0; i <= longer.length - shorter.length; i++) {
      const window = longer.slice(i, i + shorter.length);
      const dist = levenshtein(shorter, window);
      const sim = 1 - dist / shorter.length;
      if (sim > best) best = sim;
    }
    return best;
  }

  function ngrams(str, n) {
    const s = new Set();
    for (let i = 0; i <= str.length - n; i++) s.add(str.slice(i, i + n));
    return s;
  }

  /* ── チーム名マッチング
     ①完全包含 → ②スライディング部分一致 → ③Levenshtein → ④bigram Jaccard
     閾値0.45（OCRノイズが大きいため低め設定） ── */
  function matchTeamName(ocrText, playerMap) {
    if (!ocrText || !playerMap) return null;
    const normalized = normalizeText(ocrText);
    if (normalized.length < 2) return null;

    const THRESHOLD = 0.45;
    let best = null, bestScore = 0;

    for (const [charName, playerName] of Object.entries(playerMap)) {
      const charNorm = normalizeText(charName);
      if (!charNorm) continue;
      const minLen = Math.min(normalized.length, charNorm.length);
      const maxLen = Math.max(normalized.length, charNorm.length);
      let score = 0;

      /* ① 完全包含一致 */
      if (minLen >= 2 && (normalized.includes(charNorm) || charNorm.includes(normalized))) {
        score = 0.95;
      }

      /* ② スライディングウィンドウ部分一致（先頭・末尾欠落をカバー） */
      if (score < 0.70 && minLen >= 2) {
        const pr = partialRatio(charNorm, normalized);
        if (pr * 0.90 > score) score = pr * 0.90;
      }

      /* ③ Levenshtein（1文字違い: ソ→ン, D→0 等をカバー） */
      if (score < 0.70 && minLen >= 2) {
        const dist = levenshtein(normalized, charNorm);
        const maxAllowed = Math.max(1, Math.floor(maxLen * 0.35));
        if (dist <= maxAllowed) {
          const sim = 1 - dist / maxLen;
          if (sim > score) score = sim;
        }
      }

      /* ④ bigram Jaccard（フォールバック） */
      if (score === 0 && minLen >= 3) {
        const ngA = ngrams(normalized, 2);
        const ngB = ngrams(charNorm, 2);
        if (ngA.size > 0 && ngB.size > 0) {
          let intersection = 0;
          for (const g of ngA) if (ngB.has(g)) intersection++;
          const union = ngA.size + ngB.size - intersection;
          score = union > 0 ? intersection / union : 0;
        }
      }

      if (score > bestScore && score >= THRESHOLD) {
        bestScore = score;
        best = { charName, playerName, score: Math.round(score * 100) / 100 };
      }
    }
    return best;
  }

  /* ── スコアとチーム名を解析 ── */
  async function parseMatchResult(imgFile, playerMap, onProgress) {
    const blobUrl = URL.createObjectURL(imgFile);
    const imgEl   = await loadImage(blobUrl);
    const worker  = await ensureWorker(onProgress);

    /* ── 領域1: スコア（y=14〜24%・ゴールタイムスタンプを除外） ── */
    const scoreCanvas = cropImage(imgEl, 0.20, 0.14, 0.60, 0.10, 3);
    preprocessForScorePK(scoreCanvas);
    const scoreResult = await worker.recognize(scoreCanvas);
    const scoreText   = scoreResult.data.text;
    const scoreMatch  = scoreText.match(/\b(\d{1,2})\b\s*[-－—–−]\s*\b(\d{1,2})\b/);
    const leftScore   = scoreMatch ? parseInt(scoreMatch[1], 10) : null;
    const rightScore  = scoreMatch ? parseInt(scoreMatch[2], 10) : null;

    /* ── 領域2: PKスコア（y=22〜33%） ── */
    const pkCanvas = cropImage(imgEl, 0.24, 0.22, 0.52, 0.11, 3);
    preprocessForScorePK(pkCanvas);
    const pkResult = await worker.recognize(pkCanvas);
    const pkText   = pkResult.data.text;
    const pkMatch  = pkText.match(/(\d+)\s*PK\s*(\d+)/i);
    let leftPK  = pkMatch ? parseInt(pkMatch[1], 10) : null;
    let rightPK = pkMatch ? parseInt(pkMatch[2], 10) : null;
    if (leftScore !== null && rightScore !== null && leftScore !== rightScore) {
      leftPK = null; rightPK = null;
    }

    /* ── 領域3: 左バッジ（HOME / AWAY 判定・5〜17%） ── */
    const leftBadgeCanvas = cropImage(imgEl, 0.02, 0.05, 0.44, 0.12, 2);
    const leftBadgeResult = await worker.recognize(leftBadgeCanvas);
    const leftBadgeText   = leftBadgeResult.data.text.toUpperCase().replace(/\s/g, '');
    const leftIsHome      = leftBadgeText.includes('HOME');

    /* ── 領域4/5: チーム名（前処理なし・PSM 11・y=24〜34%） ── */
    await worker.setParameters({ tessedit_pageseg_mode: '11' });

    const leftNameCanvas = cropImage(imgEl, 0.03, 0.24, 0.43, 0.10, 2);
    const leftNameResult = await worker.recognize(leftNameCanvas);
    const leftTeamRaw    = leftNameResult.data.text.trim().replace(/\n/g, ' ');

    const rightNameCanvas = cropImage(imgEl, 0.55, 0.24, 0.41, 0.10, 2);
    const rightNameResult = await worker.recognize(rightNameCanvas);
    const rightTeamRaw    = rightNameResult.data.text.trim().replace(/\n/g, ' ');

    await worker.setParameters({ tessedit_pageseg_mode: '3' });

    URL.revokeObjectURL(blobUrl);

    let leftTeamMatch  = matchTeamName(leftTeamRaw, playerMap);
    let rightTeamMatch = matchTeamName(rightTeamRaw, playerMap);

    /* 同一プレイヤー重複 → 両方 null */
    if (leftTeamMatch && rightTeamMatch &&
        leftTeamMatch.playerName === rightTeamMatch.playerName) {
      leftTeamMatch = null; rightTeamMatch = null;
    }

    const _log = {
      ts: new Date().toISOString(),
      scoreRaw: scoreText.trim(), leftScore, rightScore,
      pkRaw: pkText.trim(), leftPK, rightPK,
      leftBadgeText, leftIsHome,
      leftTeamRaw, rightTeamRaw,
      leftMatch: leftTeamMatch, rightMatch: rightTeamMatch,
    };
    console.log('[OCR]', _log);

    /* HOME/AWAY を左右から割り当て */
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
