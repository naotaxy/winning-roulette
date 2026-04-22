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
