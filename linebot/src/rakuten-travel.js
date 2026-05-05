'use strict';

const { getTokyoDateParts } = require('./date-utils');

const RAKUTEN_TRAVEL_URL = 'https://app.rakuten.co.jp/services/api/Travel/SimpleHotelSearch/20170426';

function isHotelRequest(text) {
  return /(ホテル|宿|宿泊|泊まり|泊まる|チェックイン|旅館|リゾート|旅行)/.test(String(text || ''));
}

function extractHotelParams(text) {
  const t = String(text || '').normalize('NFKC');
  const capMatch = t.match(/(\d+)\s*(人|名)/);
  const adultNum = capMatch ? Number(capMatch[1]) : null;

  const nightMatch = t.match(/(\d+)\s*泊/);
  const explicitNights = nightMatch ? Number(nightMatch[1]) : null;

  const maxCharge = extractBudgetYen(t);
  const stay = extractStayDates(t, explicitNights || 1);

  return {
    adultNum,
    nights: stay.nights || explicitNights || 1,
    maxCharge,
    checkinDate: stay.checkinDate || '',
    checkoutDate: stay.checkoutDate || '',
  };
}

function extractBudgetYen(text) {
  const match = String(text || '').normalize('NFKC').match(/([0-9]+(?:[.,][0-9]+)?)\s*(万円|万|円|k|K)/);
  if (!match) return null;
  const amount = Number(String(match[1]).replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2];
  if (unit === '万円' || unit === '万') return Math.round(amount * 10000);
  if (unit === 'k' || unit === 'K') return Math.round(amount * 1000);
  return Math.round(amount);
}

function extractStayDates(text, fallbackNights = 1) {
  const normalized = String(text || '')
    .normalize('NFKC')
    .replace(/[（(][^)）]*[)）]/g, ' ')
    .replace(/年/g, '/')
    .replace(/月/g, '/')
    .replace(/日/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = [...normalized.matchAll(/(\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2})/g)]
    .map(match => match[1]);
  if (!tokens.length) {
    return { checkinDate: '', checkoutDate: '', nights: fallbackNights || 1 };
  }

  const today = getTokyoDateParts();
  const first = parseDateToken(tokens[0], today);
  const second = parseDateToken(tokens[1], today, first || null);
  if (!first) {
    return { checkinDate: '', checkoutDate: '', nights: fallbackNights || 1 };
  }

  const nights = second ? Math.max(1, daysBetween(first, second)) : Math.max(1, fallbackNights || 1);
  const checkout = second || addDays(first, nights);
  return {
    checkinDate: formatDate(first),
    checkoutDate: formatDate(checkout),
    nights,
  };
}

function parseDateToken(token, baseParts, firstDate = null) {
  if (!token) return null;
  const normalized = String(token).replace(/-/g, '/');
  const parts = normalized.split('/').map(Number);
  if (parts.length === 3) {
    return buildDate(parts[0], parts[1], parts[2]);
  }
  if (parts.length !== 2) return null;

  let year = baseParts?.year || getTokyoDateParts().year;
  const month = parts[0];
  const day = parts[1];

  if (firstDate) {
    const candidate = buildDate(year, month, day);
    if (!candidate) return null;
    if (candidate.getTime() < firstDate.getTime()) {
      return buildDate(year + 1, month, day);
    }
    return candidate;
  }

  if (month < (baseParts?.month || 1) || (month === (baseParts?.month || 1) && day < (baseParts?.day || 1))) {
    year += 1;
  }
  return buildDate(year, month, day);
}

function buildDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function daysBetween(start, end) {
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getDefaultDates(nights = 1) {
  const today = getTokyoDateParts();
  const checkin = buildDate(today.year, today.month, today.day);
  const checkout = addDays(checkin, Math.max(1, nights));
  return { checkinDate: formatDate(checkin), checkoutDate: formatDate(checkout) };
}

async function searchHotels({ keyword, adultNum = 1, checkinDate, checkoutDate, maxCharge, nights = 1, count = 3 }) {
  const apiKey = process.env.RAKUTEN_APP_ID;
  if (!apiKey) return null;

  const dates = getDefaultDates(nights);
  const params = new URLSearchParams({
    applicationId: apiKey,
    format: 'json',
    hits: String(Math.min(count, 10)),
    adultNum: String(adultNum || 1),
    checkinDate: checkinDate || dates.checkinDate,
    checkoutDate: checkoutDate || dates.checkoutDate,
    responseType: 'large',
    hotelThumbnailSize: '3',
    sort: 'standard',
  });
  if (keyword) params.set('keyword', keyword);
  if (maxCharge) params.set('maxCharge', String(maxCharge));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${RAKUTEN_TRAVEL_URL}?${params}`, { signal: controller.signal });
    if (!res.ok) {
      console.error('[rakuten-travel] API error', res.status);
      return null;
    }
    const data = await res.json();
    return (data?.hotels || [])
      .map(entry => flattenHotelEntry(entry?.hotel))
      .filter(Boolean);
  } catch (err) {
    if (err?.name !== 'AbortError') console.error('[rakuten-travel] search failed', err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function flattenHotelEntry(blocks) {
  const merged = {};
  for (const block of blocks || []) {
    if (!block || typeof block !== 'object') continue;
    for (const value of Object.values(block)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(merged, value);
      }
    }
  }
  return merged.hotelNo ? merged : null;
}

function sortHotelsForConcierge(hotels) {
  return (hotels || []).slice().sort((a, b) => {
    const reviewGap = Number(b.reviewAverage || 0) - Number(a.reviewAverage || 0);
    if (reviewGap) return reviewGap;
    const countGap = Number(b.reviewCount || 0) - Number(a.reviewCount || 0);
    if (countGap) return countGap;
    const roomGap = Number(Boolean(b.roomImageUrl || b.roomThumbnailUrl)) - Number(Boolean(a.roomImageUrl || a.roomThumbnailUrl));
    if (roomGap) return roomGap;
    return Number(a.hotelMinCharge || 0) - Number(b.hotelMinCharge || 0);
  });
}

function buildHotelCarousel(hotels, caseId) {
  if (!hotels?.length) return null;

  const bubbles = hotels.slice(0, 3).map((hotel, index) => {
    const name = (hotel.hotelName || '').slice(0, 40);
    const address = ((hotel.address1 || '') + (hotel.address2 || '')).slice(0, 60);
    const price = hotel.hotelMinCharge
      ? `${Number(hotel.hotelMinCharge).toLocaleString()}円〜/人`
      : '要確認';
    const review = hotel.reviewAverage
      ? `総合★${hotel.reviewAverage}${hotel.reviewCount ? ` (${Number(hotel.reviewCount).toLocaleString()}件)` : ''}`
      : '';
    const planUrl = hotel.planListUrl || hotel.hotelInformationUrl || '';
    const reviewUrl = hotel.reviewUrl || '';
    const heroPhoto = hotel.hotelImageUrl || hotel.hotelThumbnailUrl || hotel.roomImageUrl || hotel.roomThumbnailUrl || '';
    const roomPhoto = hotel.roomImageUrl || hotel.roomThumbnailUrl || '';
    const access = trimText(hotel.access || hotel.nearestStation || '', 50);
    const reviewSnippet = trimText(hotel.userReview || hotel.hotelSpecial || '', 70);

    const bodyContents = [
      { type: 'text', text: name, weight: 'bold', size: 'sm', wrap: true },
      { type: 'text', text: address, size: 'xs', color: '#666666', margin: 'xs', wrap: true },
      { type: 'text', text: `料金: ${price}`, size: 'xs', color: '#444444', margin: 'sm', wrap: true },
      ...(review ? [{ type: 'text', text: review, size: 'xs', color: '#444444', margin: 'xs', wrap: true }] : []),
      ...(access ? [{ type: 'text', text: `アクセス: ${access}`, size: 'xs', color: '#555555', margin: 'xs', wrap: true }] : []),
      ...(roomPhoto && roomPhoto !== heroPhoto ? [{
        type: 'image',
        url: roomPhoto,
        size: 'full',
        aspectRatio: '20:9',
        aspectMode: 'cover',
        margin: 'sm',
      }] : []),
      ...(reviewSnippet ? [{ type: 'text', text: reviewSnippet, size: 'xs', color: '#666666', margin: 'sm', wrap: true }] : []),
    ];

    const footerContents = [];
    if (reviewUrl) {
      footerContents.push({
        type: 'button',
        action: { type: 'uri', label: '口コミを見る', uri: reviewUrl },
        style: 'secondary',
        height: 'sm',
      });
    }
    if (planUrl) {
      footerContents.push({
        type: 'button',
        action: { type: 'uri', label: 'プランを見る', uri: planUrl },
        style: 'primary',
        height: 'sm',
        margin: footerContents.length ? 'sm' : undefined,
      });
    }
    if (caseId) {
      footerContents.push({
        type: 'button',
        action: {
          type: 'postback',
          label: 'ここに決める',
          data: `noblesse:hotel_select:${caseId}:${index}`,
          displayText: `${name} に決める`,
        },
        style: 'link',
        height: 'sm',
        margin: 'sm',
      });
    }

    const bubble = {
      type: 'bubble',
      size: 'kilo',
      body: { type: 'box', layout: 'vertical', paddingAll: 'md', contents: bodyContents },
      footer: footerContents.length
        ? { type: 'box', layout: 'vertical', paddingAll: 'sm', contents: footerContents }
        : undefined,
    };
    if (heroPhoto) {
      bubble.hero = {
        type: 'image',
        url: heroPhoto,
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
      };
    }
    return bubble;
  });

  return {
    type: 'flex',
    altText: `${hotels.length}件のホテル候補が見つかったよ。`,
    contents: { type: 'carousel', contents: bubbles },
  };
}

function trimText(text, maxLen) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen)}…` : normalized;
}

function buildBudgetQuickReplyForHotel(caseId, keyword) {
  const budgets = [
    { label: '〜1万円/人', yen: 10000 },
    { label: '〜2万円/人', yen: 20000 },
    { label: '〜3万円/人', yen: 30000 },
    { label: '〜5万円/人', yen: 50000 },
    { label: '〜8万円/人', yen: 80000 },
    { label: '〜10万円/人', yen: 100000 },
  ];
  return {
    type: 'text',
    text: '1人あたりの宿泊予算を教えて。海外寄りの相談でも回しやすいように10万円/人まで選べるよ。',
    quickReply: {
      items: budgets.map(b => ({
        type: 'action',
        action: {
          type: 'postback',
          label: b.label,
          data: `noblesse:hotel_search:${caseId}:keyword=${encodeURIComponent(keyword || '')}&budget=${b.yen}`,
          displayText: b.label,
        },
      })),
    },
  };
}

module.exports = {
  isHotelRequest,
  extractHotelParams,
  searchHotels,
  sortHotelsForConcierge,
  buildHotelCarousel,
  buildBudgetQuickReplyForHotel,
};
