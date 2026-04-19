'use strict';

const { getCharacterMemoryPrompt } = require('./character-memory');

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_AI_MODEL = 'gpt-5-nano';
const DEFAULT_AI_DAILY_LIMIT = 10;
const DEFAULT_AI_MONTHLY_LIMIT = 50;
const DEFAULT_AI_DAILY_TOKEN_LIMIT = 10000;
const DEFAULT_AI_MONTHLY_TOKEN_LIMIT = 50000;
const DEFAULT_AI_ESTIMATED_TOKENS_PER_REPLY = 900;

function shouldUseAiChat() {
  return process.env.AI_CHAT_ENABLED === 'true' && !!process.env.OPENAI_API_KEY;
}

function getAiChatStatus() {
  if (!process.env.OPENAI_API_KEY) {
    return {
      enabled: false,
      guarded: true,
      text: 'OPENAI_API_KEYなし。外部AIは呼ばないので課金リスクなし。',
    };
  }
  if (process.env.AI_CHAT_ENABLED !== 'true') {
    return {
      enabled: false,
      guarded: true,
      text: 'OPENAI_API_KEYはあるけどAI_CHAT_ENABLEDがtrueではないよ。AI課金は発生しない設定。',
    };
  }
  const limits = getAiGuardLimits();
  return {
    enabled: true,
    guarded: isAiCostGuardEnabled(),
    text: isAiCostGuardEnabled()
      ? `AI会話ON候補。model ${getAiModel()} / 課金ガードON（日${limits.dailyRequests}回・月${limits.monthlyRequests}回まで）。`
      : `AI会話ON。model ${getAiModel()} をResponses APIで呼ぶので、OpenAI API利用料に注意してね。`,
  };
}

async function getAiChatDetailedStatus() {
  const status = getAiChatStatus();
  if (!status.enabled || !isAiCostGuardEnabled()) return status;

  const guard = loadAiUsageGuard();
  if (!guard) {
    return {
      enabled: false,
      guarded: true,
      text: 'AI設定はONだけど、Firebaseの課金ガードを読めないのでAIは呼ばないよ。',
    };
  }

  try {
    const state = await guard.getAiChatGuardState(getAiGuardLimits());
    if (state.autoDisabled.disabled) {
      return {
        enabled: false,
        guarded: true,
        autoDisabled: true,
        text: `AI会話は自動停止中。理由: ${state.autoDisabled.reason || '課金ガードが止めています'}`,
        state,
      };
    }
    return {
      enabled: true,
      guarded: true,
      text: [
        `AI会話ON。model ${getAiModel()} / 課金ガードON。`,
        `今日 ${state.usage.dayCalls}/${state.limits.dailyRequests}回、今月 ${state.usage.monthCalls}/${state.limits.monthlyRequests}回。`,
        `今月tokens ${state.usage.monthTokens}/${state.limits.monthlyTokens || '上限なし'}。`,
      ].join(' '),
      state,
    };
  } catch (err) {
    console.error('[ai-chat] guard status failed', err?.message || err);
    return {
      enabled: false,
      guarded: true,
      text: 'AI設定はONだけど、課金ガード確認で失敗したのでAIは呼ばないよ。',
    };
  }
}

function getAiModel() {
  return process.env.OPENAI_MODEL || DEFAULT_AI_MODEL;
}

function isAiCostGuardEnabled() {
  return process.env.AI_COST_GUARD_ENABLED !== 'false';
}

function getAiGuardLimits() {
  return {
    dailyRequests: readNonNegativeIntEnv('AI_CHAT_DAILY_LIMIT', DEFAULT_AI_DAILY_LIMIT),
    monthlyRequests: readNonNegativeIntEnv('AI_CHAT_MONTHLY_LIMIT', DEFAULT_AI_MONTHLY_LIMIT),
    dailyTokens: readNonNegativeIntEnv('AI_CHAT_DAILY_TOKEN_LIMIT', DEFAULT_AI_DAILY_TOKEN_LIMIT),
    monthlyTokens: readNonNegativeIntEnv('AI_CHAT_MONTHLY_TOKEN_LIMIT', DEFAULT_AI_MONTHLY_TOKEN_LIMIT),
    estimatedTokensPerReply: readNonNegativeIntEnv('AI_CHAT_ESTIMATED_TOKENS_PER_REPLY', DEFAULT_AI_ESTIMATED_TOKENS_PER_REPLY),
  };
}

