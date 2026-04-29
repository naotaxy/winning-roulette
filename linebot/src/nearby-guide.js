'use strict';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const HTTP_HEADERS = {
  'Content-Type': 'text/plain; charset=UTF-8',
  'User-Agent': 'traperuko-linebot/1.0 (+https://qiita.com/meisaitokei/items/5857bbb2b5a96b52341c)',
};

const CATEGORY_CONFIG = {
  bread: {
    label: '美味しいパン',
    mapKeyword: 'パン屋',
    radiusMeters: 1800,
    searchCaveat: '口コミ点そのものは持っていないから、店名がはっきりしていて営業時間や導線を追いやすい候補を先に出してるよ。',
    fallbackQueries: ['パン屋', 'ベーカリー'],
    filters: [
      '[shop="bakery"]',
      '[name~"パン|ベーカリー|BAKERY|ブーランジェリー",i]',
    ],
  },
  apparel: {
    label: '評判のアパレル',
    mapKeyword: 'アパレル セレクトショップ 古着',
    radiusMeters: 2200,
    searchCaveat: 'レビュー点そのものは持っていないから、情報量が多くて比べやすい服屋・セレクトショップを優先してるよ。',
    fallbackQueries: ['セレクトショップ', '古着'],
    filters: [
      '[shop="clothes"]',
      '[shop="fashion"]',
      '[shop="second_hand"]',
      "[name~\"アパレル|服|洋服|古着|セレクトショップ|BEAMS|UNITED ARROWS|URBAN RESEARCH|JOURNAL STANDARD|無印|UNIQLO|ユニクロ\",i]",
    ],
  },
  tableware: {
    label: '評判の器や道具',
    mapKeyword: '食器 器',
    radiusMeters: 2400,
    searchCaveat: '商品レビューの点数までは持っていないから、器や道具に寄った店を先に出してるよ。',
    fallbackQueries: ['食器', 'うつわ'],
    filters: [
      '[shop="houseware"]',
      '[shop="gift"]',
      '[name~"器|うつわ|食器|道具|キッチン|pottery",i]',
    ],
  },
  sale: {
    label: '今お得に寄りやすい店',
    mapKeyword: 'セール アウトレット ディスカウント',
    radiusMeters: 2600,
    searchCaveat: 'リアルタイムの「今セール中」までは取れないから、値引きに当たりやすい店やセール告知を見つけやすい店を優先したよ。',
    fallbackQueries: ['ドン・キホーテ', 'セカンドストリート', 'ブックオフ'],
    filters: [
      '[shop~"^(discount|outlet|second_hand|variety_store|warehouse)$"]',
      '[name~"アウトレット|ドン・キホーテ|ドンキ|オフハウス|ハードオフ|セカンドストリート|2nd STREET|トレジャーファクトリー|BOOKOFF|ブックオフ",i]',
    ],
  },
  shopping: {
    label: '評判を追いやすい店',
    mapKeyword: 'ショッピング',
    radiusMeters: 2600,
    searchCaveat: '商品ごとの評判点は持っていないから、情報量が多くて外しにくい店や商業施設を先に出してるよ。',
    fallbackQueries: ['ロフト', '無印良品', 'パルコ'],
    filters: [
      '[shop~"^(department_store|mall|gift|variety_store|houseware|shoes)$"]',
      '[name~"百貨店|PARCO|ルミネ|アトレ|マルイ|Loft|ロフト|無印|ハンズ|東急ハンズ",i]',
    ],
  },
};

function detectNearbyIntent(text) {
  const normalized = normalize(text);
  if (!normalized) return null;

  const hasNearbyHint = /(近く|近場|近辺|このへん|この辺|周辺|今ここ|現在地|この近辺|この近く)/.test(normalized);
  const category = detectNearbyCategory(normalized);
  if (!category) return null;
  if (!hasNearbyHint && !/(探し|ある|売ってる|買える|寄りたい|見たい|行きたい)/.test(normalized)) return null;

  return {
    type: 'nearby',
    category,
    label: CATEGORY_CONFIG[category]?.label || '近くの候補',
  };
}

function detectNearbyCategory(normalized) {
  if (/(パン|ベーカリー|クロワッサン|バゲット|食パン)/.test(normalized)) return 'bread';
  if (/(セール|値引|割引|安い店|アウトレット|ドンキ|掘り出し物|安売り)/.test(normalized)) return 'sale';
  if (/(アパレル|服|洋服|古着|セレクトショップ|ファッション|スウェット|ジャケット|パンツ|シャツ|スニーカー|靴|シューズ)/.test(normalized)) return 'apparel';
  if (/(器|うつわ|食器|皿|マグ|茶碗|鉢|プレート|花瓶|キッチン道具|料理の器)/.test(normalized)) return 'tableware';
  if (/(評判の商品|人気の商品|良いもの|雑貨|ギフト|買い物|ショッピング|評判の店|いい店)/.test(normalized)) return 'shopping';
  return null;
}

