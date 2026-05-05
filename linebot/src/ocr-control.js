'use strict';

function detectOcrControlIntent(text) {
  const t = normalize(text);
  if (!t) return null;

  const hasOcrWord = /(ocr|自動ocr|画像ocr|スクショocr|スクリーンショットocr|自動集計|画像集計|スクショ集計|スクリーンショット集計)/.test(t);

  if (hasOcrWord && /(off|オフ|停止|止め|止めて|とめて|切って|無効)/.test(t)) {
    return { type: 'ocrControl', action: 'disable' };
  }
  if (hasOcrWord && /(on|オン|開始|再開|戻して|有効)/.test(t)) {
    return { type: 'ocrControl', action: 'enable' };
  }
  if (hasOcrWord && /(状態|状況|ステータス|確認|今どう|いまどう)/.test(t)) {
    return { type: 'ocrControl', action: 'status' };
  }
  if (/^(ocr候補|ocr候補一覧|ocr一覧|候補一覧|スクショ候補|スクショ候補一覧|スクショ一覧|スクリーンショット候補|画像候補|画像一覧|控え一覧|候補見せて|候補みせて|候補見たい|控え見せて|控えみせて)$/.test(t)) {
    return { type: 'ocrControl', action: 'preview' };
  }
  if (/(ocr|スクショ|スクリーンショット|画像|候補|控え).*(候補|一覧|リスト|見せて|みせて|見たい|確認)/.test(t) && /(候補|控え|一覧|リスト)/.test(t)) {
    return { type: 'ocrControl', action: 'preview' };
  }

  if (/^(集計|集計して|今日の集計|今日分集計|まとめて集計|判定集計|スクショ集計|スクリーンショット集計|画像集計|ocrして|ocr集計)$/.test(t)) {
    return { type: 'ocrControl', action: 'batch' };
  }
  if (/(スクショ|スクリーンショット|画像|ocr).*(集計|判定|読んで|読み取|処理|解析)/.test(t)) {
    return { type: 'ocrControl', action: 'batch' };
  }

  return null;
}

function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
}

module.exports = { detectOcrControlIntent };
