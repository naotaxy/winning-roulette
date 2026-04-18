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

  /* ── 反転前処理（BgDiff失敗時のフォールバック） ── */
  function preprocessInvert(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = lum > 150 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  /* ── スコア/PK用前処理: 背景差分 + モルフォロジークロージング ──
     背景(ぼかし)との輝度差で白数字を検出 → 黒数字×白背景に変換
     閾値固定反転より「1→7」誤読を大幅に改善 ── */
  function preprocessBgDiff(canvas, blurRadius, diffThreshold) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const imageData = ctx.getImageData(0, 0, W, H);
    const d = imageData.data;

    // グレースケール化
    const gray = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const pi = i * 4;
      gray[i] = 0.299 * d[pi] + 0.587 * d[pi + 1] + 0.114 * d[pi + 2];
    }

    // 積分画像（SAT）で O(1)/pixel の高速ボックスブラー
    const W1 = W + 1;
    const sat = new Float64Array(W1 * (H + 1));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        sat[(y + 1) * W1 + (x + 1)] = gray[y * W + x]
          + sat[y * W1 + (x + 1)]
          + sat[(y + 1) * W1 + x]
          - sat[y * W1 + x];
      }
    }
    const r = blurRadius;
    const blurred = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const x1 = Math.max(0, x - r), y1 = Math.max(0, y - r);
        const x2 = Math.min(W - 1, x + r), y2 = Math.min(H - 1, y + r);
        const cnt = (x2 - x1 + 1) * (y2 - y1 + 1);
        blurred[y * W + x] = (
          sat[(y2 + 1) * W1 + (x2 + 1)]
          - sat[y1 * W1 + (x2 + 1)]
          - sat[(y2 + 1) * W1 + x1]
          + sat[y1 * W1 + x1]
        ) / cnt;
      }
    }

    // 差分 → 閾値 → 2値（白文字=0黒、背景=255白）
    const binary = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      binary[i] = (gray[i] - blurred[i]) > diffThreshold ? 0 : 255;
    }

    // モルフォロジークロージング: MinFilter(5x5) → MaxFilter(5x5)
    // → 黒文字の小さな穴を埋め、数字輪郭を安定化
    const kr = 2; // 5×5 カーネル半径
    const tmp = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let v = 255;
        for (let dy = -kr; dy <= kr; dy++) {
          for (let dx = -kr; dx <= kr; dx++) {
            const ny = y + dy, nx = x + dx;
            if (ny >= 0 && ny < H && nx >= 0 && nx < W) {
              const val = binary[ny * W + nx];
              if (val < v) v = val;
            }
          }
        }
        tmp[y * W + x] = v;
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let v = 0;
        for (let dy = -kr; dy <= kr; dy++) {
          for (let dx = -kr; dx <= kr; dx++) {
            const ny = y + dy, nx = x + dx;
            if (ny >= 0 && ny < H && nx >= 0 && nx < W) {
              const val = tmp[ny * W + nx];
              if (val > v) v = val;
            }
          }
        }
        const pi = (y * W + x) * 4;
        d[pi] = d[pi + 1] = d[pi + 2] = v;
        d[pi + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  /* ── 左バッジの色でHOME/AWAY判定（緑=HOME, 赤オレンジ=AWAY） ── */
  function detectLeftBadgeHome(canvas) {
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let green = 0, red = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max - min < 50 || max < 80) continue;
      if (g > r * 1.2 && g > b * 1.5) green++;
      else if (r > g * 1.3 && r > b) red++;
    }
    return { leftIsHome: green > red, badgeDebug: `g=${green} r=${red}` };
  }

  /* ── テキスト正規化（全角半角統一・空白除去・記号吸収） ── */
  function normalizeText(str) {
    if (!str) return '';
    return str
      .normalize('NFKC')
      .replace(/[ァィゥェォ]/g, c => String.fromCharCode(c.charCodeAt(0) + 1))  // 小カナ→大カナ
      .replace(/[ッャュョ]/g, c => String.fromCharCode(c.charCodeAt(0) + 1))    // 小カナ→大カナ
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

  /* ── スコア抽出（・区切り対応・ノイズ過大値切り詰め付き） ──
     "1・ 1" → 1-1、"5 - 28" → 5-2（28→ノイズ→2桁目切り捨て） ── */
  function extractScore(text) {
    for (const line of text.split('\n')) {
      const m = line.match(/(\d{1,2})\s*[-－—–−―・]\s*(\d{1,2})/)
             || line.match(/\b(\d)\s{1,4}(\d)\b/);
      if (!m) continue;
      let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > 15 && a <= 99) a = Math.floor(a / 10);
      if (b > 15 && b <= 99) b = Math.floor(b / 10);
      if (a <= 15 && b <= 15) return [a, b];
    }
    return null;
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

      /* ④ bigram Jaccard（フォールバック：他の手法が閾値未満のときも発火） */
      if (score < THRESHOLD && minLen >= 3) {
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

    /* ── 領域1: スコア（y=23〜34%・x=30〜70%でロゴノイズ排除） ── */
    await worker.setParameters({ tessedit_pageseg_mode: '11' });
    const scoreCanvas = cropImage(imgEl, 0.30, 0.23, 0.40, 0.11, 3);
    preprocessBgDiff(scoreCanvas, 40, 40);
    const scoreResult = await worker.recognize(scoreCanvas);
    const scoreText   = scoreResult.data.text;
    let scoreArr = extractScore(scoreText);

    /* BgDiff で検出できない画像はシンプル反転でフォールバック */
    if (!scoreArr) {
      const scoreCanvas2 = cropImage(imgEl, 0.30, 0.23, 0.40, 0.11, 3);
      preprocessInvert(scoreCanvas2);
      const scoreResult2 = await worker.recognize(scoreCanvas2);
      scoreArr = extractScore(scoreResult2.data.text);
    }
    const leftScore  = scoreArr ? scoreArr[0] : null;
    const rightScore = scoreArr ? scoreArr[1] : null;

    /* ── 領域2: PKスコア（y=24〜35%）
       PK表示位置が画像によって異なるため上部クロップ優先
       1桁 regex でノイズ "14 PK 2" 等を防ぐ ── */
    const _findPK = text => {
      const m = text.match(/(\d)\s*PK\s*(\d)/i);
      return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : null;
    };
    const pkCanvas = cropImage(imgEl, 0.24, 0.24, 0.52, 0.11, 3);
    preprocessBgDiff(pkCanvas, 40, 40);
    const pkResultBg = await worker.recognize(pkCanvas);
    const pkText = pkResultBg.data.text;
    let pkArr = _findPK(pkText);
    if (!pkArr) {
      const pkCanvas2 = cropImage(imgEl, 0.24, 0.24, 0.52, 0.11, 3);
      preprocessInvert(pkCanvas2);
      const pkResultInv = await worker.recognize(pkCanvas2);
      pkArr = _findPK(pkResultInv.data.text);
    }
    let leftPK  = pkArr ? pkArr[0] : null;
    let rightPK = pkArr ? pkArr[1] : null;
    if (leftScore !== null && rightScore !== null && leftScore !== rightScore) {
      leftPK = null; rightPK = null;
    }

    /* ── 領域3: 左バッジ（HOME=緑 / AWAY=赤橙 を色判定・OCR不使用） ── */
    const leftBadgeCanvas = cropImage(imgEl, 0.02, 0.19, 0.44, 0.05, 1);
    const { leftIsHome, badgeDebug } = detectLeftBadgeHome(leftBadgeCanvas);
    const leftBadgeText = badgeDebug;

    /* ── 領域4/5: チーム名（前処理なし・PSM 11・y=34〜44%） ── */
    await worker.setParameters({ tessedit_pageseg_mode: '11' });

    const leftNameCanvas = cropImage(imgEl, 0.02, 0.34, 0.44, 0.10, 2);
    const leftNameResult = await worker.recognize(leftNameCanvas);
    const leftTeamRaw    = leftNameResult.data.text.trim().replace(/\n/g, ' ');

    const rightNameCanvas = cropImage(imgEl, 0.54, 0.34, 0.43, 0.10, 2);
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
      _debug: {
        pkRaw:        pkText.trim(),
        badgeRaw:     leftBadgeText,
        leftIsHome,
        leftTeamRaw,
        rightTeamRaw,
        leftMatch:    leftTeamMatch,
        rightMatch:   rightTeamMatch,
      },
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
