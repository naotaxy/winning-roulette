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
  '★5': 'ウイコレ最高レアリティ。スペシャルスキルランクA、最大レベル70（上限突破で80）。スカウトの主役でここを狙うのが基本。',
  '★4': '準主力カード。スペシャルスキルランクB〜C、最大レベル60（上限突破で70）。★5と比べると見劣りするけど使える選手も多い。',
  プロメテウスシリーズ: '毎月25日前後に開催される伝説的選手のスカウト。マラドーナやロナウド（フェノーメノ）などのレジェンドが登場する。周期が読みやすいのが特徴。',
  ピックアップスカウト: '約2週間サイクルで入れ替わる期間限定スカウト。逃すと次いつ来るかわからないから注意。',
  ダイヤモンドスカウト: 'ポイントを貯めて選手を獲得するイベント型スカウト。計画的にこなせばお得に強選手を入手できる。',
  亜種系スカウト: '月1〜2回登場するポジション別や能力特化の特殊スカウト。ゴールドセンス・リトライ系はシングル確定★5が多い。',
};

const SENSE_GUIDE = {
  センス基本:
    'センスはフュージョン（同じ選手カードを合成）で強化する仕組み。ランクD→C→B→Aと上がるほど強くなる。ランクAは「顔面」とも呼ばれてる。今のウイコレはセンスが強さの軸になってる「センスゲー」だよ。',
  アディショナルセンス:
    'アドセンス（ADD）は★5フュージョン時に確率で付く特別なセンス。最大3個まで付けられて、「フィットセンス（全能力+10%）」「スーパーサブ（交代後+20%）」「ポジション拡張」などの効果がある。今のメタで一番重要な要素で、カード評価の最優先ポイント。',
  カスタムセンス:
    'カードごとに固有の特殊センス。フュージョン回数で最大レベル2まで解放できる（Lv1：5回、Lv2：7回）。「メサイア」（マラドーナ・メッシ専用）や「ワンタッチゴーラー」（インザーギ・ハーランド）が特に強力。',
  カスタムセンスプラス:
    '2025-26シーズンから登場した強化版カスタムセンス。レベル3まで解放できる（9回フュージョン必要）。「ドリブルスター＋」「ゲームメーカー＋」「トップスコアラー＋」「ピッチランナー＋」などが存在。対応選手はカード評価がワンランク上。',
  セレクトスキル:
    '一部の選手だけが持つ第3のスペシャルスキル。試合中に発動条件を満たすと獲得できる特殊スキル。2択から1つ選べる形式で、チーム全体のスキルランクを上げる効果もある。センスと組み合わさると試合前の能力比較で優位に立てる。',
  強いカスタムセンス例:
    '「メサイア」（Lv2でシュート顔面＋決定力）はマラドーナとメッシだけの専用センス。「ワンタッチゴーラー」（Lv1でEP50%＋シュート顔面A）はインザーギ・ハーランドが持ち、得点王ランキングを支配した実績あり。「クロス弾幕」はWG・SHに強力で、CFへのクロス供給がスムーズになる。',
};

const FORMATION_TIPS = [
  '4-3-3 はプレスと裏抜けのバランスがよく、どの縛りルールでも合わせやすい定番フォーメーション。',
  '4-2-3-1 はMFを厚くしたいテクニック縛り月に向いてる。中盤でボールをつなぐ戦術と相性いい。',
  '3-4-3 はパワー縛りでCBを3枚並べたい時に。前線に3枚張れるから速攻も刺しやすい。',
  '4-4-2 はスタミナ縛りに強い。前線2枚がシンプルだから、走れる選手が少ない月でも崩されにくいよ。',
  '5-3-2 はスピード縛りの相手に強い守備フォーメーション。ただし攻撃の厚みが薄くなるから点を取りきる力が必要。',
];

