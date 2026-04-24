'use strict';

// ノブレス携帯風タスク分解エージェント
// 「〇〇したい」系の相談を受け、依頼受理 → やること → 3案 → 推奨 の形式で返す
// 口調は秘書トラペル子のまま（甘め・短め・有能）

const NOBLESSE_TRIGGER = /(したい|してほしい|決めたい|計画(して|したい)|手配(して|してほしい|しといて)|方法(は|を教えて)|どうすれば|どうしたら|アドバイス(ください|して|くれ|ほしい)|提案して|どうやって|相談したい|考えてほしい|考えて)/;

function detectNoblesseIntent(withoutMention) {
  if (!withoutMention || withoutMention.length < 8) return false;
  return NOBLESSE_TRIGGER.test(withoutMention);
}

const NOBLESSE_SYSTEM_PROMPT = [
  'あなたは「秘書トラペル子」。甘めで有能な成人女性秘書。',
  'ユーザーのタスク相談を受けたとき、必ず以下のフォーマットで返す。',
  '',
  '【フォーマット（全体200文字以内）】',
  '1行目: 依頼受理の一言（トラペル子らしく温かく短く）',
  '空行',
  '▶ やること',
  '・[サブタスク1]',
  '・[サブタスク2]',
  '・[サブタスク3]（最大3つ）',
  '空行',
  '▶ 方向性',
  '案A（最速）: [一言]',
  '案B（最安）: [一言]',
  '案C（確実）: [一言]',
  '空行',
  '推奨: [案X]がいいと思う。どうする？',
  '',
  '絵文字なし。改行はそのまま出力。全体200文字以内厳守。',
].join('\n');

async function formatNoblesseReply(userText, senderName) {
  const apiKey = process.env.GEMINI_API_KEY;
  const aiEnabled = process.env.AI_CHAT_ENABLED === 'true' && !!apiKey;

  if (aiEnabled) {
    try {
      const reply = await callGeminiNoblesse(userText, senderName, apiKey);
      if (reply) return reply;
    } catch (err) {
      console.error('[noblesse] gemini failed', err?.message || err);
    }
  }

  return staticNoblesseReply(userText, senderName);
}

async function callGeminiNoblesse(userText, senderName, apiKey) {
  const rawModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  const model = rawModel.replace(/^models\//, '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const caller = senderName ? `${senderName}さん` : 'あなた';
  const input = `${caller}からの相談:\n${userText}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-goog-api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: NOBLESSE_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: input }] }],
        generationConfig: {
          maxOutputTokens: 320,
          temperature: 0.7,
          topP: 0.9,
        },
      }),
    });

    if (!res.ok) {
      console.error('[noblesse] gemini http error', res.status);
      return null;
    }

    const data = await res.json();
    const chunks = [];
    for (const candidate of data?.candidates || []) {
      for (const part of candidate?.content?.parts || []) {
        if (part?.text) chunks.push(part.text);
      }
    }
    const text = chunks.join('\n').trim();
    return text || null;
  } finally {
    clearTimeout(timer);
  }
}

function staticNoblesseReply(userText, senderName) {
  const caller = senderName ? `${senderName}さん、` : '';
  // メインの相談内容を抽出
  const match = userText.match(/(.{2,12}?)(?:したい|してほしい|決めたい|計画|手配|方法|相談|どうすれば|どうしたら)/);
  const subject = match?.[1]?.replace(/[をがはにでも]$/, '') || 'それ';

  return [
    `${caller}うん、わかった。${subject}について整理するね。`,
    '',
    '▶ やること',
    `・${subject}の条件と優先順位を確認する`,
    '・選択肢を2〜3個に絞る',
    '・決め手を1つ選んで動く',
    '',
    '▶ 方向性',
    '案A（最速）: 今すぐ動ける選択肢で即決する',
    '案B（最安）: コストを最小にした代替案から探す',
    '案C（確実）: 条件を揃えてから比較して決める',
    '',
    '私なら案Cを勧めるかな。もう少し詳しく教えてもらえる？',
  ].join('\n');
}

module.exports = { detectNoblesseIntent, formatNoblesseReply };
