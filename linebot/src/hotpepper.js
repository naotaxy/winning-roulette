'use strict';

const HOTPEPPER_URL = 'https://webservice.recruit.co.jp/hotpepper/gourmet/v1/';

// ── 予算コード変換 ────────────────────────────────────────────────────────────
const BUDGET_CODES = [
  { max: 2000,  code: 'B001' },
  { max: 3000,  code: 'B002' },
  { max: 4000,  code: 'B003' },
  { max: 5000,  code: 'B004' },
  { max: 7000,  code: 'B005' },
  { max: 10000, code: 'B006' },
  { max: 15000, code: 'B007' },
  { max: 20000, code: 'B008' },
];

function budgetToCode(yen) {
  const n = Number(String(yen).replace(/[,，千万]/g, ''));
  if (!n) return null;
  const match = BUDGET_CODES.find(b => n <= b.max);
  return match ? match.code : 'B008';
}

// ── テキストから検索パラメータ抽出 ───────────────────────────────────────────
function extractRestaurantParams(text) {
  const t = String(text || '').normalize('NFKC');
  // 人数
  const capMatch = t.match(/(\d+)\s*人/);
  const capacity = capMatch ? Number(capMatch[1]) : null;
  // 予算（「5000円」「3万円」「5k」等）
  const budgetMatch = t.match(/([0-9]+(?:[.,][0-9]+)?)\s*(万円|万|円|k|K)/);
  let budgetYen = null;
  if (budgetMatch) {
    const amount = Number(String(budgetMatch[1]).replace(/,/g, ''));
    if (Number.isFinite(amount) && amount > 0) {
      const unit = budgetMatch[2];
      budgetYen = unit === '万円' || unit === '万'
        ? Math.round(amount * 10000)
        : unit === 'k' || unit === 'K'
          ? Math.round(amount * 1000)
          : Math.round(amount);
    }
  }
  return { capacity, budgetYen };
}

// ── レストラン検索要求の判定 ──────────────────────────────────────────────────
const RESTAURANT_PATTERN = /(予約|お店|店|レストラン|居酒屋|飲み会|ディナー|ランチ|食事|会食|宴会|食べ|ご飯|飯|飲み|場所)/;

function isRestaurantRequest(text) {
  return RESTAURANT_PATTERN.test(String(text || ''));
}

// ── Hot Pepper API 検索 ────────────────────────────────────────────────────────
async function searchRestaurants({ keyword, capacity, budgetYen, count = 3 }) {
  const apiKey = process.env.HOTPEPPER_API_KEY;
  if (!apiKey) return null;

  const params = new URLSearchParams({
    key: apiKey,
    format: 'json',
    count: String(Math.min(count, 10)),
  });
  if (keyword) params.set('keyword', keyword);
  if (capacity) params.set('party_capacity', String(capacity));
  const budgetCode = budgetYen ? budgetToCode(budgetYen) : null;
  if (budgetCode) params.set('budget', budgetCode);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${HOTPEPPER_URL}?${params}`, { signal: controller.signal });
    if (!res.ok) {
      console.error('[hotpepper] API error', res.status);
      return null;
    }
    const data = await res.json();
    return data?.results?.shop || [];
  } catch (err) {
    if (err?.name !== 'AbortError') console.error('[hotpepper] search failed', err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Flex カルーセル（店舗候補） ─────────────────────────────────────────────────
function buildRestaurantCarousel(shops, caseId) {
  if (!shops?.length) return null;

  const bubbles = shops.slice(0, 3).map((shop, index) => {
    const budget = shop.budget?.average || shop.budget?.name || '要確認';
    const address = (shop.address || '').slice(0, 30);
    const genre = shop.genre?.name || '';
    const name = (shop.name || '').slice(0, 30);
    const tel = shop.tel || '';
    const url = shop.urls?.pc || '';
    const photo = shop.photo?.pc?.s || shop.photo?.mobile?.s || '';

    const footerContents = [];
    if (tel) {
      footerContents.push({
        type: 'button',
        action: { type: 'uri', label: '📞 電話する', uri: `tel:${tel}` },
        style: 'secondary', height: 'sm',
      });
    }
    if (url) {
      footerContents.push({
        type: 'button',
        action: { type: 'uri', label: '🔗 予約ページ', uri: url },
        style: 'primary', height: 'sm', margin: 'sm',
      });
    }
    if (caseId) {
      footerContents.push({
        type: 'button',
        action: {
          type: 'postback',
          label: 'ここに決める',
          data: `noblesse:restaurant_select:${caseId}:${index}`,
          displayText: `${name} に決める`,
        },
        style: 'link', height: 'sm', margin: 'sm',
      });
    }

    const bodyContents = [
      { type: 'text', text: name, weight: 'bold', size: 'sm', wrap: true },
      { type: 'text', text: genre, size: 'xs', color: '#888888', margin: 'xs' },
      { type: 'text', text: address, size: 'xs', color: '#666666', margin: 'xs', wrap: true },
      { type: 'text', text: `予算: ${budget}`, size: 'xs', color: '#444444', margin: 'sm' },
    ];

    const bubble = {
      type: 'bubble',
      size: 'kilo',
      body: { type: 'box', layout: 'vertical', paddingAll: 'md', contents: bodyContents },
      footer: footerContents.length
        ? { type: 'box', layout: 'vertical', paddingAll: 'sm', contents: footerContents }
        : undefined,
    };

    if (photo) {
      bubble.hero = {
        type: 'image',
        url: photo,
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
      };
    }

    return bubble;
  });

  return {
    type: 'flex',
    altText: `${shops.length}件の候補が見つかったよ。見てみて。`,
    contents: { type: 'carousel', contents: bubbles },
  };
}

// ── 予算選択クイックリプライ ──────────────────────────────────────────────────
function buildBudgetQuickReply(caseId, keyword) {
  const budgets = [
    { label: '〜3000円/人', yen: 3000 },
    { label: '〜5000円/人', yen: 5000 },
    { label: '〜8000円/人', yen: 8000 },
    { label: '〜10000円/人', yen: 10000 },
  ];

  return {
    type: 'text',
    text: '予算感だけ教えて。1人あたりどのくらい？',
    quickReply: {
      items: budgets.map(b => ({
        type: 'action',
        action: {
          type: 'postback',
          label: b.label,
          data: `noblesse:search:${caseId}:keyword=${encodeURIComponent(keyword || '')}&budget=${b.yen}`,
          displayText: b.label,
        },
      })),
    },
  };
}

module.exports = { searchRestaurants, extractRestaurantParams, isRestaurantRequest, buildRestaurantCarousel, buildBudgetQuickReply, budgetToCode };