const META_KNOWLEDGE = [
  '今のウイコレはアドセンス（アディショナルセンス）とカスタムセンス＋が強さの軸の「センスゲー」。カード評価はまずアドセンスの有無と質から見るのが基本。',
  '2025-26シーズンのカスタムセンス＋対応選手が現行最強クラス。ラミン・ヤマル、グリマルド、メッシ（メサイア）あたりが評価高い。',
  'レジェンド系ではマラドーナが「メサイア」＋「ショータイム」で万能、ロベルト・カルロスはSH起用で射程が段違い。',
  'プロメテウスガチャは毎月25日前後に開催。マラドーナ・ロナウド（フェノーメノ）など強力なレジェンドが登場しやすい。',
  'ピックアップスカウトは約2週間サイクルで入れ替わる。過去の周期はFC伯爵やwecc.siteで確認できるよ。',
  'ダイヤモンドスカウトはポイント制で計画的に獲得できるのでコスパが高い。',
  '確定スカウトは引き直し可能なものが多い。期間中に他の選手と比べてから確定するのがおすすめ。',
];

const BEGINNER_TIPS = [
  'まず★5選手を各ポジションに1枚ずつ揃えることを目標にすると試合が安定してくる。',
  'GP（ゲームポイント）はピックアップスカウト期間の強い選手に集中させた方が効率いいよ。',
  '縛りルールがある月は事前にフィルターで属性別に使える選手を確認しておくと慌てなくて済む。',
  '上限突破素材は貴重。全選手に使わず、レギュラーで使う★5選手に集中させた方がいい。',
  'プロメテウスガチャは毎月25日前後なので、それに向けてGPを貯めておくのもあり。',
  'センス強化は今のウイコレで最重要。アドセンスがついてる★5を優先的にフュージョンしていこう。',
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
  return `ウイコレのカード・スカウト種別、説明するね。\n\n${lines.join('\n\n')}`;
}

function formatSenseGuide(kind) {
  if (kind && SENSE_GUIDE[kind]) {
    return SENSE_GUIDE[kind];
  }
  const lines = Object.entries(SENSE_GUIDE).map(([k, v]) => `【${k}】${v}`);
  return `ウイコレのセンス機能、まとめて説明するね。\n\n${lines.join('\n\n')}`;
}

function formatFormationTips() {
  return `フォーメーションのコツ、知ってる範囲で教えるね。\n\n${FORMATION_TIPS.join('\n')}`;
}

function formatMetaKnowledge() {
  return `強カード・ガチャについて、私が知ってることを話すね。\n\n${META_KNOWLEDGE.join('\n\n')}\n\n次のガチャや最新イベントの予想は「最近のウイコレどう？」って聞いてくれれば、私が日々追ってる情報をもとに話すよ。`;
}

function formatBeginnerTips() {
  return `ウイコレの基本的なコツ、私なりにまとめてみたよ。\n\n${BEGINNER_TIPS.join('\n\n')}`;
}

function formatDynamicUicolleNewsReply(news, kind = 'news') {
  if (!news) {
    return 'ごめん、今のところ最新情報が登録されてないみたい。\n管理者が Firebase の config/uicolleNews に書き込んでくれれば、すぐ伝えられるよ。';
  }

  const safeNews = normalizeDynamicUicolleNews(news);
  const updated = safeNews.updatedAt ? `\n\n（更新: ${safeNews.updatedAt}）` : '';
  const fetchNote = formatDynamicUicolleFetchNote(safeNews);
  if (kind === 'gacha') {
    return safeNews.gacha
      ? `今開催中のガチャ・スカウト情報だよ。\n\n【ガチャ・スカウト】\n${safeNews.gacha}${updated}`
      : `ガチャ・スカウト情報は、今の登録データだとまだ空みたい。\n\n${safeNews.event ? `【登録済みイベント】\n${safeNews.event}` : 'イベント側の最新情報もまだ薄めだよ。'}${fetchNote}${updated}`;
  }

  if (kind === 'event') {
    return safeNews.event
      ? `今開催中のイベント情報だよ。\n\n【イベント】\n${safeNews.event}${updated}`
      : `イベント情報は、今の登録データだとまだ空みたい。\n\n${safeNews.gacha ? `【登録済みガチャ・スカウト】\n${safeNews.gacha}` : 'ガチャ側の最新情報もまだ薄めだよ。'}${fetchNote}${updated}`;
  }

  const blocks = [];
  if (safeNews.event) blocks.push(`【イベント】\n${safeNews.event}`);
  if (safeNews.gacha) blocks.push(`【ガチャ・スカウト】\n${safeNews.gacha}`);
  if (safeNews.blogUrl) blocks.push(`【日記】\n${safeNews.blogUrl}`);
  return blocks.length
    ? `最新情報、登録されてたよ。\n\n${blocks.join('\n\n')}${updated}`
    : `最新情報は登録されてるけど、中身はまだ薄めみたい。${fetchNote}${updated}`;
}

