'use strict';

function detectBeastModeIntent(text) {
  const t = normalize(text);
  if (!t) return null;

  if (matchesAny(t, [
    'モード状態',
    'ノブレス状態',
    'ノブレスモード状態',
    'マネージャー状態',
    'ビースト状態',
    'ビーストモード状態',
  ])) {
    return { type: 'beastMode', action: 'status' };
  }

  if (matchesAny(t, [
    'マネージャーモード',
    '秘書モード',
    '通常モード',
    'ノーマルモード',
    'ノブレス解除',
    'ノブレス終了',
    'ノブレスモードoff',
    'ノブレスモードオフ',
    'ビースト解除',
    'ビーストモードoff',
    'beastmodeoff',
    'noblessemodeoff',
    'managermode',
  ])) {
    return { type: 'beastMode', action: 'disable' };
  }

  if (matchesAny(t, [
    'ノブレスモード',
    'ノブレス開始',
    'ノブレスでお願い',
    'ビーストモード',
    'beastmode',
    'beastmodeon',
    'beastmodeenable',
    'noblessemode',
    'noblessemodeon',
  ])) {
    return { type: 'beastMode', action: 'enable' };
  }

  return null;
}

function formatBeastModeReply(enabled, action) {
  if (action === 'status') {
    return enabled
      ? [
        '今はノブレスモードだよ。',
        '相談を案件として受けて、案A・案B・案C、候補探し、予約前の段取りまで進められるの。',
        '通常の秘書モードに戻したい時は「@秘書トラペル子 マネージャーモード」って呼んでね。',
      ].join('\n')
      : [
        '今はマネージャーモードだよ。',
        '順位、OCR、雑談、進行整理みたいな通常の秘書仕事で動いてるの。',
        '案件相談を始めたい時は「@秘書トラペル子 ノブレスモード」って呼んでね。',
      ].join('\n');
  }

  if (action === 'disable') {
    return [
      'わかった。このトークはマネージャーモードに戻したよ。',
      'また案件相談をしたくなったら「@秘書トラペル子 ノブレスモード」で切り替えられるからね。',
    ].join('\n');
  }

  return [
    enabled
      ? 'うん、このトークをノブレスモードに切り替えたよ。'
      : 'ノブレスモード、起動したよ。',
    '今から案件相談を受けて、案A・案B・案C、条件ヒアリング、候補探しまでまとめて進めるね。',
    '状態を見たい時は「@秘書トラペル子 モード状態」、通常の秘書仕事に戻す時は「@秘書トラペル子 マネージャーモード」で大丈夫。',
  ].join('\n');
}

function formatBeastModeLockedReply() {
  return [
    'その相談はノブレス側で受けられるよ。',
    '使う時は先に「@秘書トラペル子 ノブレスモード」って呼んでね。',
    '通常の秘書仕事に戻したい時は「@秘書トラペル子 マネージャーモード」、確認は「@秘書トラペル子 モード状態」だよ。',
  ].join('\n');
}

function matchesAny(text, patterns) {
  return patterns.some(pattern => text === pattern);
}

function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
}

module.exports = {
  detectBeastModeIntent,
  formatBeastModeReply,
  formatBeastModeLockedReply,
};
