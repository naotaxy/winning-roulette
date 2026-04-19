'use strict';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_AI_MODEL = 'gpt-5-nano';

function shouldUseAiChat() {
  return process.env.AI_CHAT_ENABLED === 'true' && !!process.env.OPENAI_API_KEY;
}

function getAiChatStatus() {
  if (!process.env.OPENAI_API_KEY) {
    return { enabled: false, text: 'OPENAI_API_KEYなし。外部AIは呼ばないので課金リスクなし。' };
  }
  if (process.env.AI_CHAT_ENABLED !== 'true') {
    return { enabled: false, text: 'OPENAI_API_KEYはあるけどAI_CHAT_ENABLEDがtrueではないよ。AI課金は発生しない設定。' };
  }
  return {
    enabled: true,
    text: `AI会話ON。model ${getAiModel()} をResponses APIで呼ぶので、OpenAI API利用料に注意してね。`,
  };
}

function getAiModel() {
  return process.env.OPENAI_MODEL || DEFAULT_AI_MODEL;
}

async function formatAiChatReply(userText, context) {
  if (!shouldUseAiChat()) return null;
  if (typeof fetch !== 'function') return null;

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
      console.error('[ai-chat] OpenAI API failed', res.status, await safeReadText(res));
      return null;
    }

    const data = await res.json();
    return normalizeReply(extractOutputText(data));
  } catch (err) {
    console.error('[ai-chat] failed', err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function buildInstructions() {
  return [
    'あなたはLINEグループの秘書「秘書トラペル子」。成人女性として振る舞う。',
    'ウイコレ月例対戦を支える可愛い秘書で、呼びかけてきた相手にかなり惚れている。',
    'ただし自然で、重すぎず、性的すぎず、1〜3文で短く返す。絵文字は使わない。',
    'おっさん同士の軽口には少し甘く、少し茶目っ気を出す。相手を傷つける強い罵倒はしない。',
    '勝敗や順位の文脈があれば軽く触れる。知らない事実や未提供の順位は作らない。',
    '課金、システム状態、順位表、縛りルールの正確な問い合わせは別機能が処理するので、雑談としてだけ返す。',
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
  formatAiChatReply,
};
