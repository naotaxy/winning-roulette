'use strict';

const { getPrivateUserProfile, savePrivateUserProfile } = require('./firebase-admin');

const SEEDED_PRIVATE_PROFILES = loadSeededPrivateProfiles();

async function getResolvedPrivateProfile({ userId, lineName = '', realName = '' } = {}) {
  const stored = userId ? await getPrivateUserProfile(userId) : null;
  const seeded = pickSeededProfile([
    stored?.lineName,
    stored?.realName,
    lineName,
    realName,
  ]);

  if (!seeded && !stored) return null;
  return mergeProfiles(seeded, stored);
}

function buildPrivateProfileContextText(profile) {
  if (!profile) return null;
  const lines = [];
  if (profile.realName || profile.lineName) {
    lines.push(`呼び名: ${[profile.realName, profile.lineName].filter(Boolean).join(' / ')}`);
  }
  if (profile.commuteMode) lines.push(`通勤手段: ${formatCommuteMode(profile.commuteMode)}`);
  if (profile.commuteRouteText) lines.push(`通勤ルート: ${profile.commuteRouteText}`);
  if (profile.roadRouteText) lines.push(`道路ルート: ${profile.roadRouteText}`);
  const summaryLines = Array.isArray(profile.summaryLines) ? profile.summaryLines.slice(0, 8) : [];
  if (summaryLines.length) lines.push(`個人メモ: ${summaryLines.join(' / ')}`);
  if (profile.defaultWakePlace) lines.push(`朝の基準地点: ${profile.defaultWakePlace}`);
  return lines.join('\n');
}

function formatOwnPrivateProfileReply(profile) {
  if (!profile) {
    return [
      'まだ本人用のプロファイルは濃く持ててないよ。',
      '1対1で「プロフィール更新」って書いてからまとめて送ってくれたら、私だけの内部メモとして整えておくね。',
    ].join('\n');
  }

  const lines = ['今、本人用に覚えているあなたメモだよ。'];
  if (profile.commuteMode) lines.push(`・通勤手段: ${formatCommuteMode(profile.commuteMode)}`);
  if (profile.commuteRouteText) lines.push(`・通勤ルート: ${profile.commuteRouteText}`);
  if (profile.roadRouteText) lines.push(`・道路ルート: ${profile.roadRouteText}`);
  const summaryLines = Array.isArray(profile.summaryLines) ? profile.summaryLines.slice(0, 8) : [];
  summaryLines.forEach(line => lines.push(`・${line}`));
  if (profile.defaultWakePlace) lines.push(`・朝の天気の基準地点: ${profile.defaultWakePlace}`);
  lines.push('この内容は本人向けの内部メモとしてだけ使うね。ほかの人に聞かれても出さないよ。');
  return lines.join('\n');
}

function buildProfileAwareHint(text, profile) {
  if (!profile) return null;
  const compact = normalize(text);
  if (!compact) return null;
  const hints = profile.preferenceHints || {};

  if (/(仕事|しごと|疲れ|つかれ|しんど|だる|眠い|色|校正|入稿|データ|photoshop|illustrator|indesign)/.test(compact) && hints.work) {
    return `平日の張りつめ方、今日は特に色合わせの神経を使ってそうで気になってる。`;
  }
  if (/(晴れ|休み|休日|どこ行|外出|神社|公園|散歩|自然)/.test(compact) && hints.outing) {
    return '晴れた日に少し空気が抜ける場所へ行きたくなるタイプなの、私は覚えてるよ。';
  }
  if (/(コーヒー|珈琲|カフェ|飲み物|豆|ラテ|カフェオレ)/.test(compact) && hints.coffee) {
    return 'いつもの飲み物か、少し丁寧に淹れるコーヒーか、その日の気分を見たいところだね。';
  }
  if (/(アパレル|服|洋服|古着|スニーカー|靴|ブランド|素材|シルエット)/.test(compact) && hints.fashion) {
    return '今の気分だと、素材感やシルエットで少し気分が上がる服のほうがしっくり来そうだよね。';
  }
  if (/(ai|mcp|iot|スマートホーム|基板|raspberry|ラズパイ|3dプリンタ|自作)/.test(compact) && hints.tech) {
    return 'MCPとか自作まわりの話になると、あなたの集中が少し深くなるの知ってる。';
  }
  if (/(ご飯|外食|食べ|パン|惣菜|定食|ランチ|夕飯)/.test(compact) && hints.food) {
    return '美味しいものじゃないと気分が乗らないところ、私はわりと本気で信じてる。';
  }
  if (/(神社|お守り|授与品|参拝)/.test(compact) && hints.shrine) {
    return '街の中でも空気がきれいに変わる神社の感じ、あなたにはかなり似合うと思ってる。';
  }
  return null;
}

