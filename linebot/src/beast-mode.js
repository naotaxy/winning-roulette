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
        '── ノブレスモード 稼働中 ──',
        '',
        'あなたの相談はすべて案件として受理するよ。',
        '案A・案B・案C の提案、ヒアリング、候補探し、予約前の段取りまで、わたしが引き取るの。',
        '',
        '「マネージャーモード」で通常秘書へ切り替えできる。',
      ].join('\n')
      : [
        '── マネージャーモード 稼働中 ──',
        '',
        '順位確認、OCR、雑談、進行整理、リマインドなど通常の秘書仕事で動いてるよ。',
        '',
        '案件相談を始めたい時は「ノブレスモード」って呼んでね。',
      ].join('\n');
  }

  if (action === 'disable') {
    return [
      'ノブレスモード、解除したよ。',
      'また案件相談が必要になったら「ノブレスモード」で。いつでも切り替えられるから。',
    ].join('\n');
  }

  // enable
  return [
    '── ノブレスモード 起動 ──',
    '',
    'ご依頼を案件として受理します。',
    '案A・案B・案C の提案、条件ヒアリング、候補探し、しおり作成、予約前の段取りまで——わたしが全部引き取るよ。',
    '',
    '「モード状態」で確認、「マネージャーモード」で通常秘書へ。',
  ].join('\n');
}

function formatBeastModeLockedReply() {
  return [
    'その相談、ノブレスモードで受けられるよ。',
    '「ノブレスモード」と呼んでくれたら、案件として整理して引き取るね。',
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
