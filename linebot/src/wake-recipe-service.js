'use strict';

const { getWakeRecipeHistory, saveWakeRecipeHistoryEntry } = require('./firebase-admin');

const TOKUBAI_STORE_URL = process.env.TOKUBAI_STORE_URL || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const HTTP_HEADERS = { 'user-agent': 'traperuko-linebot/1.0' };

const FALLBACK_RECIPES = [
  { title: '鶏むねとほうれん草のバターしょうゆ炒め', summary: '火の通りが早くて、平日の夜でも組みやすい一皿。', priceHint: '1人前めやす 280〜380円', reason: 'たんぱく質と青菜を一度に取りやすい組み合わせ。' },
  { title: '豚こまときのこの生姜炒め', summary: 'ご飯に寄せやすくて、疲れている日でも外しにくい定番。', priceHint: '1人前めやす 320〜420円', reason: '豚こまときのこは価格の波が比較的読みやすい。' },
  { title: 'たまごとベーコンの和風チャーハン', summary: '朝でも夜でも崩れにくい、食べ切りやすい一皿。', priceHint: '1人前めやす 220〜320円', reason: '卵とベーコンがあれば短時間でまとまりやすい。' },
  { title: '鮭ときのこの炊き込みごはん', summary: '少し余裕がある日に向く、満足感の高い一品。', priceHint: '1人前めやす 330〜450円', reason: '魚ときのこで季節感が出しやすい。' },
  { title: '豆腐とひき肉のとろみ丼', summary: '胃に重すぎず、でもちゃんと食べた感じが残る。', priceHint: '1人前めやす 240〜340円', reason: '豆腐で量を出しやすく、ひき肉の使い切りもしやすい。' },
  { title: 'キャベツとソーセージのトマト煮', summary: 'パンにもご飯にも合わせやすい、失敗しにくい鍋もの寄り。', priceHint: '1人前めやす 260〜360円', reason: 'キャベツと加工肉は買いやすく、保存も効く。' },
  { title: '鶏ももとじゃがいもの照り焼き', summary: '少ししっかり食べたい日に向けた、甘辛い主菜。', priceHint: '1人前めやす 340〜440円', reason: '鶏とじゃがいもは満足感が出やすい。' },
  { title: '小松菜と油揚げの卵とじ', summary: '副菜にも主菜にも寄せやすく、夜遅めでも重くなりにくい。', priceHint: '1人前めやす 180〜260円', reason: '青菜と卵を手堅く回せる。' },
  { title: 'えびとブロッコリーの塩炒め', summary: '少しきれいめに食べたい日に向く、軽めの主菜。', priceHint: '1人前めやす 380〜520円', reason: '冷凍えびを使えば手数を増やしすぎずに済む。' },
  { title: '豚バラとなすの味噌炒め', summary: '疲れていても満足感を作りやすい、ご飯寄りの一皿。', priceHint: '1人前めやす 300〜420円', reason: '味噌味でまとまりやすく、なすの消費も早い。' },
];

async function buildWakeRecipeMessage(alarm = {}) {
  const sourceId = String(alarm.sourceId || alarm.userId || '').trim();
  if (!sourceId) return null;

  const weekKey = getTokyoWeekKey(new Date());
  const history = await getWakeRecipeHistory(sourceId, weekKey).catch(() => []);
  const usedTitles = history
    .map(entry => normalizeRecipeTitle(entry?.title))
    .filter(Boolean);

  let recipe = await buildTokubaiRecipeSuggestion(alarm, usedTitles).catch(() => null);
  if (!recipe) {
    recipe = buildFallbackRecipe(alarm, usedTitles);
  }
  if (!recipe) return null;

  await saveWakeRecipeHistoryEntry(sourceId, weekKey, {
    title: recipe.title,
    source: recipe.source,
    summary: recipe.summary,
    priceHint: recipe.priceHint,
  }).catch(() => {});

  return {
    type: 'text',
    text: formatWakeRecipeText(recipe),
  };
}

async function buildTokubaiRecipeSuggestion(alarm, usedTitles = []) {
  if (!TOKUBAI_STORE_URL || !GEMINI_API_KEY || typeof fetch !== 'function') return null;

  const imageUrls = await fetchTokubaiLeafletImageUrls(TOKUBAI_STORE_URL);
  if (!imageUrls.length) return null;

  const images = [];
  for (const url of imageUrls.slice(0, 2)) {
    const image = await fetchImageInlineData(url).catch(() => null);
    if (image) images.push(image);
  }
  if (!images.length) return null;

  const excluded = usedTitles.length ? usedTitles.join(' / ') : 'なし';
  const prompt = [
    'あなたは、朝にそっと提案する生活秘書です。',
    'スーパーのチラシ画像から、今週まだ提案していない節約レシピを1つだけ選んでください。',
    '除外タイトル:',
    excluded,
    '出力はJSONのみ。キーは title, summary, priceHint, reason, mainIngredients。',
    'summary は 60文字以内、priceHint は「1人前めやす 300〜420円」のように。',
    'mainIngredients は文字列配列。',
    '同じタイトルや似た主菜は避けてください。',
  ].join('\n');

  const contents = [
    ...images.map(image => ({ inlineData: image })),
    { text: prompt },
  ];

  const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...HTTP_HEADERS,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: contents }],
      generationConfig: {
        temperature: 0.6,
        responseMimeType: 'application/json',
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(part => part?.text || '').join('\n').trim();
  const parsed = parseJsonRecipe(text);
  if (!parsed?.title) return null;
  if (usedTitles.includes(normalizeRecipeTitle(parsed.title))) return null;
  return {
    title: parsed.title,
    summary: parsed.summary || '',
    priceHint: parsed.priceHint || '1人前めやすはチラシ次第',
    reason: parsed.reason || '',
    mainIngredients: Array.isArray(parsed.mainIngredients) ? parsed.mainIngredients : [],
    source: 'tokubai-gemini',
  };
}