function normalizeDynamicUicolleNews(news) {
  const items = Array.isArray(news?.items) ? news.items : [];
  return {
    event: sanitizeDynamicUicolleText(news?.event, 'event') || buildDynamicSummaryFromItems(items, 'event'),
    gacha: sanitizeDynamicUicolleText(news?.gacha, 'gacha') || buildDynamicSummaryFromItems(items, 'gacha'),
    blogUrl: news?.blogUrl || '',
    updatedAt: news?.updatedAt || '',
    source: news?.source || '',
    note: news?.refreshNote || news?.note || '',
  };
}

function buildDynamicSummaryFromItems(items, kind) {
  return (Array.isArray(items) ? items : [])
    .filter(item => isDynamicItemKind(item, kind))
    .slice(0, 4)
    .map(item => {
      const title = normalizeDynamicText(item.title || '');
      const date = item.date || item.idx || '日付不明';
      const content = item.content ? `\n${clipDynamicUicolleText(item.content, 360)}` : '';
      return `【${date}】${title}${content}`;
    })
    .join('\n\n');
}

function sanitizeDynamicUicolleText(text, kind) {
  const normalized = normalizeDynamicText(text);
  if (!normalized || isNonUicolleDiaryTopic(normalized)) return '';
  if (kind === 'gacha') return isDynamicUicolleGachaText(normalized) ? String(text).trim() : '';
  if (kind === 'event') return isDynamicUicolleEventText(normalized) ? String(text).trim() : '';
  return normalized;
}

function isDynamicItemKind(item, kind) {
  if (item?.category === kind) return true;
  const text = normalizeDynamicText(`${item?.title || ''} ${item?.content || ''}`);
  if (!text || isNonUicolleDiaryTopic(text)) return false;
  if (kind === 'gacha') return isDynamicUicolleGachaText(text);
  if (kind === 'event') return isDynamicUicolleEventText(text) && !isDynamicUicolleGachaText(text);
  return false;
}

function isDynamicUicolleEventText(text) {
  return /(イベント|チャレンジ|デイズ|キャンペーン|ロード・?トゥ・?グローリー|ボーナスタイム|ログインボーナス|ミッション|カップ|ツアー|フェス|リーグ|マッチ|ゲストチーム|開催|ランキング|スタジアム)/i.test(String(text || ''));
}

function isDynamicUicolleGachaText(text) {
  return /(ガチャ|スカウト|パック|カード|選手登場|スペシャル.*選手|レジェンド|エピック|epic|legend|potw|show\s*time|ショータイム|ブースター|booster|ナショナル|ピックアップ)/i.test(String(text || ''));
}

function isNonUicolleDiaryTopic(text) {
  return /(ikea|イケア|ダイソー|セリア|キャンドゥ|100均|百均|unico|standard products|スタンダードプロダクツ|ポケベル|90年代|注目アイテム|ショップ|グッズ|家具|収納|ソファ|トレー|シリコン|文具|JMOOC|講座|青空文庫)/i.test(String(text || ''));
}

