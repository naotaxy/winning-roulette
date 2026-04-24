'use strict';

const { getMemberProfile, saveMemberProfile, getLineNameRealNames } = require('./firebase-admin');

// ── 実名解決（userId→Firebase profile → lineNameルックアップ → lineName の順） ──
async function resolveRealName(userId, lineName) {
  try {
    if (userId) {
      const profile = await getMemberProfile(userId);
      if (profile?.realName) return profile.realName;
    }
    if (lineName) {
      const map = await getLineNameRealNames();
      if (map[lineName]) return map[lineName];
    }
    return lineName || null;
  } catch (_) {
    return lineName || null;
  }
}

// ── パーソナリティシグナル ────────────────────────────────────────────────────
const PERSONALITY_SIGNALS = [
  { pattern: /(勝った|連勝|完勝|圧勝|きた[ーー!！]+)/, tag: '勝ち試合が多い' },
  { pattern: /(負けた|惨敗|ボコ|やられた|萎えた)/, tag: '試合に苦戦することが多い' },
  { pattern: /(ラグ|重い|バグ|回線|フリーズ)/, tag: 'ラグや回線トラブルを気にする' },
  { pattern: /(煽って|煽り|ふざけ|腹立|ムカつ|キレ)/, tag: '感情的になりやすい・煽り気質' },
  { pattern: /(疲れた|しんどい|眠い|だるい|限界)/, tag: '忙しい・疲れが出やすい' },
  { pattern: /(ありがとう|ありがと|助かる|助かった)/, tag: '礼儀正しい' },
  { pattern: /(強い|天才|神|最強|無敵)/, tag: '自信家' },
  { pattern: /(弱い|下手|ダメ|センスない|もう無理)/, tag: '自己評価が低くなる傾向' },
  { pattern: /(笑|w{2,}|草|ウケ|爆笑)/, tag: '場を和ます・ノリがいい' },
  { pattern: /(真剣|本気|ガチ|絶対|必ず)/, tag: '競争心が強い' },
];

// ── 特定の話者のメッセージのみからタグ抽出（バグ修正：全員混在を防ぐ） ──────
function extractTagsForSender(messages, senderName) {
  const mine = senderName
    ? messages.filter(m => m.senderName === senderName)
    : messages;
  if (!mine.length) return [];
  const text = mine.map(m => String(m.text || '')).join(' ');
  return PERSONALITY_SIGNALS.filter(s => s.pattern.test(text)).map(s => s.tag);
}

function mergeMemo(existingMemo, newTags) {
  if (!newTags.length) return existingMemo || '';
  const existing = String(existingMemo || '');
  const added = newTags.filter(tag => !existing.includes(tag));
  if (!added.length) return existing;
  const combined = existing ? `${existing}。${added.join('。')}` : added.join('。');
  return combined.length > 300 ? combined.slice(-300) : combined;
}

const _lastAutoUpdate = new Map(); // userId → timestamp

// ── グループ全員分プロファイリング（会話ログに userId が入っている前提） ──────
async function updateGroupProfiles(recentMessages) {
  if (!Array.isArray(recentMessages) || !recentMessages.length) return;

  // 話者別にグルーピング（userId が記録されているメッセージのみ対象）
  const bySender = new Map();
  for (const m of recentMessages) {
    const userId = m.userId;
    if (!userId) continue;
    const name = m.senderName || '不明';
    if (!bySender.has(userId)) bySender.set(userId, { name, messages: [] });
    bySender.get(userId).messages.push(m);
  }

  for (const [userId, { name, messages }] of bySender.entries()) {
    const lastTs = _lastAutoUpdate.get(userId) || 0;
    if (Date.now() - lastTs < 60 * 60 * 1000) continue; // 1時間に1回

    const tags = extractTagsForSender(messages, name);
    if (!tags.length) continue;

    _lastAutoUpdate.set(userId, Date.now());
    try {
      const profile = await getMemberProfile(userId) || {};
      const newMemo = mergeMemo(profile.memo, tags);
      if (newMemo === (profile.memo || '')) continue;
      await saveMemberProfile(userId, {
        lineName: name || profile.lineName || '',
        realName: profile.realName || '',
        memo: newMemo,
      });
      console.log(`[member-profile] updated ${name}: ${tags.join(', ')}`);
    } catch (err) {
      console.error('[member-profile] update failed for', name, err?.message || err);
    }
  }
}

// ── Gemini コンテキスト用プロファイル文字列 ─────────────────────────────────
function formatProfileForContext(profile, lineName) {
  if (!profile) return null;
  const name = profile.realName || lineName || '不明';
  const lines = [`本名: ${name}`];
  if (profile.memo) lines.push(`人物メモ: ${profile.memo}`);
  return lines.join('　');
}

module.exports = { resolveRealName, updateGroupProfiles, formatProfileForContext };