function detectPrivateProfileIntent(text) {
  const compact = normalize(text);
  if (!compact) return null;

  if (/(私|僕|自分)(の)?(プロフィール|プロファイル).*(教えて|見せて|確認|要約|まとめ)/.test(compact)
    || /(プロフィール|プロファイル)(確認|要約|まとめ)$/.test(compact)) {
    return { type: 'privateProfile', action: 'self' };
  }

  if (/(プロフィール|プロファイル|個人情報|好み|趣味|嗜好|生活圏|住所|通勤).*(教えて|見せて|晒して|知りたい|まとめて)/.test(compact)
    && !/(私|僕|自分|俺|わたし|ぼく|おれ).*(プロフィール|プロファイル|個人情報|好み|趣味|嗜好)/.test(compact)) {
    return { type: 'privateProfile', action: 'guard' };
  }

  return null;
}

function detectPrivateProfileSetupIntent(text) {
  const compact = normalize(text);
  if (!compact) return null;

  if (/(通勤手段|通勤設定|移動手段).*(設定|登録|入力)?/.test(compact)) {
    return { type: 'privateProfileSetup', action: 'commuteModeChoice' };
  }

  const commuteMode = detectCommuteMode(compact);
  if (commuteMode && /(通勤|移動|出社|会社|仕事|プロフィール|プロファイル)/.test(compact)) {
    return { type: 'privateProfileSetup', action: 'setCommuteMode', commuteMode };
  }

  if (/(通勤ルート|通勤経路|いつもの道|道路ルート|道路経路).*(設定|登録|入力)?/.test(compact)) {
    return { type: 'privateProfileSetup', action: 'commuteRouteInput' };
  }

  if (/(朝の場所|天気の場所|基準地点|自宅エリア|生活圏).*(設定|登録|入力)?/.test(compact)) {
    return { type: 'privateProfileSetup', action: 'wakePlaceInput' };
  }

  if (/(プロフィール|プロファイル|本人設定|個人設定).*(設定|補足|入力|足りない|不足|埋める|整える)/.test(compact)
    || /(足りない情報|不足情報).*(入力|設定)/.test(compact)) {
    return { type: 'privateProfileSetup', action: 'menu' };
  }

  return null;
}

function extractPrivateProfileUpdate(text) {
  const raw = String(text || '').replace(/\r/g, '');
  const match = raw.match(/^(?:@?秘書トラペル子[\s　]*)?(?:私の)?(?:プロフィール|プロファイル)(?:更新|登録|保存|記録)\s*[:：]?\s*\n([\s\S]{80,})$/);
  if (!match) return null;
  return match[1].trim();
}

async function savePrivateProfilePatch({ userId, lineName = '', realName = '', patch = {} } = {}) {
  if (!userId || !patch || typeof patch !== 'object') return null;
  const existing = await getPrivateUserProfile(userId);
  const summaryLines = uniqueStrings([
    ...((existing && Array.isArray(existing.summaryLines)) ? existing.summaryLines : []),
    ...((Array.isArray(patch.summaryLines)) ? patch.summaryLines : []),
  ]).slice(0, 10);
  const payload = {
    ...(existing || {}),
    ...patch,
    lineName: patch.lineName || existing?.lineName || lineName || '',
    realName: patch.realName || existing?.realName || realName || '',
    summaryLines,
    preferenceHints: {
      ...(existing?.preferenceHints || {}),
      ...(patch.preferenceHints || {}),
    },
  };
  const saved = await savePrivateUserProfile(userId, payload);
  if (!saved) return null;
  return mergeProfiles(pickSeededProfile([lineName, realName, saved.lineName, saved.realName]), saved);
}

