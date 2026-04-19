'use strict';

/* ── eFootball（ウイコレ）の静的知識ベース ──
   動的情報（現在のイベント・ガチャ）は Firebase config/uicolleNews から取得する。
   静的知識はキャラクターの「博士知識」として自由に参照する。 */

const ATTRIBUTE_GUIDE = {
  スピード: 'ドリブル・ダッシュの速さに直結。WGやSBに重要。縛り月はFWとMFの速い選手で固めるとプレス回避が楽になるよ。',
  スタミナ: '後半のパフォーマンス低下を抑える。縛り月は特に運動量が多いポジション（SB・IH）の選手が弱体化しやすいから注意して。',
  パワー: 'フィジカルコンタクト全般。競り合いのジャンプ、ボールキープ、タックルの強さに影響。CBとDFにはほぼ必須の属性。',
  テクニック: 'パスとドリブルの精度。ボールロストが減るからポゼッション重視の戦術で輝く。縛り月は特にMF選手の質が顕著に出るよ。',
  バランス: '複数の能力が高水準で揃った選手。飛び抜けた強みはないけど縛り月に左右されにくいのが強み。初心者にも扱いやすい。',
};

const RARITY_GUIDE = {
  レギュラー: '入手しやすい基本カード。縛り月だとドラフトに使えるメインカードになることも。育成素材としての価値も高い。',
  キラ: '性能・外見ともに上位のカード。ゲーム内の主力になるレベル。限定キラは強力なものが多い。',
  レジェンド: '往年のスター選手カード。ステータスが高水準で揃っているが、縛り月ルールで使用禁止になる場合もある。',
  エピック: '期間限定の超高性能カード。公式イベントのピックアップ対象になりやすく、リリース直後は特に強い。',
};

const FORMATION_TIPS = [
  '4-3-3 はプレスと裏抜けのバランスがよく、どの縛りルールでも合わせやすい定番フォーメーション。',
  '4-2-3-1 はMFを厚くしたいテクニック縛り月に向いてる。中盤でボールをつなぐ戦術と相性いい。',
  '3-4-3 はパワー縛りでCBを3枚並べたい時に。前線に3枚張れるから速攻も刺しやすい。',
  '4-4-2 はスタミナ縛りに強い。前線2枚がシンプルだから、走れる選手が少ない月でも崩されにくいよ。',
  '5-3-2 はスピード縛りの相手に強い守備フォーメーション。ただし攻撃の厚みが薄くなるから点を取りきる力が必要。',
];

const META_KNOWLEDGE = [
  '最新の強カードはピックアップスカウトのFeatured選手が目安。特に「エピック」表記がついてる選手は性能が段違いのことが多い。',
  'イベントの「報酬GP選手」は無料で入手できる割に性能が高いことが多く、コスパで選ぶなら見逃せないよ。',
  '毎月初めのアップデートで選手能力値が調整されることがある。メジャーな選手の能力変動は公式のアップデートノートで確認してね。',
  'スカウトの「確定枠」は引き直し可能なガチャが多い。引き直しできる期間中に他の選手と比べてから確定するといいよ。',
  '育成は「通常強化」より「カスタマイズ強化」の方が効率がいい場合が多いけど、縛り月でカスタム禁止になると無駄になることもあるから注意して。',
  '期間限定のコラボイベントは復刻しないことも多い。好きな選手が出たら逃さないようにね。',
];

const BEGINNER_TIPS = [
  'GP（ゲームポイント）は無料スカウトで大量消費するより、ピックアップ期間の強い選手に集中させた方が効率いいよ。',
  'まず各ポジションに最低1枚ずつ「キラ」以上を揃えることを目標にすると、試合の質が安定してくる。',
  '縛りルールがある月は事前にフィルターで属性別に使える選手を確認しておくと慌てなくて済む。',
  'カスタマイズは上限突破素材が貴重。全選手に使おうとせず、レギュラーで使う選手に集中させた方がいい。',
];

function formatAttributeGuide(attr) {
  if (attr && ATTRIBUTE_GUIDE[attr]) {
    return `${attr}の属性について話すね。\n${ATTRIBUTE_GUIDE[attr]}`;
  }
  const lines = Object.entries(ATTRIBUTE_GUIDE).map(([k, v]) => `【${k}】${v}`);
  return `ウイコレの5大属性、私が覚えてる範囲でまとめるね。\n\n${lines.join('\n\n')}`;
}

function formatRarityGuide() {
  const lines = Object.entries(RARITY_GUIDE).map(([k, v]) => `【${k}】${v}`);
  return `カードレアリティの違い、説明するね。\n\n${lines.join('\n\n')}`;
}

function formatFormationTips() {
  return `フォーメーションのコツ、知ってる範囲で教えるね。\n\n${FORMATION_TIPS.join('\n')}`;
}

function formatMetaKnowledge() {
  return `強カード・ガチャについて、私が知ってることを話すね。\n\n${META_KNOWLEDGE.join('\n\n')}\n\n最新のイベントとガチャは「今のイベント教えて」って聞いてくれたら、登録されてる情報を持ってくるよ。`;
}

function formatBeginnerTips() {
  return `ウイコレの基本的なコツ、私なりにまとめてみたよ。\n\n${BEGINNER_TIPS.join('\n\n')}`;
}

/* 属性キーワードの検出 */
function detectAttributeKeyword(text) {
  for (const attr of Object.keys(ATTRIBUTE_GUIDE)) {
    if (text.includes(attr)) return attr;
  }
  return null;
}

/* ウイコレ質問の種別検出 */
function detectUicolleIntent(text) {
  if (/(強[いキャ]|tier|ティア|最強|おすすめ|使えるカード|ガチャ|スカウト|引く|引いた方|フィーチャー)/.test(text)) return 'meta';
  if (/(属性|速さ|スピード|スタミナ|パワー|テクニック|バランス)/.test(text)) return 'attribute';
  if (/(レアリティ|レア|キラ|レジェンド|エピック|レギュラー|星5|星4|カードの種類)/.test(text)) return 'rarity';
  if (/(フォーメーション|布陣|4-3-3|4-4-2|戦術|フォメ)/.test(text)) return 'formation';
  if (/(初心者|始めた|わからない|コツ|何から|どうすれば)/.test(text)) return 'beginner';
  return null;
}

module.exports = {
  formatAttributeGuide,
  formatRarityGuide,
  formatFormationTips,
  formatMetaKnowledge,
  formatBeginnerTips,
  detectAttributeKeyword,
  detectUicolleIntent,
};
