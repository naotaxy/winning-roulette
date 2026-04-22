'use strict';

const BIG = 'big';
const SMALL = 'small';

function detectDiceGameIntent(text) {
  const t = normalizeCommand(text);
  if (!t) return null;

  if (/(大小|だいしょう|大か小|大or小|bigsmall|ハイロー|highlow)/.test(t)) {
    return {
      type: 'diceGame',
      game: 'daisho',
      guess: detectDaishoGuess(t),
    };
  }

  if (/(チンチロ|ちんちろ|チンチロリン|ちんちろりん|サイコロ|さいころ|賽子|dice)/.test(t)) {
    return { type: 'diceGame', game: 'chinchiro' };
  }

  return null;
}

function formatDiceGameReply(intent, senderName, rng = Math.random) {
  if (intent?.game === 'chinchiro') {
    return formatChinchiroReply(senderName, rng);
  }
  if (intent?.game === 'daisho') {
    return formatDaishoReply(intent, senderName, rng);
  }

  return [
    '遊ぶなら「チンチロ」か「大小 大」「大小 小」って呼んでね。',
    'あなたに呼ばれたら、私すぐサイコロ振るから。',
  ].join('\n');
}

function normalizeCommand(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function detectDaishoGuess(text) {
  const body = text.replace(
    /(大小|だいしょう|大か小|大or小|bigsmall|ハイロー|highlow|ゲーム|勝負|サイコロ|さいころ|賽子|振って|やって|お願い|おねがい|予想|回答|guess|answer|bet|:|：|,|，|、|。|!|！|\?|？|に|で|を|は|へ|と)/g,
    ''
  );

  if (/(小さい|しょう|small|low|ロー|小)/.test(body)) return SMALL;
  if (/(大きい|big|high|ハイ|大)/.test(body)) return BIG;
  return null;
}

function formatChinchiroReply(senderName, rng) {
  const caller = formatCaller(senderName);
  const dice = rollDice(3, rng);
  const hand = evaluateChinchiro(dice);

  return [
    `${caller}、チンチロ勝負だね。私がそばで見てるから、ちゃんと強い目出して。`,
    `出目: ${formatDice(dice)}`,
    `役: ${hand.name}`,
    describeChinchiroHand(hand),
    'もう一回なら「@秘書トラペル子 チンチロ」って呼んでね。',
  ].join('\n');
}

function formatDaishoReply(intent, senderName, rng) {
  const caller = formatCaller(senderName);
  if (!intent.guess) {
    return [
      `${caller}、大小だね。`,
      '「大」か「小」を選んでから呼んでね。',
      '例: @秘書トラペル子 大小 大',
      '大は合計11-17、小は合計4-10。ゾロ目は特別目で、大小どちらでもない扱いにするよ。',
    ].join('\n');
  }

  const dice = rollDice(3, rng);
  const result = evaluateDaisho(dice);
  const guessLabel = formatDaishoLabel(intent.guess);
  const resultLabel = formatDaishoResultLabel(result.kind);
  const won = result.kind !== 'triple' && result.kind === intent.guess;

  const lines = [
    `${caller}は「${guessLabel}」を選んだのね。じゃあ、私が振るよ。`,
    `出目: ${formatDice(dice)} 合計${result.total}`,
    `結果: ${resultLabel}`,
  ];

  if (result.kind === 'triple') {
    lines.push('ゾロ目は特別目。今回は大小どちらでもないから親の勝ち扱いだよ。悔しいけど、そんな顔されたら私まで甘やかしたくなる。');
  } else if (won) {
    lines.push('当たり。こういう勝ち方されると、ちょっと惚れ直しちゃう。');
  } else {
    lines.push('はずれ。でも大丈夫、私だけは最後まであなたの味方だから。次、取り返そ。');
  }

  lines.push('もう一回なら「@秘書トラペル子 大小 大」か「@秘書トラペル子 大小 小」って呼んでね。');
  return lines.join('\n');
}

function rollDice(count, rng) {
  return Array.from({ length: count }, () => Math.floor(rng() * 6) + 1);
}

function evaluateChinchiro(dice) {
  const sorted = [...dice].sort((a, b) => a - b);
  const key = sorted.join('');

  if (key === '123') {
    return { kind: 'hifumi', name: 'ヒフミ', rank: -100 };
  }
  if (key === '456') {
    return { kind: 'shigoro', name: 'シゴロ', rank: 600 };
  }
  if (sorted[0] === sorted[1] && sorted[1] === sorted[2]) {
    if (sorted[0] === 1) {
      return { kind: 'pinzoro', name: 'ピンゾロ', rank: 700 };
    }
    return { kind: 'triple', name: `${sorted[0]}ゾロ`, rank: 500 + sorted[0] };
  }

  const counts = sorted.reduce((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
  const pair = Object.entries(counts).find(([, count]) => count === 2);
  if (pair) {
    const point = Number(Object.entries(counts).find(([, count]) => count === 1)[0]);
    return { kind: 'point', name: `${point}の目`, point, rank: 100 + point };
  }

  return { kind: 'nopoint', name: '目なし', rank: 0 };
}

function evaluateDaisho(dice) {
  const total = dice.reduce((sum, value) => sum + value, 0);
  if (dice.every(value => value === dice[0])) {
    return { kind: 'triple', total };
  }
  return {
    kind: total >= 11 ? BIG : SMALL,
    total,
  };
}

function describeChinchiroHand(hand) {
  if (hand.kind === 'pinzoro') {
    return 'ピンゾロ。これは強すぎるよ。そんな目を出されたら、私まで誇らしくなっちゃう。';
  }
  if (hand.kind === 'shigoro') {
    return 'シゴロ、かなりきれい。今日は運まであなたの味方してる。';
  }
  if (hand.kind === 'triple') {
    return 'ゾロ目、ちゃんと強いよ。こういう時だけ妙に格好いいの、ずるい。';
  }
  if (hand.kind === 'point') {
    return `${hand.point}の目。勝負になる目だよ。ここから押し切ろう。`;
  }
  if (hand.kind === 'hifumi') {
    return 'ヒフミ。これは痛いけど、私だけは味方だからね。';
  }
  return '目なし。まだ終わってない顔して。もう一回呼んでくれたら、私すぐ振るから。';
}

function formatDice(dice) {
  return dice.map(value => `[${value}]`).join(' ');
}

function formatDaishoLabel(kind) {
  return kind === BIG ? '大' : '小';
}

function formatDaishoResultLabel(kind) {
  if (kind === 'triple') return 'ゾロ目';
  return formatDaishoLabel(kind);
}

function formatCaller(senderName) {
  const name = String(senderName || '').trim();
  if (!name || name === '(LINE bot)' || name === '不明') return 'あなた';
  return `${name}さん`;
}

module.exports = {
  detectDiceGameIntent,
  formatDiceGameReply,
  evaluateChinchiro,
  evaluateDaisho,
};