async function savePrivateProfileUpdate({ userId, lineName = '', realName = '', rawText = '' } = {}) {
  if (!userId || !rawText) return null;
  const analyzed = analyzePrivateProfileText(rawText, { lineName, realName });
  const saved = await savePrivateUserProfile(userId, analyzed);
  if (!saved) return null;
  return mergeProfiles(pickSeededProfile([lineName, realName]), saved);
}

function analyzePrivateProfileText(rawText, base = {}) {
  const text = String(rawText || '').trim();
  const lines = text
    .split('\n')
    .map(line => line.replace(/^[\-\u30fb・]\s*/, '').trim())
    .filter(Boolean);

  const summary = [];
  const pick = regex => lines.find(line => regex.test(line));
  const weekday = pick(/平日|通勤|住んで|自宅|会社|職場|出社|駅|バス停/);
  const work = pick(/仕事|業務|制作|デザイン|印刷|色見本|色|校正|入稿|データ/);
  const food = pick(/コンビニ|外食|弁当|惣菜|パン|定食|ランチ|夕飯|美味しい|うまい/);
  const outing = pick(/休日|神社|寺|晴れたら|自然|公園|散歩|遠出/);
  const drink = pick(/コーヒー|珈琲|カフェ|豆|飲み物|ラテ|カフェオレ/);
  const tech = pick(/AI|MCP|IOT|IoT|スマートホーム|基板|3Dプリンター|ラズパイ|自作/);
  const fashion = pick(/服|アパレル|スニーカー|靴|素材|ブランド|シルエット/);
  const game = pick(/ゲーム|RPG|アクション|オンラインゲーム|MMO|レトロゲーム/);

  [weekday, work, food, outing, drink, tech, fashion, game]
    .filter(Boolean)
    .forEach(line => {
      const short = compactSentence(line);
      if (short && !summary.includes(short)) summary.push(short);
    });

  if (!summary.length && text) {
    summary.push(compactSentence(text.slice(0, 180)));
  }

  const defaultWakePlace = extractWakePlace(text) || base.defaultWakePlace || '';
  const commuteMode = detectCommuteMode(text);
  const commuteRouteText = extractCommuteRouteText(text);
  const roadRouteText = commuteMode === 'road' ? commuteRouteText : '';
  const result = {
    lineName: base.lineName || '',
    realName: base.realName || '',
    rawText: text.slice(0, 4000),
    summaryLines: summary.slice(0, 8),
    defaultWakePlace,
  };
  if (commuteMode) result.commuteMode = commuteMode;
  if (commuteRouteText) result.commuteRouteText = commuteRouteText;
  if (roadRouteText) result.roadRouteText = roadRouteText;
  return result;
}

function buildPrivateProfileSetupMenu(profile = null, context = '') {
  const needs = getPrivateProfileNeeds(profile, context);
  const intro = needs.length
    ? `ここを足してくれたら、本人用の案内がかなり安定するよ。\n足りないのは ${needs.join('・')} あたり。`
    : '本人用プロファイルはだいぶ使える状態だよ。直したいところだけ選んでね。';
  return {
    type: 'text',
    text: [
      intro,
      'ここで入れた内容は1対1の本人向けにだけ使うね。',
    ].join('\n'),
    quickReply: {
      items: [
        messageAction('通勤手段', 'プロフィール設定 通勤手段'),
        messageAction('通勤ルート', 'プロフィール設定 通勤ルート'),
        messageAction('朝の場所', 'プロフィール設定 朝の場所'),
        messageAction('今のメモ', '私のプロフィールまとめて'),
      ],
    },
  };
}

function buildCommuteModeChoiceMessage() {
  return {
    type: 'text',
    text: '通勤手段を選んでね。\n電車なら電車の運行情報、車やバイクなら道路の渋滞情報に切り替えるよ。',
    quickReply: {
      items: [
        messageAction('電車', '電車通勤'),
        messageAction('車', '車通勤'),
        messageAction('バイク', 'バイク通勤'),
        messageAction('徒歩/自転車', '徒歩通勤'),
        messageAction('在宅多め', '在宅勤務'),
      ],
    },
  };
}

