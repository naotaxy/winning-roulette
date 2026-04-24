'use strict';

const RAKUTEN_TRAVEL_URL = 'https://app.rakuten.co.jp/services/api/Travel/SimpleHotelSearch/20170426';

function isHotelRequest(text) {
  return /(ホテル|宿|宿泊|泊まり|泊まる|チェックイン|旅館|リゾート|旅行)/.test(String(text || ''));
}

function extractHotelParams(text) {
  const t = String(text || '');
  const capMatch = t.match(/(\d+)\s*(人|名)/);
  const adultNum = capMatch ? Number(capMatch[1]) : null;
  const nightMatch = t.match(/(\d+)\s*泊/);
  const nights = nightMatch ? Number(nightMatch[1]) : 1;
  const budgetMatch = t.match(/[〜~]?\s*(\d[\d,，]*)\s*(円|k|K)/);
  const maxCharge = budgetMatch ? Number(budgetMatch[1].replace(/[,，]/g, '')) : null;
  return { adultNum, nights, maxCharge };
}

function getDefaultDates(nights = 1) {
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = new Date(new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }));
  const checkout = new Date(today.getTime() + nights * 86400000);
  return { checkinDate: fmt(today), checkoutDate: fmt(checkout) };
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
    return (data?.hotels || []).map(h => h.hotel?.[0]?.hotelBasicInfo).filter(Boolean);
  } catch (err) {
    if (err?.name !== 'AbortError') console.error('[rakuten-travel] search failed', err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function buildHotelCarousel(hotels, caseId) {
  if (!hotels?.length) return null;

  const bubbles = hotels.slice(0, 3).map((hotel, index) => {
    const name = (hotel.hotelName || '').slice(0, 30);
    const address = ((hotel.address1 || '') + (hotel.address2 || '')).slice(0, 30);
    const price = hotel.hotelMinCharge
      ? `${Number(hotel.hotelMinCharge).toLocaleString()}円〜/人`
      : '要確認';
    const review = hotel.reviewAverage ? `★${hotel.reviewAverage}` : '';
    const url = hotel.hotelInformationUrl || '';
    const photo = hotel.hotelImageUrl || '';

    const bodyContents = [
      { type: 'text', text: name, weight: 'bold', size: 'sm', wrap: true },
      { type: 'text', text: address, size: 'xs', color: '#666666', margin: 'xs', wrap: true },
      { type: 'text', text: `料金: ${price}${review ? `  ${review}` : ''}`, size: 'xs', color: '#444444', margin: 'sm' },
    ];

    const footerContents = [];
    if (url) {
      footerContents.push({
        type: 'button',
        action: { type: 'uri', label: '🔗 予約ページ', uri: url },
        style: 'primary', height: 'sm',
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
        style: 'link', height: 'sm', margin: 'sm',
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
    if (photo) {
      bubble.hero = { type: 'image', url: photo, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' };
    }
    return bubble;
  });

  return {
    type: 'flex',
    altText: `${hotels.length}件のホテル候補が見つかったよ。`,
    contents: { type: 'carousel', contents: bubbles },
  };
}

function buildBudgetQuickReplyForHotel(caseId, keyword) {
  const budgets = [
    { label: '〜5000円/人', yen: 5000 },
    { label: '〜8000円/人', yen: 8000 },
    { label: '〜15000円/人', yen: 15000 },
    { label: '〜30000円/人', yen: 30000 },
  ];
  return {
    type: 'text',
    text: '1人あたりの宿泊予算を教えて。',
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

module.exports = { isHotelRequest, extractHotelParams, searchHotels, buildHotelCarousel, buildBudgetQuickReplyForHotel };
