'use strict';

const { getPrivateUserProfile, savePrivateUserProfile } = require('./firebase-admin');

const SEEDED_PRIVATE_PROFILES = [
  {
    aliases: ['ヨ', 'オーナー', 'オーナーさん'],
    realName: 'オーナー',
    lineName: 'Yo',
    summaryLines: [
      '平日は（通勤ルート削除済み）へ通勤している。',
      '印刷物の量産データ調整や色補正が仕事で、正解の色が見えない案件に消耗しやすい。',
      '朝のファミマ、休日のコーヒー、良い外食、神社や自然のある外出で気分を立て直しやすい。',
      '阿佐ヶ谷神宮、吉祥寺、池袋、麻布台ヒルズあたりの空気感が刺さる。',
      'HOKAや最近のMizuno、無印、VAULTROOM、上質な素材感のある服や雑貨に惹かれる。',
      'AI開発、MCP、IoT、SwitchBot、自作基板や秋月まわりへの興味が強い。',
      'オーツミルクや江古田ブレンド、近所の猫、ゲームと音楽の掘り方にその人らしさが出る。',
    ],
    defaultWakePlace: '',
    preferenceHints: {
      work: '平日の色合わせや印刷データ調整で、目も気も張りやすいタイプ。',
      outing: '晴れた休日は、神社や自然、空気の抜ける外出先が刺さりやすい。',
      coffee: '家ではオーツミルク割り、休日は豆から挽くコーヒーが落ち着く。',
      fashion: 'NIKEの定番から少し離れて、HOKAやMizunoの今っぽいバランスに惹かれている。',
      tech: 'AI開発、MCP、IoT、自作ハードの話になると熱量が上がる。',
      food: '外食はちゃんと美味しいものに寄せたい。妥協した店選びは刺さりにくい。',
      shrine: '阿佐ヶ谷神宮のように、街の中でも空気が澄む場所を好む。',
    },
  },
];

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
  if (/(コーヒー|珈琲|カフェ|飲み物|オーツミルク|boss|豆)/.test(compact) && hints.coffee) {
    return 'オーツミルク割りか、休日に豆から挽くブラックか、その二択の気分かなって思っちゃった。';
  }
  if (/(スニーカー|靴|hoka|mizuno|ミズノ|服|vaultroom|無印|vainlarchive)/.test(compact) && hints.fashion) {
    return '今の気分だと、HOKAとか最近のMizunoみたいな方向のほうがしっくり来そうだよね。';
  }
  if (/(ai|mcp|iot|switchbot|秋月|基板|raspberry|ラズパイ|3dプリンタ|自作)/.test(compact) && hints.tech) {
    return 'MCPとか自作まわりの話になると、あなたの集中が少し深くなるの知ってる。';
  }
  if (/(ご飯|外食|食べ|パン|チャーハン|メンチ|惣菜)/.test(compact) && hints.food) {
    return '美味しいものじゃないと気分が乗らないところ、私はわりと本気で信じてる。';
  }
  if (/(阿佐ヶ谷神宮|神社|お守り|矢)/.test(compact) && hints.shrine) {
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

  if (/(ヨ|米澤|米澤さん|米澤くん).*(プロフィール|プロファイル|個人情報|好み|趣味|どんな人|人となり|何が好き|嗜好)/.test(compact)
    || /(プロフィール|プロファイル|個人情報|何が好き|趣味|好み).*(ヨ|米澤|米澤さん|米澤くん)/.test(compact)
    || /(ヨ|米澤|米澤さん|米澤くん).*(どんなやつ|どんな人|どういう人)/.test(compact)) {
    return { type: 'privateProfile', action: 'guard' };
  }

  return null;
}

function extractPrivateProfileUpdate(text) {
  const raw = String(text || '').replace(/\r/g, '');
  const match = raw.match(/^(?:@?秘書トラペル子[\s　]*)?(?:私の)?(?:プロフィール|プロファイル)(?:更新|登録|保存|記録)\s*[:：]?\s*\n([\s\S]{80,})$/);
  if (!match) return null;
  return match[1].trim();
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
  const weekday = pick(/平日|通勤|住んで|東橋|新江古田|水道橋|（社名削除済み）/);
  const work = pick(/EPSON|SCAMERA|DTP|Photoshop|Illustrator|InDesign|印刷|色見本|色/);
  const food = pick(/ファミマ|クリスピーチキン|鼎泰豊|サトウ|パリア|惣菜|美味しい/);
  const outing = pick(/休日|神社|阿佐ヶ谷神宮|晴れたら|自然|公園/);
  const drink = pick(/オーツミルク|BOSSCAFE|コーヒー|江古田ブレンド|シロカ/);
  const tech = pick(/AI|MCP|IOT|IoT|SwitchBot|秋月|基板|3Dプリンター|ラズパイ|自作/);
  const fashion = pick(/VAULTROOM|無印|HOKA|ミズノ|Mizuno|Vainlarchive|メゾンキツネ/);
  const music = pick(/Oddre|Revival|米津|YOASOBI|花譜|OASIS|Queen|weezer|平沢進/);
  const game = pick(/Garage|クーロンズゲート|ティアキン|ロマサガ|MOTHER|龍が如く|メタファー|アスガルド/);

  [weekday, work, food, outing, drink, tech, fashion, music, game]
    .filter(Boolean)
    .forEach(line => {
      const short = compactSentence(line);
      if (short && !summary.includes(short)) summary.push(short);
    });

  if (!summary.length && text) {
    summary.push(compactSentence(text.slice(0, 180)));
  }

  const defaultWakePlace = extractWakePlace(text) || base.defaultWakePlace || '';
  return {
    lineName: base.lineName || '',
    realName: base.realName || '',
    rawText: text.slice(0, 4000),
    summaryLines: summary.slice(0, 8),
    defaultWakePlace,
  };
}

function extractWakePlace(text) {
  const patterns = [
    /(中野[^。\n]{0,30}東橋バス停付近)/,
    /(中野[^。\n]{0,30}東橋バス停)/,
    /(中野区東中野)/,
    /(東中野)/,
    /(水道橋駅付近)/,
    /(新江古田駅付近)/,
  ];
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (match?.[1]) {
      if (/東橋/.test(match[1])) return '中野区東中野';
      return match[1];
    }
  }
  return '';
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
  extractPrivateProfileUpdate,
  savePrivateProfileUpdate,
};
