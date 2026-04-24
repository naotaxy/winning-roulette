'use strict';

// メンバープロファイル管理
// Firebase config/memberProfiles/{userId} に保存
// {realName, lineName, memo, updatedAt}

const { getMemberProfile, saveMemberProfile } = require('./firebase-admin');

// ── 実名解決 ────────────────────────────────────────────────────────────────
async function resolveRealName(userId, lineName) {
  if (!userId) return lineName || null;
  try {
    const profile = await getMemberProfile(userId);
    return profile?.realName || lineName || null;
  } catch (_) {
    return lineName || null;
  }
}

// ── 会話からヒューリスティックでメモを生成 ────────────────────────────────
const PERSONALITY_SIGNALS = [
  { pattern: /(勝った|連勝|完勝|圧勝|きた[ーーー!！]+)/, tag: '勝ち試合が続いている' },
  { pattern: /(負けた|惨敗|ボコ|やられた|萎えた)/, tag: '試合に苦戦することが多い' },
  { pattern: /(ラグ|重い|バグ|回線|フリーズ)/, tag: 'ラグや回線トラブルを気にする' },
  { pattern: /(煽って|煽り|ふざけ|腹立|ムカつ|キレ)/, tag: '感情的になりやすい・煽り気質' },
  { pattern: /(疲れた|しんどい|眠い|だるい|限界)/, tag: '忙しい・疲れが出やすい' },
  { pattern: /(ありがとう|ありがと|助かる|助かった)/, tag: '礼儀正しい' },
  { pattern: /(強い|天才|神|最強|無敵)/, tag: '自信家' },
  { pattern: /(弱い|下手|ダメ|センスない|もう無理)/, tag: '自己評価が低くなる傾向' },
];

function extractNewTags(messages) {
  const combinedText = messages.map(m => String(m.text || '')).join(' ');
  const found = [];
  for (const sig of PERSONALITY_SIGNALS) {
    if (sig.pattern.test(combinedText)) found.push(sig.tag);
  }
  return found;
}

function mergeMemo(existingMemo, newTags) {
  if (!newTags.length) return existingMemo || '';
  const existing = String(existingMemo || '');
  const added = newTags.filter(tag => !existing.includes(tag));
  if (!added.length) return existing;
  const combined = existing ? `${existing}。${added.join('。')}` : added.join('。');
  // メモが長くなりすぎたら後半を切る
  return combined.length > 300 ? combined.slice(-300) : combined;
}

// ── 非同期でメモ自動更新（fire-and-forget 用） ─────────────────────────────
const _lastAutoUpdate = new Map(); // userId → Date

async function autoUpdateMemo(userId, lineName, recentMessages) {
  if (!userId || !Array.isArray(recentMessages) || !recentMessages.length) return;

  // 同一ユーザーは1時間に1回だけ更新
  const lastTs = _lastAutoUpdate.get(userId) || 0;
  if (Date.now() - lastTs < 60 * 60 * 1000) return;
  _lastAutoUpdate.set(userId, Date.now());

  try {
    const newTags = extractNewTags(recentMessages);
    if (!newTags.length) return;

    const profile = await getMemberProfile(userId) || {};
    const newMemo = mergeMemo(profile.memo, newTags);
    if (newMemo === (profile.memo || '')) return;

    await saveMemberProfile(userId, {
      lineName: lineName || profile.lineName || '',
      realName: profile.realName || '',
      memo: newMemo,
    });
    console.log(`[member-profile] memo updated for ${lineName || userId}: ${newTags.join(', ')}`);
  } catch (err) {
    console.error('[member-profile] autoUpdateMemo failed', err?.message || err);
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

module.exports = { resolveRealName, autoUpdateMemo, formatProfileForContext };