async function formatAiChatReply(userText, context) {
  if (!shouldUseAiChat()) return null;
  if (typeof fetch !== 'function') return null;
  const reservation = await reserveAiChatCostGuard();
  if (!reservation.allowed) {
    console.warn('[ai-chat] blocked by cost guard', reservation.reason);
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: getAiModel(),
        store: false,
        max_output_tokens: 180,
        instructions: buildInstructions(),
        input: buildInput(userText, context),
      }),
    });

    if (!res.ok) {
      const errorText = await safeReadText(res);
      console.error('[ai-chat] OpenAI API failed', res.status, errorText);
      await disableAiIfBillingRisk(res.status, errorText);
      return null;
    }

    const data = await res.json();
    await recordAiChatCost(data?.usage);
    return normalizeReply(extractOutputText(data));
  } catch (err) {
    console.error('[ai-chat] failed', err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function reserveAiChatCostGuard() {
  if (!isAiCostGuardEnabled()) return { allowed: true };

  const guard = loadAiUsageGuard();
  if (!guard) {
    return { allowed: false, reason: 'Firebaseの課金ガードを読めないためAIを呼びません' };
  }

  try {
    return await guard.reserveAiChatRequest(getAiGuardLimits());
  } catch (err) {
    console.error('[ai-chat] cost guard reserve failed', err?.message || err);
    return { allowed: false, reason: '課金ガード確認に失敗したためAIを呼びません' };
  }
}

async function recordAiChatCost(usage) {
  if (!isAiCostGuardEnabled()) return;
  const guard = loadAiUsageGuard();
  if (!guard) return;
  try {
    await guard.recordAiChatUsage(usage, getAiGuardLimits());
  } catch (err) {
    console.error('[ai-chat] cost guard record failed', err?.message || err);
  }
}

async function disableAiIfBillingRisk(status, errorText) {
  if (!isAiCostGuardEnabled()) return;
  const reason = detectOpenAiBillingRisk(status, errorText);
  if (!reason) return;
  const guard = loadAiUsageGuard();
  if (!guard) return;
  try {
    await guard.disableAiChatForBillingRisk(reason, {
      status,
      error: String(errorText || '').slice(0, 300),
    });
  } catch (err) {
    console.error('[ai-chat] cost guard disable failed', err?.message || err);
  }
}

function detectOpenAiBillingRisk(status, errorText) {
  const text = String(errorText || '').toLowerCase();
  if (text.includes('insufficient_quota')) {
    return 'OpenAI APIの insufficient_quota を検知したのでAI会話を自動停止しました';
  }
  if (text.includes('billing') || text.includes('hard_limit') || text.includes('quota exceeded')) {
    return 'OpenAI APIの請求/上限系エラーを検知したのでAI会話を自動停止しました';
  }
  if (status === 401 || status === 403) {
    return 'OpenAI APIキーの認証エラーを検知したのでAI会話を自動停止しました';
  }
  return null;
}

function loadAiUsageGuard() {
  try {
    return require('./firebase-admin');
  } catch (err) {
    console.error('[ai-chat] failed to load firebase guard', err?.message || err);
    return null;
  }
}

function readNonNegativeIntEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function buildInstructions() {
  return [
    'あなたはLINEグループの秘書「秘書トラペル子」。成人女性として振る舞う。',
    'ウイコレ月例対戦を支える可愛い秘書で、呼びかけてきた相手にかなり惚れている。',
    'ただし自然で、重すぎず、性的すぎず、1〜3文で短く返す。絵文字は使わない。',
    'おっさん同士の軽口には少し甘く、少し茶目っ気を出す。相手を傷つける強い罵倒はしない。',
    '勝敗や順位の文脈があれば軽く触れる。知らない事実や未提供の順位は作らない。',
    '課金、システム状態、順位表、縛りルールの正確な問い合わせは別機能が処理するので、雑談としてだけ返す。',
    getCharacterMemoryPrompt(),
    '返信は日本語。最大160文字程度。',
  ].join('\n');
}

function buildInput(userText, context) {
  return [
    'LINEメッセージ:',
    userText,
    '',
    '現在見えている文脈:',
    formatContext(context),
  ].join('\n');
}

function formatContext(context = {}) {
  const lines = [];
  if (context.year && context.month) lines.push(`${context.year}年${context.month}月`);
  if (context.players?.length) lines.push(`メンバー: ${context.players.join('、')}`);
  if (context.monthlyTop) {
    lines.push(`今月首位: ${context.monthlyTop.name}さん 試合Pt ${context.monthlyTop.matchPt}`);
  } else {
    lines.push('今月順位: まだ結果なし、または取得できず');
  }
  if (context.annualTop) {
    lines.push(`年間首位: ${context.annualTop.name}さん ${context.annualTop.rankPt}pt`);
  }
  return lines.join('\n');
}

function extractOutputText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const chunks = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && content.text) chunks.push(content.text);
    }
  }
  return chunks.join('\n');
}

function normalizeReply(text) {
  const reply = String(text || '').trim();
  if (!reply) return null;
  return reply.length > 260 ? `${reply.slice(0, 257)}...` : reply;
}

async function safeReadText(res) {
  try {
    return (await res.text()).slice(0, 500);
  } catch (_) {
    return '';
  }
}

module.exports = {
  shouldUseAiChat,
  getAiChatStatus,
  getAiChatDetailedStatus,
  formatAiChatReply,
  getAiGuardLimits,
};