function buildNearbyLocationPrompt(intent, latestLocation = null) {
  const label = intent?.label || '近くの候補';
  const hasRecentLocation = !!latestLocation?.latitude && !!latestLocation?.longitude;
  return {
    type: 'text',
    text: hasRecentLocation
      ? `${label}を探すなら、今いる場所をもう一回送ってくれると精度が上がるよ。最新の位置をもらえたら、近場でちゃんと絞るね。`
      : `${label}を探すね。位置情報を送ってくれたら、今いる場所の近くで候補をまとめるよ。`,
    quickReply: {
      items: [
        {
          type: 'action',
          action: {
            type: 'location',
            label: '位置情報を送る',
          },
        },
      ],
    },
  };
}

function formatLocationStoredReply(location) {
  const place = location?.label || location?.address || 'その場所';
  return [
    `${place} を受け取ったよ。`,
    'この近くで探したい時は「近くのパン」「近くのアパレル」「近くの器」「近くのセール」みたいに言ってね。',
  ].join('\n');
}

async function findNearbyPlaces({ latitude, longitude, category }) {
  const config = CATEGORY_CONFIG[category] || CATEGORY_CONFIG.shopping;
  const [areaLabel, rawItems] = await Promise.all([
    reverseGeocodeLabel(latitude, longitude),
    queryNearbyOverpass(latitude, longitude, config),
  ]);

  let items = rankNearbyItems(rawItems, category, { latitude, longitude }).slice(0, 3);
  if (!items.length) {
    const fallback = await searchFallbackPlaces(areaLabel, config, category, { latitude, longitude });
    items = rankNearbyItems(fallback, category, { latitude, longitude }).slice(0, 3);
  }
  return {
    category,
    label: config.label,
    areaLabel,
    items,
    caveat: config.searchCaveat,
    fallbackMapUrl: buildMapSearchUrl(areaLabel, config.mapKeyword),
  };
}

function formatNearbyReply(result) {
  const area = result?.areaLabel || 'このあたり';
  const items = Array.isArray(result?.items) ? result.items : [];
  if (!items.length) {
    return [
      `${area} の近くで ${result?.label || '候補'} を絞り切れなかったの。`,
      'もう少し広い地名で聞いてくれるか、位置情報を送り直してくれたらもう一回探せるよ。',
      result?.fallbackMapUrl ? `地図で広めに見る: ${result.fallbackMapUrl}` : '',
    ].filter(Boolean).join('\n');
  }

  const lines = [`${area} の近くで ${result.label} を探しやすい候補をまとめたよ。`];
  items.forEach((item, index) => {
    lines.push('');
    lines.push(`${index + 1}. ${item.name} (${formatDistance(item.distanceMeters)})`);
    if (item.address) lines.push(item.address);
    if (item.reason) lines.push(item.reason);
    lines.push(`地図: ${item.mapUrl}`);
  });
  if (result.caveat) {
    lines.push('');
    lines.push(result.caveat);
  }
  if (result.fallbackMapUrl) {
    lines.push(`もっと広く見る: ${result.fallbackMapUrl}`);
  }
  return lines.join('\n');
}

