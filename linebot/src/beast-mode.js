'use strict';

function detectBeastModeIntent(text) {
  const t = normalize(text);
  if (!t) return null;

  if (/(ビーストモード状態|ビースト状態|ノブレスモード状態|ノブレス状態)/.test(t)) {
    return { type: 'beastMode', action: 'status' };
  }

  if (/(ビーストモード.*(オフ|解除|やめ|終了)|ビースト解除|ノブレスモード.*(オフ|解除)|ノーマルモード|通常モード|秘書モード)/.test(t)) {
    return { type: 'beastMode', action: 'disable' };
  }

  if (/(ビーストモード|ノブレスモード|beastmode|beastmodeon|beastmodeenable)/.test(t)) {
    return { type: 'beastMode', action: 'enable' };
  }

  return null;
}

function formatBeastModeReply(enabled, action) {
  if (action === 'status') {
    return enabled
      ? [
        'ビーストモードは今このグループでONだよ。',
        'ノブレス相談が使える状態になってるの。',
        '例: 「@秘書トラペル子 旅行先を決めたい」「@秘書トラペル子 飲み会の店を決めたい」',
      ].join('\n')
      : [
        'ビーストモードは今OFFだよ。',
        'ノブレス相談を使いたい時は「@秘書トラペル子 ビーストモード」って呼んでね。',
      ].join('\n');
  }

  if (action === 'disable') {
    return [
      'わかった。このグループのビーストモードはOFFにしたよ。',
      'またノブレス相談を使いたくなったら「@秘書トラペル子 ビーストモード」で戻せるからね。',
    ].join('\n');
  }

  return [
    enabled
      ? 'うん、このグループのビーストモードをONにしたよ。'
      : 'ビーストモード、起動したよ。',
    '今からノブレス相談が使えるの。',
    '相談すると、私が案件として整理して案A・案B・案Cを出すね。',
    '承認すると、店・宿・移動の候補や進め方まで持ってくるよ。',
  ].join('\n');
}

function formatBeastModeLockedReply() {
  return [
    'その相談はノブレス側で受けられるよ。',
    '使う時は先に「@秘書トラペル子 ビーストモード」って呼んでね。',
    'ONになると、案件整理と案A・案B・案Cの提案を始めるよ。',
  ].join('\n');
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