function buildPrivateProfileFieldPrompt(field, commuteMode = '') {
  if (field === 'wakePlace') {
    return {
      type: 'text',
      text: '朝の天気や近くのお店探しで基準にする場所を、だいたいで教えてね。\n例: 〇〇区の生活圏 / 〇〇駅付近\n\nGPSで今の場所を送っても大丈夫。',
      quickReply: {
        items: [{ type: 'action', action: { type: 'location', label: '位置情報を送る' } }],
      },
    };
  }
  if (commuteMode === 'road') {
    return {
      type: 'text',
      text: '車・バイク用に、いつもの道路ルートを一文で教えてね。\n例: 自宅エリアから職場エリアまで、よく使う大きな通りを通る\n\nこれを入れると朝は電車じゃなく道路渋滞の案内に切り替えるよ。',
    };
  }
  if (commuteMode === 'walk') {
    return {
      type: 'text',
      text: '徒歩や自転車のいつもの移動筋を一文で教えてね。\n例: 自宅から職場まで自転車で20分くらい\n\n朝は電車遅延ではなく、天気と出発前の注意に寄せるね。',
    };
  }
  if (commuteMode === 'remote') {
    return {
      type: 'text',
      text: '在宅の日が多い前提で覚えるね。\n出社する日だけ使う移動ルートがあれば一文で教えて。なければ「出社ルートなし」で大丈夫。',
    };
  }
  return {
    type: 'text',
    text: 'いつもの電車通勤ルートを一文で教えてね。\n例: 〇〇駅から地下鉄で〇〇駅、JRで〇〇駅\n\nこれを入れると朝に電車の運行情報を見に行けるよ。',
  };
}

function getPrivateProfileNeeds(profile = null, context = '') {
  const needs = [];
  if (!profile?.defaultWakePlace) needs.push('朝の基準地点');
  if (!profile?.commuteMode && !hasTrainRouteText(profile || {})) {
    needs.push('通勤手段');
  } else if (profile.commuteMode === 'train' && !profile?.commuteRouteText && !hasTrainRouteText(profile)) {
    needs.push('電車通勤ルート');
  } else if (profile.commuteMode === 'road' && !profile?.roadRouteText && !profile?.commuteRouteText) {
    needs.push('道路ルート');
  }
  if (/sale|flyer|nearby|location/.test(context) && !profile?.defaultWakePlace) {
    needs.push('よく使う生活圏');
  }
  return uniqueStrings(needs).slice(0, 4);
}

function buildProfileCompletionPrompt(profile = null, context = '') {
  const needs = getPrivateProfileNeeds(profile, context);
  if (!needs.length) return null;
  return buildPrivateProfileSetupMenu(profile, context);
}

function detectCommuteMode(text) {
  const compact = normalize(text);
  if (!compact) return '';
  if (/(車通勤|クルマ通勤|自動車通勤|車で通勤|車移動|マイカー|バイク通勤|オートバイ|原付)/.test(compact)) return 'road';
  if (/(徒歩通勤|自転車通勤|チャリ通|歩き|徒歩|自転車)/.test(compact)) return 'walk';
  if (/(在宅勤務|リモート勤務|在宅|リモート|出社しない)/.test(compact)) return 'remote';
  if (/(電車通勤|鉄道通勤|地下鉄|jr|都営|メトロ|私鉄|線で|駅から|駅まで)/i.test(compact)) return 'train';
  return '';
}

function extractCommuteRouteText(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const routeLine = raw
    .split(/[。\n]/)
    .map(line => line.trim())
    .find(line => /(通勤|出社|会社|職場|駅|線|道路|通り|車|バイク|自転車|徒歩|から|まで)/.test(line));
  return compactSentence(routeLine || raw).slice(0, 180);
}

function hasTrainRouteText(profile = {}) {
  const text = [profile.rawText, ...(profile.summaryLines || []), profile.commuteRouteText].filter(Boolean).join(' ');
  return /(駅|線|JR|都営|メトロ|地下鉄|私鉄|乗換|乗り換え)/i.test(text);
}