async function reverseGeocodeLabel(latitude, longitude) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const params = new URLSearchParams({
      format: 'jsonv2',
      lat: String(latitude),
      lon: String(longitude),
      zoom: '16',
      'accept-language': 'ja',
    });
    const res = await fetch(`${NOMINATIM_REVERSE_URL}?${params}`, {
      headers: { 'User-Agent': HTTP_HEADERS['User-Agent'] },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    const address = json?.address || {};
    return [
      address.suburb,
      address.city_district,
      address.city,
      address.town,
      address.village,
      address.municipality,
    ].find(Boolean) || json?.display_name?.split(',')[0] || null;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function searchFallbackPlaces(areaLabel, config, category, origin) {
  const queries = Array.isArray(config?.fallbackQueries) ? config.fallbackQueries.slice(0, 2) : [];
  const collected = [];
  for (const keyword of queries) {
    const item = await searchNominatimPlace(areaLabel, keyword, category, origin);
    if (item) collected.push(item);
  }
  return collected;
}

async function searchNominatimPlace(areaLabel, keyword, category, origin) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const params = new URLSearchParams({
      q: [areaLabel, keyword].filter(Boolean).join(' '),
      format: 'jsonv2',
      limit: '1',
      'accept-language': 'ja',
    });
    const res = await fetch(`${NOMINATIM_SEARCH_URL}?${params}`, {
      headers: { 'User-Agent': HTTP_HEADERS['User-Agent'] },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    const first = Array.isArray(json) ? json[0] : null;
    if (!first?.lat || !first?.lon) return null;
    return {
      tags: {
        name: first.display_name?.split(',')[0] || keyword,
      },
      lat: Number(first.lat),
      lon: Number(first.lon),
      display_name: first.display_name,
      fallbackCategory: category,
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function queryNearbyOverpass(latitude, longitude, config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    const clauses = config.filters
      .map(filter => `nwr${filter}(around:${config.radiusMeters},${latitude},${longitude});`)
      .join('');
    const query = `[out:json][timeout:12];(${clauses});out center 30;`;
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: HTTP_HEADERS,
      body: query,
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error('[nearby-guide] overpass error', res.status);
      return [];
    }
    const json = await res.json();
    return Array.isArray(json?.elements) ? json.elements : [];
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error('[nearby-guide] overpass failed', err?.message || err);
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function rankNearbyItems(elements, category, origin) {
  const seen = new Set();
  return elements
    .map(element => toNearbyItem(element, category, origin))
    .filter(Boolean)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.distanceMeters - b.distanceMeters;
    })
    .filter(item => {
      const key = `${item.name}:${item.address || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function toNearbyItem(element, category, origin) {
  const tags = element?.tags || {};
  const name = cleanName(tags.name);
  const latitude = Number(element?.lat ?? element?.center?.lat);
  const longitude = Number(element?.lon ?? element?.center?.lon);
  if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const distanceMeters = Math.round(distanceBetween(origin.latitude, origin.longitude, latitude, longitude));
  const address = formatAddress(tags) || cleanFallbackAddress(element?.display_name, name);
  const mapUrl = buildCoordinateMapUrl(latitude, longitude, name);
  const score = scoreNearbyItem(category, tags, name, distanceMeters);
  return {
    name,
    address,
    distanceMeters,
    mapUrl,
    score,
    reason: buildNearbyReason(category, tags, distanceMeters),
  };
}

function scoreNearbyItem(category, tags, name, distanceMeters) {
  let score = 0;
  if (tags.website) score += 3;
  if (tags.opening_hours) score += 2;
  if (tags.phone) score += 1;
  if (tags.brand) score += 1;

  if (distanceMeters <= 350) score += 4;
  else if (distanceMeters <= 700) score += 3;
  else if (distanceMeters <= 1200) score += 2;
  else if (distanceMeters <= 1800) score += 1;

  if (category === 'bread') {
    if (tags.shop === 'bakery') score += 5;
    if (/スーパー|コンビニ|セブン|ファミマ|ローソン|まいばすけっと/i.test(name)) score -= 5;
  }
  if (category === 'sale') {
    if (tags.shop === 'discount' || tags.shop === 'outlet' || tags.shop === 'second_hand') score += 5;
    if (/アウトレット|ドン・キホーテ|ドンキ|オフハウス|ハードオフ|セカンドストリート|2nd STREET|トレジャーファクトリー|BOOKOFF/i.test(name)) score += 4;
  }
  if (category === 'apparel') {
    if (tags.shop === 'clothes' || tags.shop === 'fashion' || tags.shop === 'second_hand') score += 4;
    if (/BEAMS|UNITED ARROWS|URBAN RESEARCH|JOURNAL STANDARD|古着|セレクト|無印|UNIQLO|ユニクロ/i.test(name)) score += 3;
  }
  if (category === 'tableware') {
    if (tags.shop === 'houseware' || tags.shop === 'gift') score += 4;
    if (/器|うつわ|食器|道具|pottery/i.test(name)) score += 3;
  }
  if (category === 'shopping') {
    if (/百貨店|PARCO|ルミネ|アトレ|マルイ|Loft|ロフト|ハンズ/i.test(name)) score += 4;
  }

  return score;
}

function buildNearbyReason(category, tags, distanceMeters) {
  const distanceLabel = formatDistance(distanceMeters);
  if (category === 'bread') {
    return `${distanceLabel}。パン屋として載っていて、寄り道しやすい候補。`;
  }
  if (category === 'sale') {
    return `${distanceLabel}。値引きに当たりやすい店種を優先してるよ。`;
  }
  if (category === 'tableware') {
    return `${distanceLabel}。器や道具に寄った店として見つけやすい候補。`;
  }
  if (category === 'apparel') {
    return `${distanceLabel}。服や小物を比べやすいアパレル寄りの候補。`;
  }
  return `${distanceLabel}。評判を追いやすい店として見つけたよ。`;
}

function formatDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 1) return 'すぐ近く';
  if (distanceMeters < 1000) return `約${distanceMeters}m`;
  return `約${(distanceMeters / 1000).toFixed(1)}km`;
}

function formatAddress(tags) {
  const parts = [
    tags['addr:city'],
    tags['addr:suburb'],
    tags['addr:street'],
    tags['addr:housenumber'],
  ].filter(Boolean);
  return parts.join(' ');
}

function cleanFallbackAddress(displayName, name) {
  const raw = String(displayName || '').trim();
  if (!raw) return '';
  const parts = raw.split(',').map(part => part.trim()).filter(Boolean);
  if (parts[0] === name) parts.shift();
  return parts.slice(0, 3).join(' ');
}

function buildMapSearchUrl(areaLabel, keyword) {
  const query = [areaLabel, keyword].filter(Boolean).join(' ');
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function buildCoordinateMapUrl(latitude, longitude, name) {
  const query = `${latitude},${longitude} ${name || ''}`.trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function distanceBetween(lat1, lon1, lat2, lon2) {
  const toRad = value => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function cleanName(value) {
  return String(value || '').trim().slice(0, 80);
}

function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  detectNearbyIntent,
  buildNearbyLocationPrompt,
  formatLocationStoredReply,
  findNearbyPlaces,
  formatNearbyReply,
};
