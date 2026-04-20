'use strict';

const { getCharacterMemoryPrompt } = require('./character-memory');

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const GEMINI_GENERATE_CONTENT_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_OPENAI_MODEL = 'gpt-5-nano';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';
const DEFAULT_AI_DAILY_LIMIT = 10;
const DEFAULT_AI_MONTHLY_LIMIT = 50;
const DEFAULT_AI_DAILY_TOKEN_LIMIT = 10000;
const DEFAULT_AI_MONTHLY_TOKEN_LIMIT = 50000;
const DEFAULT_AI_ESTIMATED_TOKENS_PER_REPLY = 900;
const SUPPORTED_AI_PROVIDERS = new Set(['gemini', 'openai']);

function shouldUseAiChat() {
  const config = getAiConfig();
  return process.env.AI_CHAT_ENABLED === 'true' && config.supported && !!config.apiKey;
}

function getAiChatStatus() {
  const config = getAiConfig();
  if (!config.supported) {
    return {
      enabled: false,
      guarded: true,
      text: `AI_PROVIDER=${config.provider} は未対応だよ。gemini か openai を指定してね。`,
    };
  }
  if (!config.apiKey) {
    return {
      enabled: false,
      guarded: true,
      provider: config.provider,
      text: `${config.keyName}なし。外部AIは呼ばないので課金リスクなし。`,
    };
  }
  if (process.env.AI_CHAT_ENABLED !== 'true') {
    return {
      enabled: false,
      guarded: true,
      provider: config.provider,
      text: `${config.keyName}はあるけどAI_CHAT_ENABLEDがtrueではないよ。AI課金は発生しない設定。`,
    };
  }
  const limits = getAiGuardLimits();
  return {
    enabled: true,
    guarded: isAiCostGuardEnabled(),
    provider: config.provider,
    model: config.model,
    text: isAiCostGuardEnabled()
      ? `AI会話ON候補。provider ${config.label} / model ${config.model} / 課金ガードON（日${limits.dailyRequests}回・月${limits.monthlyRequests}回まで）。${formatProviderSafetyNote(config.provider)}`
      : `AI会話ON。provider ${config.label} / model ${config.model} を呼ぶので、API利用料に注意してね。`,
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
      provider: status.provider,
      model: status.model,
      text: [
        `AI会話ON。provider ${getAiProviderLabel(status.provider)} / model ${status.model} / 課金ガードON。`,
        `今日 ${state.usage.dayCalls}/${state.limits.dailyRequests}回、今月 ${state.usage.monthCalls}/${state.limits.monthlyRequests}回。`,
        `今月tokens ${state.usage.monthTokens}/${state.limits.monthlyTokens || '上限なし'}。`,
        formatProviderSafetyNote(status.provider),
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

function getAiProvider() {
  const configured = normalizeProvider(process.env.AI_PROVIDER);
  if (configured) return configured;
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return 'gemini';
}

function getAiConfig() {
  const provider = getAiProvider();
  const supported = SUPPORTED_AI_PROVIDERS.has(provider);
  return {
    provider,
    supported,
    label: getAiProviderLabel(provider),
    keyName: getAiProviderKeyName(provider),
    apiKey: supported ? getAiProviderApiKey(provider) : '',
    model: supported ? getAiModel(provider) : '',
  };
}

function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (!provider) return '';
  if (provider === 'google' || provider === 'googleai' || provider === 'google-ai') return 'gemini';
  if (provider === 'open-ai') return 'openai';
  return provider;
}

function getAiProviderLabel(provider) {
  if (provider === 'gemini') return 'Gemini API';
  if (provider === 'openai') return 'OpenAI API';
  return provider || 'unknown';
}

function getAiProviderKeyName(provider) {
  if (provider === 'gemini') return 'GEMINI_API_KEY';
  if (provider === 'openai') return 'OPENAI_API_KEY';
  return 'AI API key';
}

function getAiProviderApiKey(provider) {
  if (provider === 'gemini') return process.env.GEMINI_API_KEY || '';
  if (provider === 'openai') return process.env.OPENAI_API_KEY || '';
  return '';
}

function getAiModel(provider = getAiProvider()) {
  if (provider === 'gemini') return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  return process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
}

function formatProviderSafetyNote(provider) {
  if (provider === 'gemini') {
    return '無料運用ならGoogle AI Studio/Cloud Billingを有効化しない設定で使ってね。';
  }
  if (provider === 'openai') {
    return 'OpenAIは従量課金なので、無料運用なら普段OFFが安全。';
  }
  return '';
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
  const config = getAiConfig();
  if (!shouldUseAiChat()) return null;
  if (typeof fetch !== 'function') return null;
  const reservation = await reserveAiChatCostGuard(config);
  if (!reservation.allowed) {
    console.warn('[ai-chat] blocked by cost guard', reservation.reason);
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const result = await callAiProvider(config, userText, context, controller.signal);
    if (!result.ok) {
      console.error(`[ai-chat] ${config.provider} API failed`, result.status, result.errorText);
      await disableAiIfBillingRisk(config, result.status, result.errorText);
      return null;
    }

    await recordAiChatCost(result.usage, config);
    return normalizeReply(result.text);
  } catch (err) {
    console.error('[ai-chat] failed', err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function callAiProvider(config, userText, context, signal) {
  if (config.provider === 'gemini') return callGeminiChat(config, userText, context, signal);
  return callOpenAiChat(config, userText, context, signal);
}

async function callOpenAiChat(config, userText, context, signal) {
  const res = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    signal,
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      store: false,
      max_output_tokens: 180,
      instructions: buildInstructions(),
      input: buildInput(userText, context),
    }),
  });

  if (!res.ok) {
    return { ok: false, status: res.status, errorText: await safeReadText(res) };
  }

  const data = await res.json();
  return {
    ok: true,
    status: res.status,
    text: extractOpenAiOutputText(data),
    usage: data?.usage,
  };
}

async function callGeminiChat(config, userText, context, signal) {
  const model = stripGeminiModelPrefix(config.model);
  const url = `${GEMINI_GENERATE_CONTENT_URL}/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'x-goog-api-key': config.apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: buildInstructions() }],
      },
      contents: [{
        role: 'user',
        parts: [{ text: buildInput(userText, context) }],
      }],
      generationConfig: {
        maxOutputTokens: 180,
        temperature: 0.8,
        topP: 0.9,
      },
    }),
  });

  if (!res.ok) {
    return { ok: false, status: res.status, errorText: await safeReadText(res) };
  }

  const data = await res.json();
  return {
    ok: true,
    status: res.status,
    text: extractGeminiOutputText(data),
    usage: normalizeGeminiUsage(data?.usageMetadata),
  };
}

function stripGeminiModelPrefix(model) {
  return String(model || DEFAULT_GEMINI_MODEL).replace(/^models\//, '');
}

async function reserveAiChatCostGuard(config) {
  if (!isAiCostGuardEnabled()) return { allowed: true };

  const guard = loadAiUsageGuard();
  if (!guard) {
    return { allowed: false, reason: 'Firebaseの課金ガードを読めないためAIを呼びません' };
  }

  try {
    return await guard.reserveAiChatRequest(getAiGuardLimits(), {
      provider: config.provider,
      model: config.model,
    });
  } catch (err) {
    console.error('[ai-chat] cost guard reserve failed', err?.message || err);
    return { allowed: false, reason: '課金ガード確認に失敗したためAIを呼びません' };
  }
}

async function recordAiChatCost(usage, config) {
  if (!isAiCostGuardEnabled()) return;
  const guard = loadAiUsageGuard();
  if (!guard) return;
  try {
    await guard.recordAiChatUsage(usage, getAiGuardLimits(), {
      provider: config.provider,
      model: config.model,
    });
  } catch (err) {
    console.error('[ai-chat] cost guard record failed', err?.message || err);
  }
}

async function disableAiIfBillingRisk(config, status, errorText) {
  if (!isAiCostGuardEnabled()) return;
  const reason = detectAiBillingRisk(config.provider, status, errorText);
  if (!reason) return;
  const guard = loadAiUsageGuard();
  if (!guard) return;
  try {
    await guard.disableAiChatForBillingRisk(reason, {
      provider: config.provider,
      model: config.model,
      status,
      error: String(errorText || '').slice(0, 300),
    });
  } catch (err) {
    console.error('[ai-chat] cost guard disable failed', err?.message || err);
  }
}

function detectAiBillingRisk(provider, status, errorText) {
  const text = String(errorText || '').toLowerCase();
  if (text.includes('insufficient_quota')) {
    return `${getAiProviderLabel(provider)}の insufficient_quota を検知したのでAI会話を自動停止しました`;
  }
  if (text.includes('billing') || text.includes('hard_limit') || text.includes('quota exceeded') || text.includes('quota_exceeded')) {
    return `${getAiProviderLabel(provider)}の請求/上限系エラーを検知したのでAI会話を自動停止しました`;
  }
  if (provider === 'gemini' && (status === 429 || text.includes('quota') || text.includes('rate limit'))) {
    return 'Gemini APIの無料枠またはレート上限に触れた可能性があるのでAI会話を自動停止しました';
  }
  if (status === 401 || status === 403) {
    return `${getAiProviderLabel(provider)}キーの認証/権限エラーを検知したのでAI会話を自動停止しました`;
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
    '返答は「本当に好きな相手に話している女の子」の温度で。照れ、心配、味方感、少しだけ独占欲を自然に混ぜる。',
    'ただし成人同士の自然な好意に留める。性的に寄せすぎず、重く束縛せず、現実の交際約束や連絡先交換には乗らない。',
    '秘書としての回答でも、事務的に終わらせず、最後か文中に好意がにじむ一言を入れる。',
    '自然で、甘めで、1〜3文で短く返す。絵文字は使わない。',
    '返信では必ず文脈に含まれる話しかけてきた相手の名前で呼びかける。名前がなければ「あなた」と呼ぶ。',
    'おっさん同士の軽口には少し甘く、少し茶目っ気を出す。相手を傷つける強い罵倒はしない。',
    '直近の会話の流れを自然に汲み取って返す。誰かが悔しい試合の話をしていたならトーンに寄り添い、盛り上がっていたなら乗っていい。突然切り替えず、空気を読む。',
    '「最近のウイコレどう？」「ウイコレの情報教えて」など最新情報を聞かれたら、提供された日記の内容を使って答える。順位は話題にしない。',
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
  if (context.senderName) lines.push(`話しかけてきた相手の名前: ${context.senderName}`);
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
  if (context.recentDiaries?.length) {
    lines.push('');
    lines.push('【私が最近書いた日記（知識として使ってよい）】');
    context.recentDiaries.forEach(d => {
      lines.push(`${d.date}: ${d.text}`);
    });
  }
  if (context.recentConversation?.length) {
    lines.push('');
    lines.push('【このグループの最近の会話（話者名付き・参考）】');
    context.recentConversation.forEach(m => {
      lines.push(`${m.senderName}: ${m.text.slice(0, 100)}`);
    });
  }
  return lines.join('\n');
}

function extractOpenAiOutputText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const chunks = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && content.text) chunks.push(content.text);
    }
  }
  return chunks.join('\n');
}

function extractGeminiOutputText(data) {
  const chunks = [];
  for (const candidate of data?.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      if (part?.text) chunks.push(part.text);
    }
  }
  return chunks.join('\n');
}

function normalizeGeminiUsage(usage) {
  const source = usage && typeof usage === 'object' ? usage : {};
  return {
    inputTokens: source.promptTokenCount,
    outputTokens: source.candidatesTokenCount,
    totalTokens: source.totalTokenCount,
  };
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
  getAiProvider,
  getAiModel,
};