async function fetchTokubaiLeafletImageUrls(storeUrl) {
  const storeHtml = await fetchText(storeUrl);
  const detailUrls = extractTokubaiDetailUrls(storeHtml, storeUrl);
  const images = [];
  for (const detailUrl of detailUrls.slice(0, 3)) {
    const detailHtml = await fetchText(detailUrl).catch(() => '');
    if (!detailHtml) continue;
    const src = extractTokubaiLeafletImageUrl(detailHtml, detailUrl);
    if (src) images.push(src);
  }
  return [...new Set(images)];
}

function extractTokubaiDetailUrls(html, baseUrl) {
  const urls = [];
  const hrefMatches = html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>/g);
  for (const match of hrefMatches) {
    const href = String(match[1] || '').trim();
    if (!href) continue;
    if (!/\/(チラシ|flyer|leaflet|images?)\//.test(href) && !/\/\d{4,}/.test(href)) continue;
    urls.push(new URL(href, baseUrl).toString());
  }
  return [...new Set(urls)];
}

function extractTokubaiLeafletImageUrl(html, baseUrl) {
  const direct = html.match(/<img[^>]+class="[^"]*leaflet[^"]*"[^>]+src="([^"]+)"/i);
  if (direct?.[1]) return new URL(direct[1], baseUrl).toString();
  const generic = html.match(/<img[^>]+src="([^"]+)"[^>]+class="[^"]*leaflet[^"]*"/i);
  if (generic?.[1]) return new URL(generic[1], baseUrl).toString();
  return '';
}

async function fetchImageInlineData(url) {
  const res = await fetch(url, { headers: HTTP_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  const mimeType = res.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await res.arrayBuffer());
  return {
    mimeType,
    data: buffer.toString('base64'),
  };
}

function parseJsonRecipe(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    const fenced = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```([\s\S]*?)```/);
    if (!fenced?.[1]) return null;
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_) {
      return null;
    }
  }
}

function buildFallbackRecipe(alarm, usedTitles = []) {
  const available = FALLBACK_RECIPES.filter(recipe => !usedTitles.includes(normalizeRecipeTitle(recipe.title)));
  const pool = available.length ? available : FALLBACK_RECIPES;
  if (!pool.length) return null;

  const dayIndex = getTokyoWeekdayIndex(new Date());
  const sourceText = [alarm.weatherPlace, alarm.senderName, alarm.realName].filter(Boolean).join(' ');
  const prefersLight = /(東中野|水道橋|平日|仕事)/.test(sourceText);
  const ordered = prefersLight
    ? [...pool].sort((a, b) => scoreRecipeLightness(a) - scoreRecipeLightness(b))
    : pool;
  const chosen = ordered[dayIndex % ordered.length];
  return {
    ...chosen,
    source: 'fallback-weekly',
  };
}

function scoreRecipeLightness(recipe) {
  const text = `${recipe.title} ${recipe.summary}`;
  let score = 0;
  if (/(卵|豆腐|青菜|小松菜|ほうれん草)/.test(text)) score -= 2;
  if (/(炒め|卵とじ|塩)/.test(text)) score -= 1;
  if (/(豚バラ|照り焼き|炊き込み)/.test(text)) score += 2;
  return score;
}

function formatWakeRecipeText(recipe) {
  const lines = [
    recipe.source === 'tokubai-gemini'
      ? '朝のごはん支度まで少し楽になるように、今日はチラシ発想で一皿だけ置いておくね。'
      : '朝のごはん支度まで少し楽になるように、今日は今週まだかぶっていない一皿を置いておくね。',
    `今日のおすすめは「${recipe.title}」。`,
  ];
  if (recipe.summary) lines.push(recipe.summary);
  if (recipe.priceHint) lines.push(recipe.priceHint);
  if (recipe.reason) lines.push(`ひとこと: ${recipe.reason}`);
  if (Array.isArray(recipe.mainIngredients) && recipe.mainIngredients.length) {
    lines.push(`主な食材: ${recipe.mainIngredients.slice(0, 4).join('、')}`);
  }
  return lines.join('\n');
}

async function fetchText(url) {
  const res = await fetch(url, { headers: HTTP_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function getTokyoWeekKey(date = new Date()) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const weekday = jst.getUTCDay() || 7;
  const monday = new Date(jst);
  monday.setUTCDate(jst.getUTCDate() - (weekday - 1));
  const year = monday.getUTCFullYear();
  const month = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const day = String(monday.getUTCDate()).padStart(2, '0');
  return `${year}-W-${month}${day}`;
}

function getTokyoWeekdayIndex(date = new Date()) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const weekday = jst.getUTCDay();
  return weekday === 0 ? 6 : weekday - 1;
}

function normalizeRecipeTitle(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
}

module.exports = {
  buildWakeRecipeMessage,
};
