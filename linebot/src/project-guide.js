'use strict';

const QIITA_URL = 'https://qiita.com/meisaitokei/items/5857bbb2b5a96b52341c';

function detectProjectGuideIntent(text) {
  const t = normalize(text);
  if (!t) return false;

  if (/(仕組み|構成|どう作った|作り方|実装記事|qiita|記事|解説|システムの中身|裏側)/.test(t)) {
    return true;
  }

  return false;
}

function formatProjectGuideReply() {
  return [
    'このシステムの仕組みは、Qiitaにまとめてあるよ。',
    QIITA_URL,
    '',
    'LINE Bot、LIFF、Firebase、OCR、自動OCR OFF時の後追い集計まで書いてあるの。',
    '作り方や構成を見たい時は、ここを読んでくれたらうれしいな。',
  ].join('\n');
}

function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
}

module.exports = {
  QIITA_URL,
  detectProjectGuideIntent,
  formatProjectGuideReply,
};