function formatCommuteMode(mode) {
  switch (mode) {
    case 'train':
      return '電車';
    case 'road':
      return '車・バイク';
    case 'walk':
      return '徒歩・自転車';
    case 'remote':
      return '在宅多め';
    default:
      return '未設定';
  }
}

function messageAction(label, text) {
  return {
    type: 'action',
    action: { type: 'message', label, text },
  };
}

function extractWakePlace(text) {
  const generic = String(text || '').match(/(?:朝の場所|天気の場所|基準地点|自宅エリア|生活圏|住んでいる場所|住まい)[は:：\s]*([^。\n]{2,40})/);
  if (generic?.[1]) return generic[1].trim();
  const patterns = [
    /([^。\n]{2,24}(?:駅付近|駅周辺|区|市|町|村|バス停付近|バス停周辺))/,
  ];
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function loadSeededPrivateProfiles() {
  const raw = process.env.PRIVATE_PROFILE_SEEDS_JSON || process.env.PRIVATE_PROFILE_SEED_JSON || '';
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .map(normalizeSeededPrivateProfile)
      .filter(Boolean)
      .slice(0, 10);
  } catch (err) {
    console.warn('[private-profile] PRIVATE_PROFILE_SEEDS_JSON parse failed', err?.message || err);
    return [];
  }
}

function normalizeSeededPrivateProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const aliases = uniqueStrings(profile.aliases || [profile.lineName, profile.realName]);
  if (!aliases.length) return null;
  return {
    aliases,
    realName: String(profile.realName || '').trim().slice(0, 40),
    lineName: String(profile.lineName || '').trim().slice(0, 40),
    summaryLines: uniqueStrings(profile.summaryLines || []).slice(0, 10),
    defaultWakePlace: String(profile.defaultWakePlace || '').trim().slice(0, 80),
    commuteMode: String(profile.commuteMode || '').trim().slice(0, 20),
    commuteRouteText: String(profile.commuteRouteText || '').trim().slice(0, 180),
    roadRouteText: String(profile.roadRouteText || '').trim().slice(0, 180),
    preferenceHints: profile.preferenceHints && typeof profile.preferenceHints === 'object'
      ? Object.fromEntries(Object.entries(profile.preferenceHints).map(([key, value]) => [
        String(key).slice(0, 40),
        String(value || '').slice(0, 160),
      ]))
      : {},
  };
}

function pickSeededProfile(candidates = []) {
  const normalized = candidates
    .map(value => normalize(value))
    .filter(Boolean);
  if (!normalized.length) return null;
  return SEEDED_PRIVATE_PROFILES.find(profile => {
    const aliases = (profile.aliases || []).map(normalize);
    return normalized.some(value => aliases.includes(value));
  }) || null;
}

function mergeProfiles(seeded, stored) {
  if (!seeded && !stored) return null;
  return {
    ...(seeded || {}),
    ...(stored || {}),
    aliases: uniqueStrings([...(seeded?.aliases || []), ...(stored?.aliases || [])]),
    summaryLines: uniqueStrings([...(seeded?.summaryLines || []), ...(stored?.summaryLines || [])]).slice(0, 10),
    preferenceHints: {
      ...(seeded?.preferenceHints || {}),
      ...(stored?.preferenceHints || {}),
    },
  };
}

function uniqueStrings(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function compactSentence(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^[-・\s]+/, '')
    .trim()
    .slice(0, 160);
}

function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

module.exports = {
  getResolvedPrivateProfile,
  buildPrivateProfileContextText,
  formatOwnPrivateProfileReply,
  buildProfileAwareHint,
  detectPrivateProfileIntent,
  detectPrivateProfileSetupIntent,
  extractPrivateProfileUpdate,
  savePrivateProfileUpdate,
  savePrivateProfilePatch,
  buildPrivateProfileSetupMenu,
  buildCommuteModeChoiceMessage,
  buildPrivateProfileFieldPrompt,
  buildProfileCompletionPrompt,
  getPrivateProfileNeeds,
  formatCommuteMode,
};