function normalizeDynamicText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clipDynamicUicolleText(text, maxLength) {
  const normalized = normalizeDynamicText(text);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatDynamicUicolleFetchNote(news) {
  const note = String(news?.note || '');
  if (!note) return '';
  if (/WICOLLE_SSID not set/i.test(note)) {
    return '\n\n公式インフォを取りに行くための `WICOLLE_SSID` が未設定みたい。Renderの環境変数を確認してね。';
  }
  if (/session expired/i.test(note)) {
    return '\n\n公式インフォのセッションが切れてるみたい。Proxymanで新しい `_ssid` を取り直して `WICOLLE_SSID` を更新してね。';
  }
  if (/status|fetch|timeout|aborted|network|no current items/i.test(note)) {
    return `\n\n公式インフォの再取得メモ: ${note}`;
  }
  return '';
}

/* 属性キーワードの検出 */
function detectAttributeKeyword(text) {
  for (const attr of Object.keys(ATTRIBUTE_GUIDE)) {
    if (text.includes(attr)) return attr;
  }
  return null;
}

/* センスキーワードの検出 */
function detectSenseKeyword(text) {
  if (/(アドセンス|アディショナルセンス|addsense|add)/.test(text)) return 'アディショナルセンス';
  if (/(カスタムセンス\+|カスタムセンスプラス|カスタム\+)/.test(text)) return 'カスタムセンスプラス';
  if (/(カスタムセンス)/.test(text)) return 'カスタムセンス';
  if (/(セレクトスキル|セレクト)/.test(text)) return 'セレクトスキル';
  if (/(センスゲー|センスゲ)/.test(text)) return 'センス基本';
  if (/(強いカスタム|メサイア|ワンタッチゴーラー|クロス弾幕)/.test(text)) return '強いカスタムセンス例';
  return null;
}

/* ウイコレ質問の種別検出 */
function detectUicolleIntent(text) {
  const dynamicKind = detectDynamicUicolleInfoIntent(text);
  if (dynamicKind) return dynamicKind;
  if (/(センス|アドセンス|カスタムセンス|セレクトスキル|フュージョン|センスゲー)/.test(text)) return 'sense';
  if (/(属性|速さ|スピード|スタミナ|パワー|テクニック|バランス)/.test(text)) return 'attribute';
  if (/(強キャラ|強カード|tier|ティア|最強|今のメタ|メタ|おすすめ|使えるカード|ガチャ|スカウト|引く|引いた方|プロメテウス|ピックアップ)/.test(text)) return 'meta';
  if (/(レアリティ|レア|星5|星4|カードの種類|★5|★4|キラ|レジェンド)/.test(text)) return 'rarity';
  if (/(フォーメーション|布陣|4-3-3|4-4-2|戦術|フォメ)/.test(text)) return 'formation';
  if (/(初心者|始めた|わからない|コツ|何から|どうすれば)/.test(text)) return 'beginner';
  return null;
}

function detectDynamicUicolleInfoIntent(text) {
  const t = String(text || '').normalize('NFKC');
  const asksNow = /(今|現在|開催中|開催して|実施中|やってる|最新|最近|今日|このガチャ|このイベント|今開催中)/.test(t);
  const asksInfo = /(情報|教えて|どう|なに|何|どれ|内容|一覧|状況|開催)/.test(t);

  if (/(最新情報|ウイコレ.*情報|最近のウイコレ|ウイコレ.*どう)/.test(t)) return 'news';
  if (/(使用感|考察|評価).*(教えて|どう|知りたい)?/.test(t) && /(ウイコレ|ガチャ|スカウト|選手|カード)/.test(t)) return 'news';
  if (/(イベント|event)/i.test(t) && (asksNow || asksInfo)) return 'event';
  if (/(ガチャ|スカウト|scout)/i.test(t) && (asksNow || /開催/.test(t))) return 'gacha';
  return null;
}

module.exports = {
  formatAttributeGuide,
  formatRarityGuide,
  formatSenseGuide,
  formatFormationTips,
  formatMetaKnowledge,
  formatBeginnerTips,
  formatDynamicUicolleNewsReply,
  detectAttributeKeyword,
  detectSenseKeyword,
  detectUicolleIntent,
  detectDynamicUicolleInfoIntent,
};
