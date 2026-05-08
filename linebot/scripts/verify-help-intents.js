'use strict';

// webhook.js pulls OCR dependencies at module load time. The intent detector does
// not use canvas, so this keeps the check runnable on local machines where the
// native canvas build is missing.
const Module = require('module');
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'canvas') {
    return {
      createCanvas: () => ({
        getContext: () => ({}),
        toBuffer: () => Buffer.alloc(0),
      }),
      loadImage: async () => ({}),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { _test } = require('../src/webhook');
const { formatDynamicUicolleNewsReply } = require('../src/uicolle-knowledge');

const PREFIX = '@秘書トラペル子 ';

const cases = [
  ['ヘルプ', 'help', { bare: true }],
  ['来月の縛り', 'nextRule'],
  ['来月のルール', 'nextRule'],
  ['今月の縛り', 'currentRule'],
  ['今月のルール', 'currentRule'],
  ['順位', 'monthly'],
  ['ランキング', 'monthly'],
  ['今何位', 'monthly'],
  ['年間順位', 'annual'],
  ['今年のpt', 'annual'],
  ['状況', 'status'],
  ['戦況', 'status'],
  ['誰が強い', 'status'],
  ['未対戦', 'missingMatchups'],
  ['あと誰と誰', 'missingMatchups'],
  ['対戦残り', 'missingMatchups'],
  ['未決議', { type: 'concierge', action: 'pending' }],
  ['何が残ってる？', { type: 'concierge', action: 'pending' }],
  ['次に何すれば？', { type: 'concierge', action: 'pending' }],
  ['メンバー分析', 'memberFlavor'],
  ['口癖', 'memberFlavor'],
  ['因縁', 'memberFlavor'],
  ['みんなを煽って', 'memberFlavor'],
  ['今月の名場面', 'monthlyHighlights'],
  ['日記連動ハイライト', 'monthlyHighlights'],
  ['月間まとめ', 'monthlyHighlights'],
  ['ジオゲーム', { type: 'geoGame', action: 'start' }],
  ['場所当て', { type: 'geoGame', action: 'start' }],
  ['ここどこ', { type: 'geoGame', action: 'start' }],
  ['回答 渋谷駅', { type: 'geoGame', action: 'answer' }],
  ['回答 35.658,139.701', { type: 'geoGame', action: 'answer' }],
  ['正解', { type: 'geoGame', action: 'reveal' }],
  ['結果', { type: 'geoGame', action: 'reveal' }],
  ['答え合わせ', { type: 'geoGame', action: 'reveal' }],
  ['チンチロ', { type: 'diceGame', game: 'chinchiro' }],
  ['チンチロ勝負', { type: 'diceGame', game: 'chinchiro' }],
  ['大小 大', { type: 'diceGame', game: 'daisho', guess: 'big' }],
  ['大小 小', { type: 'diceGame', game: 'daisho', guess: 'small' }],
  ['強キャラ教えて', 'uicolle:meta'],
  ['ガチャ引くべき？', 'uicolle:meta'],
  ['今のメタは？', 'uicolle:meta'],
  ['今のイベント教えて', 'uicolle:event'],
  ['今開催中のイベントは？', 'uicolle:event'],
  ['開催中のガチャは？', 'uicolle:gacha'],
  ['今のガチャは？', 'uicolle:gacha'],
  ['今開催中のガチャは？', 'uicolle:gacha'],
  ['属性って何が強い？', 'uicolle:attribute'],
  ['スピードとスタミナどっちが大事？', 'uicolle:attribute'],
  ['レアリティの違いは？', 'uicolle:rarity'],
  ['キラとレジェンドどう違う？', 'uicolle:rarity'],
  ['フォーメーションのコツ教えて', 'uicolle:formation'],
  ['ウイコレ始めたばかり', 'uicolle:beginner'],
  ['何から始める？', 'uicolle:beginner'],
  ['レンダー', 'system:render'],
  ['ファイアベース', 'system:firebase'],
  ['ギットハブ', 'system:github'],
  ['システム', 'system:system'],
  ['課金', 'billing'],
  ['無料枠', 'billing'],
  ['料金', 'billing'],
  ['仕組み', 'projectGuide'],
  ['Qiita', 'projectGuide'],
  ['自動OCR OFF', { type: 'ocrControl', action: 'disable' }],
  ['自動OCR ON', { type: 'ocrControl', action: 'enable' }],
  ['OCR 状態', { type: 'ocrControl', action: 'status' }],
  ['OCR候補', { type: 'ocrControl', action: 'preview' }],
  ['スクショ候補', { type: 'ocrControl', action: 'preview' }],
  ['集計して', { type: 'ocrControl', action: 'batch' }],
  ['スクショ集計', { type: 'ocrControl', action: 'batch' }],
  ['作戦会議', { type: 'codexCouncil' }],
  ['Codex会議', { type: 'codexCouncil' }],
  ['度肝を抜いて', { type: 'codexCouncil' }],
  ['ノブレスモード', { type: 'beastMode', action: 'enable' }],
  ['マネージャーモード', { type: 'beastMode', action: 'disable' }],
  ['モード状態', { type: 'beastMode', action: 'status' }],
  ['近くのパン', { type: 'nearby', category: 'bread' }],
  ['この近辺で評判のアパレル', { type: 'nearby', category: 'apparel' }],
  ['近くの器', { type: 'nearby', category: 'tableware' }],
  ['近くのチラシ', { type: 'flyerStock', action: 'list' }],
  ['近くの特売', { type: 'flyerStock', action: 'list' }],
  ['近くの特売レシピ', { type: 'flyerStock', action: 'recipe' }],
  ['近くのチラシでレシピ教えて', { type: 'flyerStock', action: 'recipe' }],
  ['今日の特売レシピ', { type: 'flyerStock', action: 'recipe' }],
  ['1番をお気に入り', { type: 'flyerStock', action: 'favoriteAdd' }],
  ['2番の特売', { type: 'flyerStock', action: 'storeSales' }],
  ['お気に入り店一覧', { type: 'flyerStock', action: 'favoritesList' }],
  ['和食のレシピ教えて', { type: 'flyerStock', action: 'recipe' }],
  ['豚こまで作れる？', { type: 'flyerStock', action: 'recipe' }],
  ['他には？', { type: 'flyerStock', action: 'recipeNext' }],
  ['この場所の歴史', { type: 'locationStory' }],
  ['この辺の面影', { type: 'locationStory' }],
  ['秘書っぽく案内して', { type: 'locationStory' }],
  ['みんなに自己紹介して', 'casual'],
  ['生い立ち教えて', 'casual'],
  ['何歳？', 'casual'],
  ['ありがとう', 'casual'],
  ['おはよう', 'casual'],
];

let failed = 0;
for (const [phrase, expected, options = {}] of cases) {
  const text = options.bare ? phrase : `${PREFIX}${phrase}`;
  const actual = _test.detectTextIntent(text, { allowBareHelp: options.bare === true });
  if (!matches(actual, expected)) {
    failed++;
    console.error(`NG ${phrase}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

if (failed) {
  console.error(`\n${failed} help intent checks failed.`);
  process.exit(1);
}

console.log(`OK ${cases.length} help intent checks passed.`);

const pollutedEventReply = formatDynamicUicolleNewsReply({
  event: 'IKEA: SKUBB スカップ ボックス6ピースセット\nダイソー: PPクリアボックス',
  updatedAt: '2026-05-08',
}, 'event');
assertNotIncludes(pollutedEventReply, /(IKEA|ダイソー|SKUBB|クリアボックス)/, 'polluted diary shop topics must not be returned as Uicolle events');

const itemEventReply = formatDynamicUicolleNewsReply({
  updatedAt: '2026-05-08',
  items: [
    {
      date: '2026/05/08',
      title: 'スペシャルチャレンジデイズ開催',
      content: 'ロード・トゥ・グローリーのミッションで報酬を獲得できます。',
      category: 'event',
    },
  ],
}, 'event');
assertIncludes(itemEventReply, /スペシャルチャレンジデイズ|ロード・トゥ・グローリー/, 'event items should be returned from config/uicolleNews.items');

const itemGachaReply = formatDynamicUicolleNewsReply({
  updatedAt: '2026-05-08',
  items: [
    {
      date: '2026/05/08',
      title: 'ピックアップスカウト開催',
      content: 'スペシャル選手登場。',
      category: 'gacha',
    },
  ],
}, 'gacha');
assertIncludes(itemGachaReply, /ピックアップスカウト|スペシャル選手/, 'gacha items should be returned from config/uicolleNews.items');

console.log('OK dynamic Uicolle content guard passed.');

function matches(actual, expected) {
  if (typeof expected === 'string') return actual === expected;
  if (!actual || typeof actual !== 'object') return false;
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function assertIncludes(text, pattern, message) {
  if (!pattern.test(text)) {
    console.error(`NG ${message}: ${JSON.stringify(text)}`);
    process.exit(1);
  }
}

function assertNotIncludes(text, pattern, message) {
  if (pattern.test(text)) {
    console.error(`NG ${message}: ${JSON.stringify(text)}`);
    process.exit(1);
  }
}
