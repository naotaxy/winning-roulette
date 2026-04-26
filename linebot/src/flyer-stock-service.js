'use strict';

const {
  getFlyerStockSnapshot,
  saveFlyerStockSnapshot,
} = require('./firebase-admin');
const { getTokyoDateParts } = require('./date-utils');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const TOKUBAI_SEARCH_URL = 'https://tokubai.co.jp/search';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const HTTP_HEADERS = {
  'User-Agent': 'traperuko-linebot/1.0',
};

const FALLBACK_RECIPE_LIBRARY = [
  {
    title: '豚こまと小松菜の卵とじ',
    summary: '青菜と卵でまとまりやすい、平日に寄せやすい一皿。',
    servings: '2人前',
    estimatedTotalPrice: '約420円',
    ingredients: [
      { name: '豚こま切れ', amount: '160', unit: 'g', countText: '1パック想定', estimatedPriceText: '約220円', sourcePriceText: '特売価格に合わせて調整' },
      { name: '小松菜', amount: '1', unit: '束', countText: '1束', estimatedPriceText: '約100円', sourcePriceText: '特売価格に合わせて調整' },
      { name: '卵', amount: '2', unit: '個', countText: '2個', estimatedPriceText: '約80円', sourcePriceText: '特売価格に合わせて調整' },
    ],
    steps: [
      '小松菜は4cm幅、豚こまは食べやすく切る。',
      'フライパンで豚こまを炒め、色が変わったら小松菜を入れる。',
      'しょうゆ・みりん各小さじ2で軽く味を入れ、溶き卵を回しかける。',
      '半熟で火を止めて、ご飯にのせるかそのまま盛る。',
    ],
    reason: '卵と青菜を一緒に使うと、朝に見ても夜の段取りが想像しやすい。',
  },
  {
    title: '鶏むねときのこのバターしょうゆ炒め',
    summary: '火の通りが早く、疲れている日でも組みやすい定番。',
    servings: '2人前',
    estimatedTotalPrice: '約460円',
    ingredients: [
      { name: '鶏むね肉', amount: '220', unit: 'g', countText: '1枚', estimatedPriceText: '約260円', sourcePriceText: '特売価格に合わせて調整' },
      { name: 'きのこ', amount: '1', unit: 'パック', countText: '1パック', estimatedPriceText: '約120円', sourcePriceText: '特売価格に合わせて調整' },
      { name: 'ほうれん草', amount: '0.5', unit: '束', countText: '1/2束', estimatedPriceText: '約80円', sourcePriceText: '特売価格に合わせて調整' },
    ],
    steps: [
      '鶏むね肉はそぎ切りにして軽く塩を振る。',
      'フライパンで鶏肉を焼き、きのこを加えてしんなりさせる。',
      'ほうれん草を加え、バター10gとしょうゆ小さじ2でまとめる。',
      '汁気が軽く飛んだら皿に盛る。',
    ],
    reason: '鶏むねと青菜は価格の波を受けにくく、組み合わせやすい。',
  },
];

function detectFlyerStockIntent(text) {
  const normalized = normalize(text);
  if (!normalized) return null;

  const hasFlyerWord = /(チラシ|特売|広告掲載商品|価格リスト|広告商品|特売商品|食材リスト|買い物メモ|特売ストック|今日の買い物|安い食材)/.test(normalized);
  if (!hasFlyerWord) return null;

  if (/(レシピ|料理|何作|なにつく|献立|晩ご飯|夕飯|何が作|何つく|何作れ)/.test(normalized)) {
    return { type: 'flyerStock', action: 'recipe' };
  }
  return { type: 'flyerStock', action: 'list' };
}

function buildFlyerLocationPrompt(intent = {}, latestLocation = null) {
  const hasRecentLocation = !!latestLocation?.latitude && !!latestLocation?.longitude;
  return {
    type: 'text',
    text: hasRecentLocation
      ? '近くの特売をちゃんと絞るなら、位置情報をもう一回もらえると精度が上がるよ。送り直してくれたら、近いお店から広告掲載商品と価格を拾ってくるね。'
      : '近くのお店の広告掲載商品と価格を探すね。位置情報を送ってくれたら、近いお店から特売情報を拾って整えるよ。',
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

async function getNearbyFlyerSnapshot({ sourceId, latitude, longitude, locationLabel = '', forceRefresh = false } = {}) {
  const dayKey = getTokyoDayKey();
  const requestedLatitude = Number(latitude);
  const requestedLongitude = Number(longitude);
  if (!forceRefresh && sourceId) {
    const cached = await getFlyerStockSnapshot(sourceId, dayKey).catch(() => null);
    if (
      cached?.store?.url
      && Array.isArray(cached?.items)
      && cached.items.length
      && shouldReuseCachedSnapshot(cached, requestedLatitude, requestedLongitude)
    ) {
      return cached;
    }
  }

  if (!Number.isFinite(requestedLatitude) || !Number.isFinite(requestedLongitude)) return null;

  // OSM とエリア直接検索を並列実行（OSM は閉店・改名が反映されないことがあるためエリア検索で補う）
  const [nearbyStores, areaDirectStores] = await Promise.all([
    queryNearbySupermarkets(requestedLatitude, requestedLongitude),
    searchTokubaiStoresByArea(locationLabel),
  ]);

  // OSM 店ごとに Tokubai URL を並列検索
  const osmResults = await Promise.allSettled(
    nearbyStores.slice(0, 5).map(async nearbyStore => {
      const tokubaiStore = await findTokubaiStoreForCandidate(nearbyStore, locationLabel).catch(() => null);
      if (!tokubaiStore?.url) return null;
      return { tokubaiStore, nearbyStore };
    })
  );

  // フェッチ対象を統合（OSM マッチ優先、エリア直接は URL 重複除去して追加）
  const seenUrls = new Set();
  const fetchTargets = [];
  for (const r of osmResults) {
    if (r.status === 'fulfilled' && r.value) {
      const { tokubaiStore, nearbyStore } = r.value;
      if (!seenUrls.has(tokubaiStore.url)) {
        seenUrls.add(tokubaiStore.url);
        fetchTargets.push({ tokubaiStore, nearbyStore });
      }
    }
  }
  for (const areaStore of areaDirectStores) {
    if (!seenUrls.has(areaStore.url)) {
      seenUrls.add(areaStore.url);
      fetchTargets.push({ tokubaiStore: areaStore, nearbyStore: { distanceMeters: null } });
    }
  }

  // チラシ価格を並列取得（最大 7 店）
  const settled = await Promise.allSettled(
    fetchTargets.slice(0, 7).map(({ tokubaiStore, nearbyStore }) =>
      fetchTokubaiStoreSnapshot(tokubaiStore, nearbyStore).catch(() => null)
    )
  );
  const enriched = settled
    .filter(r => r.status === 'fulfilled' && r.value?.items?.length)
    .map(r => r.value);

  if (!enriched.length) {
    // チラシ情報なし: 既知の店名・距離だけで partial snapshot を返す（キャッシュしない）
    const allKnown = [
      ...nearbyStores.slice(0, 3),
      ...areaDirectStores.slice(0, 3).map(s => ({ name: s.name, address: s.address, distanceMeters: null })),
    ];
    if (!allKnown.length) return null;
    const [main, ...rest] = allKnown.slice(0, 3);
    return {
      source: 'overpass-only',
      dayKey,
      locationLabel,
      queryLocation: { latitude: requestedLatitude, longitude: requestedLongitude, label: locationLabel || '' },
      store: { name: main.name, address: main.address, distanceMeters: main.distanceMeters ?? null, url: null },
      items: [],
      competitors: rest.map(s => ({ name: s.name, distanceMeters: s.distanceMeters ?? null, url: null, avgItemPrice: null })),
      fetchedAt: Date.now(),
      fetchedAtIso: new Date().toISOString(),
    };
  }

  // 距離 null（エリア直接店）は距離あり店の後ろに回し、上位 3 店から最安値を選ぶ
  enriched.sort((a, b) => (a.store.distanceMeters ?? Infinity) - (b.store.distanceMeters ?? Infinity));
  const top3 = enriched.slice(0, 3);
  const chosen = pickCheapestStore(top3);
  const competitors = top3
    .filter(s => s.store.url !== chosen.store.url)
    .map(c => ({
      name: c.store.name,
      distanceMeters: c.store.distanceMeters,
      url: c.store.url,
      avgItemPrice: computeAvgItemPrice(c.items),
    }));

  const payload = {
    source: chosen.source || 'tokubai-html',
    dayKey,
    locationLabel,
    queryLocation: {
      latitude: requestedLatitude,
      longitude: requestedLongitude,
      label: locationLabel || '',
    },
    store: chosen.store,
    items: chosen.items.slice(0, 18),
    competitors,
    fetchedAt: Date.now(),
    fetchedAtIso: new Date().toISOString(),
  };
  if (sourceId) {
    await saveFlyerStockSnapshot(sourceId, dayKey, payload).catch(() => {});
  }
  return payload;
}

async function buildRecipeFromFlyerSnapshot(snapshot, { excludedTitles = [] } = {}) {
  if (!snapshot?.store?.name || !Array.isArray(snapshot.items) || !snapshot.items.length) {
    return null;
  }

  if (!GEMINI_API_KEY || typeof fetch !== 'function') {
    return buildFallbackRecipe(snapshot, excludedTitles);
  }

  const prompt = [
    'あなたは、忙しい社会人のために帰宅後すぐ作れる節約夕食レシピを提案する生活秘書です。',
    `対象店舗: ${snapshot.store.name}`,
    `住所: ${snapshot.store.address || '不明'}`,
    '以下の広告掲載商品と価格リストだけを材料候補として使って、今週まだ提案していないレシピを1つ提案してください。',
    `除外タイトル: ${excludedTitles.length ? excludedTitles.join(' / ') : 'なし'}`,
    '出力はJSONのみ。',
    'キーは title, summary, servings, estimatedTotalPrice, ingredients, steps, reason。',
    'ingredients は配列で、各要素に name, amount, unit, countText, estimatedPriceText, sourcePriceText を入れる。',
    'steps は4〜6手順の文字列配列。',
    'estimatedPriceText は広告価格から使うぶんの概算にする。',
    'sourcePriceText には参照した広告価格や単位を入れる。',
    'summary は60文字以内で、仕事帰りに買って夜に一人か二人で作れる内容にする。',
    '',
    '広告掲載商品と価格リスト:',
    ...snapshot.items.slice(0, 20).map((item, index) =>
      `${index + 1}. ${item.name} / ${item.unitText || '単位不明'} / ${item.mainPriceText || item.priceText || '価格不明'}${item.taxIncludedText ? ` / ${item.taxIncludedText}` : ''}`
    ),
  ].join('\n');

  const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...HTTP_HEADERS,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.5,
        responseMimeType: 'application/json',
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    return buildFallbackRecipe(snapshot, excludedTitles);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(part => part?.text || '').join('\n').trim();
  const parsed = parseJson(text);
  if (!parsed?.title) return buildFallbackRecipe(snapshot, excludedTitles);
  if (excludedTitles.includes(normalize(parsed.title))) return buildFallbackRecipe(snapshot, excludedTitles);
  return {
    title: parsed.title,
    summary: parsed.summary || '',
    servings: parsed.servings || '2人前',
    estimatedTotalPrice: parsed.estimatedTotalPrice || '',
    ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : [],
    steps: Array.isArray(parsed.steps) ? parsed.steps : [],
    reason: parsed.reason || '',
    source: 'tokubai-gemini-text',
  };
}

function formatFlyerStockReply(snapshot) {
  if (!snapshot?.store?.name || !Array.isArray(snapshot.items) || !snapshot.items.length) {
    return '近くでちゃんと拾える特売情報がまだ見つからなかったの。位置情報を送り直してくれたら、もう一回近いお店から見てくるね。';
  }

  const lines = [
    `今いる場所の近くで、今日いちばん組みやすかったのは ${snapshot.store.name}${formatDistance(snapshot.store.distanceMeters)}。`,
    snapshot.store.address || '',
    snapshot.store.url ? `チラシ: ${snapshot.store.url}` : '',
    '',
    '広告掲載商品と価格リスト:',
  ].filter(Boolean);

  snapshot.items.slice(0, 10).forEach(item => {
    lines.push(`・${item.name} — ${item.unitText || '単位不明'} / ${item.mainPriceText || item.priceText || '価格不明'}${item.taxIncludedText ? ` (${item.taxIncludedText})` : ''}`);
  });
  if (snapshot.items.length > 10) {
    lines.push(`…ほか ${snapshot.items.length - 10}件`);
  }
  lines.push('');
  lines.push('この特売で何を作るか見たい時は「近くの特売レシピ」って聞いてね。');
  return lines.join('\n');
}

function formatFlyerRecipeReply(snapshot, recipe) {
  if (!recipe?.title) {
    return '今夜はまだ、特売から組めるレシピをきれいにまとめ切れなかったの。少し時間を置いてもう一回聞いてね。';
  }
  const storeHeader = snapshot?.store?.name
    ? `${snapshot.store.name}${formatDistance(snapshot.store.distanceMeters)}の近くで、今夜の一皿を組んだよ。`
    : '今週使いやすい食材で、今夜の一皿を組んだよ。';
  const lines = [
    storeHeader,
    `「${recipe.title}」 (${recipe.servings || '2人前'})`,
  ];
  if (recipe.summary) lines.push(recipe.summary);
  if (recipe.estimatedTotalPrice) lines.push(`めやす合計: ${recipe.estimatedTotalPrice}`);

  // 近隣店の比較 — store 情報があれば必ず表示
  if (snapshot?.store?.name) {
    const competitors = Array.isArray(snapshot.competitors) ? snapshot.competitors : [];
    const hasItems = Array.isArray(snapshot.items) && snapshot.items.length > 0;
    const chosenAvg = hasItems ? computeAvgItemPrice(snapshot.items) : null;

    lines.push('');
    lines.push('【近くのお店】');

    // 選ばれた店
    const chosenPriceText = chosenAvg !== null ? ` — 特売平均 約${Math.round(chosenAvg)}円` : '';
    const chosenSuffix = competitors.length && chosenAvg !== null ? ' ← いちばん安い' : '';
    lines.push(`◎ ${snapshot.store.name}${formatDistance(snapshot.store.distanceMeters)}${chosenPriceText}${chosenSuffix}`);

    // 比較店
    for (const comp of competitors.slice(0, 2)) {
      const compPriceText = comp.avgItemPrice != null ? ` — 特売平均 約${Math.round(comp.avgItemPrice)}円` : '';
      lines.push(`・${comp.name}${formatDistance(comp.distanceMeters)}${compPriceText}`);
    }

    if (!hasItems) lines.push('（チラシ価格はまだ取れなかったよ。帰りに確認してね）');
  }

  lines.push('');
  lines.push('材料:');
  for (const ingredient of (recipe.ingredients || []).slice(0, 8)) {
    lines.push(`・${ingredient.name} ${joinIngredientAmount(ingredient)} / ${ingredient.estimatedPriceText || '価格めやす未計算'}${ingredient.sourcePriceText ? ` (${ingredient.sourcePriceText})` : ''}`);
  }
  if (Array.isArray(recipe.steps) && recipe.steps.length) {
    lines.push('');
    lines.push('作り方:');
    recipe.steps.slice(0, 6).forEach((step, index) => {
      lines.push(`${index + 1}. ${step}`);
    });
  }
  if (recipe.reason) {
    lines.push('');
    lines.push(`選び方の理由: ${recipe.reason}`);
  }
  if (snapshot?.store?.url) {
    lines.push('');
    lines.push(`チラシ: ${snapshot.store.url}`);
  }
  return lines.join('\n');
}

async function queryNearbySupermarkets(latitude, longitude) {
  const query = `
[out:json][timeout:20];
(
  node[shop="supermarket"](around:5000,${latitude},${longitude});
  way[shop="supermarket"](around:5000,${latitude},${longitude});
  relation[shop="supermarket"](around:5000,${latitude},${longitude});
);
out center tags 30;
  `.trim();

  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'content-type': 'text/plain; charset=UTF-8',
      ...HTTP_HEADERS,
    },
    body: query,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  const elements = Array.isArray(data?.elements) ? data.elements : [];
  return elements
    .map(element => {
      const lat = Number(element.lat ?? element.center?.lat);
      const lon = Number(element.lon ?? element.center?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const tags = element.tags || {};
      const name = String(tags.name || '').trim();
      if (!name) return null;
      return {
        name,
        address: buildAddressFromTags(tags),
        lat,
        lon,
        distanceMeters: Math.round(distanceMeters(latitude, longitude, lat, lon)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

async function findTokubaiStoreForCandidate(candidate, locationLabel = '') {
  // 地域指定クエリを先に試す（例: "西友 練馬区"）→ 同都市の店を優先する
  const queries = uniqueStrings([
    [candidate?.name, trimLocationLabel(locationLabel)].filter(Boolean).join(' '),
    candidate?.name,
  ]);
  let best = null;

  for (const query of queries) {
    if (!query) continue;
    const html = await fetchText(`${TOKUBAI_SEARCH_URL}?bargain_keyword=${encodeURIComponent(query)}`, 8000).catch(() => '');
    if (!html) continue;
    const results = parseTokubaiSearchResults(html);
    for (const result of results) {
      const score = scoreTokubaiResult(result, candidate, locationLabel);
      if (!best || score > best.score) {
        best = { ...result, score };
      }
    }
    if (best?.score >= 90) break;
  }
  if (!best || best.score < 40) return null;
  return best;
}

// locationLabel の地名トークン（丁目前の町名・区名）で Tokubai を直接検索する。
// OSM のデータが古く、閉店済み店舗名しか返さない場合でも正しい店を発見できる。
async function searchTokubaiStoresByArea(locationLabel) {
  const tokens = extractAreaSearchTokens(locationLabel);
  if (!tokens.length) return [];

  const locPref = extractPrefecture(locationLabel);
  const seen = new Set();
  const results = [];

  await Promise.allSettled(
    tokens.map(async token => {
      const html = await fetchText(
        `${TOKUBAI_SEARCH_URL}?bargain_keyword=${encodeURIComponent(token)}`,
        8000,
      ).catch(() => '');
      for (const store of parseTokubaiSearchResults(html)) {
        if (seen.has(store.shopId)) continue;
        // 都道府県が違う店は除外（例: 「江古田」で埼玉の店が引っかかるケースを防ぐ）
        const storePref = extractPrefecture(store.address);
        if (locPref && storePref && locPref !== storePref) continue;
        seen.add(store.shopId);
        results.push({ ...store, distanceMeters: null });
      }
    })
  );

  return results;
}

// locationLabel から Tokubai エリア検索に使う地名トークンを抽出する。
// 例: 「東京都中野区江古田3丁目2-14」→ ["江古田", "中野区"]
function extractAreaSearchTokens(locationLabel) {
  const text = String(locationLabel || '').normalize('NFKC').replace(/\s+/g, '');
  const tokens = [];

  // 丁目の前の地名: 「江古田3丁目」→「江古田」
  const neighborhoodMatch = text.match(/([^\d都道府県市区町村]{2,})(?=\d+丁目)/);
  if (neighborhoodMatch?.[1]) tokens.push(neighborhoodMatch[1]);

  // 区名: 「中野区」
  const wardMatch = text.match(/([^\s都道府]{2,4}区)/);
  if (wardMatch?.[1]) tokens.push(wardMatch[1]);

  return uniqueStrings(tokens).slice(0, 2);
}

function parseTokubaiSearchResults(html) {
  const matches = [...String(html || '').matchAll(
    /<li id='shop_(\d+)'>[\s\S]*?<a href="([^"]+)">[\s\S]*?<span class='shop_name'>\s*([^<]+?)\s*<span class='small'>[\s\S]*?<div class='shop_address'>\s*([\s\S]*?)\s*<\/div>/g
  )];
  return matches.map(match => ({
    shopId: match[1],
    url: new URL(match[2], 'https://tokubai.co.jp').toString(),
    name: decodeHtml(match[3]).trim(),
    address: decodeHtml(stripTags(match[4])).trim(),
  }));
}

function scoreTokubaiResult(result, candidate, locationLabel) {
  const resultName = normalize(result?.name);
  const candidateName = normalize(candidate?.name);
  const resultAddress = normalize(result?.address);
  const candidateAddress = normalize(candidate?.address);
  const location = normalize(locationLabel);

  let score = 0;
  if (resultName && candidateName) {
    if (resultName === candidateName) score += 80;
    else if (resultName.includes(candidateName) || candidateName.includes(resultName)) score += 55;
    const sharedNameTokens = countSharedTokens(resultName, candidateName);
    score += Math.min(sharedNameTokens * 8, 24);
  }
  if (candidateAddress && resultAddress) {
    const sharedAddressTokens = countSharedTokens(resultAddress, candidateAddress);
    score += Math.min(sharedAddressTokens * 6, 18);
  }
  if (location && resultAddress.includes(location)) score += 12;

  // 都道府県ミスマッチペナルティ: 東京都 vs 埼玉県 など別の都道府県は -45
  const locPref = extractPrefecture(locationLabel);
  const resPref = extractPrefecture(result?.address || '');
  if (locPref && resPref && locPref !== resPref) {
    score -= 45;
  }

  return score;
}

function extractPrefecture(text) {
  return String(text || '').normalize('NFKC').match(/(.{2,4}[都道府県])/)?.[1] || '';
}

async function fetchTokubaiStoreSnapshot(tokubaiStore, nearbyStore) {
  const html = await fetchText(tokubaiStore.url, 8000);
  let items = parseTokubaiStoreItems(html, tokubaiStore.url);
  let source = 'tokubai-html';
  if (!items.length) {
    items = await extractTokubaiLeafletItemsWithGemini(html, tokubaiStore.url).catch(() => []);
    if (items.length) source = 'tokubai-leaflet-gemini';
  }
  if (!items.length) return null;
  return {
    store: {
      name: tokubaiStore.name,
      address: tokubaiStore.address,
      url: tokubaiStore.url,
      distanceMeters: nearbyStore?.distanceMeters || null,
    },
    items,
    source,
  };
}

function parseTokubaiStoreItems(html, baseUrl) {
  const blocks = [...String(html || '').matchAll(/<div class='product_element_wrapper[\s\S]*?<\/a><\/div>/g)];
  const items = [];
  for (const blockMatch of blocks) {
    const block = blockMatch[0];
    const name = decodeHtml(block.match(/<div class='name hoverable_link'>\s*([\s\S]*?)\s*<\/div>/)?.[1] || '').trim();
    if (!name) continue;
    const unitText = decodeHtml(stripTags(block.match(/<div class='price_unit_and_production_area'>\s*([\s\S]*?)\s*<\/div>/)?.[1] || '')).trim();
    const mainNumber = block.match(/<span class="main_price"><span class="number">([^<]+)<\/span><span class="yen">円<\/span><\/span>/)?.[1]?.trim() || '';
    const taxText = decodeHtml(stripTags(block.match(/<span class="sub_price">([\s\S]*?)<\/span>/)?.[1] || '')).trim();
    const productPath = block.match(/class="product_element" href="([^"]+)"/)?.[1] || '';
    const imageUrl = block.match(/data-src="([^"]+)"/)?.[1] || '';
    items.push({
      name,
      unitText,
      mainPriceText: mainNumber ? `${mainNumber}円` : '',
      taxIncludedText: taxText,
      priceText: [mainNumber ? `${mainNumber}円` : '', taxText].filter(Boolean).join(' / '),
      productUrl: productPath ? new URL(productPath, baseUrl).toString() : '',
      imageUrl,
    });
  }
  return dedupeItems(items).slice(0, 24);
}

async function extractTokubaiLeafletItemsWithGemini(storeHtml, baseUrl) {
  if (!GEMINI_API_KEY || typeof fetch !== 'function') return [];

  const leafletLinks = parseTokubaiLeafletLinks(storeHtml, baseUrl).slice(0, 2);
  if (!leafletLinks.length) return [];

  const imageParts = [];
  for (const leafletUrl of leafletLinks) {
    const imagePart = await fetchTokubaiLeafletImagePart(leafletUrl).catch(() => null);
    if (imagePart) imageParts.push(imagePart);
  }
  if (!imageParts.length) return [];

  const prompt = [
    'あなたはスーパーのチラシOCR補助です。',
    '画像から広告掲載商品と価格リストを抽出して、JSONだけを返してください。',
    '出力形式は {"items":[{"name":"","unitText":"","mainPriceText":"","taxIncludedText":"","priceText":""}] }。',
    'items は最大25件。',
    '商品名は食材・食品中心にして、店舗説明、ポイント、日付、注意書き、キャンペーン見出しは除外。',
    'mainPriceText には「69円/100g」「99円/束」のように本体価格ベースを入れる。',
    'taxIncludedText には税込表記が読めた時だけ入れる。',
    'priceText には unitText と価格を短くまとめて入れる。',
    '値段が読めない時は空文字でよい。',
  ].join('\n');

  const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...HTTP_HEADERS,
    },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          ...imageParts,
        ],
      }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return [];

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(part => part?.text || '').join('\n').trim();
  const parsed = parseJson(text);
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  return dedupeItems(items
    .map(item => ({
      name: String(item?.name || '').trim(),
      unitText: String(item?.unitText || '').trim(),
      mainPriceText: String(item?.mainPriceText || '').trim(),
      taxIncludedText: String(item?.taxIncludedText || '').trim(),
      priceText: String(item?.priceText || '').trim(),
      productUrl: '',
      imageUrl: '',
    }))
    .filter(item => item.name)
  ).slice(0, 24);
}

function parseTokubaiLeafletLinks(html, baseUrl) {
  const matches = [...String(html || '').matchAll(
    /<a class="image_element scroll[^"]*"[^>]*href="([^"]*\/leaflets\/\d+[^"]*)"/g
  )];
  const links = matches
    .map(match => {
      try {
        return new URL(match[1], baseUrl).toString();
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
  return uniqueStrings(links);
}

async function fetchTokubaiLeafletImagePart(leafletUrl) {
  const html = await fetchText(leafletUrl);
  const src = html.match(/<img class="leaflet transparent"[^>]*src="([^"]+)"/)?.[1]
    || html.match(/high_resolution_image_url&quot;:&quot;([^"&]+(?:\\u0026[^"&]+)*)&quot;/)?.[1]?.replace(/\\u0026/g, '&');
  if (!src) return null;

  const imageRes = await fetch(src, {
    headers: HTTP_HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  if (!imageRes.ok) return null;
  const mimeType = imageRes.headers.get('content-type') || inferImageMimeType(src);
  const buffer = Buffer.from(await imageRes.arrayBuffer());
  if (!buffer.length) return null;

  return {
    inlineData: {
      mimeType,
      data: buffer.toString('base64'),
    },
  };
}

function buildFallbackRecipe(snapshot, excludedTitles = []) {
  const pool = FALLBACK_RECIPE_LIBRARY.filter(recipe => !excludedTitles.includes(normalize(recipe.title)));
  const candidates = pool.length ? pool : FALLBACK_RECIPE_LIBRARY;
  const availableNames = new Set((snapshot?.items || []).map(item => normalize(item?.name)).filter(Boolean));
  const scored = candidates
    .map(recipe => ({
      recipe,
      score: (recipe.ingredients || []).reduce((total, ingredient) => {
        const name = normalize(ingredient?.name);
        if (!name) return total;
        for (const itemName of availableNames) {
          if (itemName.includes(name) || name.includes(itemName)) {
            return total + 3;
          }
        }
        return total;
      }, 0),
    }))
    .sort((left, right) => right.score - left.score);
  const target = scored[0]?.recipe || null;
  return target ? { ...target, source: 'fallback-library' } : null;
}

function pickCheapestStore(snapshots) {
  if (!snapshots?.length) return snapshots?.[0] ?? null;
  return snapshots.reduce((best, snap) => {
    const bestAvg = computeAvgItemPrice(best.items);
    const snapAvg = computeAvgItemPrice(snap.items);
    return snapAvg < bestAvg ? snap : best;
  });
}

function computeAvgItemPrice(items = []) {
  const prices = items
    .map(item => extractItemPrice(item.mainPriceText || item.priceText || ''))
    .filter(p => p > 0);
  if (!prices.length) return 99999;
  return prices.reduce((sum, p) => sum + p, 0) / prices.length;
}

function extractItemPrice(text) {
  const match = String(text || '').replace(/,/g, '').match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function shouldReuseCachedSnapshot(snapshot, latitude, longitude) {
  if (!snapshot?.store?.url || !Array.isArray(snapshot?.items) || !snapshot.items.length) return false;
  // competitors フィールドがない旧フォーマットは再取得する
  if (!Array.isArray(snapshot.competitors)) return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return true;

  const cachedLatitude = Number(snapshot?.queryLocation?.latitude);
  const cachedLongitude = Number(snapshot?.queryLocation?.longitude);
  if (!Number.isFinite(cachedLatitude) || !Number.isFinite(cachedLongitude)) return true;

  return distanceMeters(cachedLatitude, cachedLongitude, latitude, longitude) <= 800;
}

function dedupeItems(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = `${normalize(item.name)}|${normalize(item.unitText)}|${normalize(item.mainPriceText)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function joinIngredientAmount(ingredient) {
  return [ingredient.amount, ingredient.unit, ingredient.countText]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

function trimLocationLabel(value) {
  return String(value || '').split(/[、,]/)[0].trim();
}

function uniqueStrings(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function countSharedTokens(left, right) {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  let count = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) count += 1;
  }
  return count;
}

function tokenize(text) {
  return new Set(
    String(text || '')
      .split(/[^\p{L}\p{N}]+/u)
      .map(value => value.trim())
      .filter(value => value.length >= 2)
  );
}

function buildAddressFromTags(tags) {
  return [
    tags['addr:province'],
    tags['addr:city'],
    tags['addr:suburb'],
    tags['addr:street'],
    tags['addr:housenumber'],
  ].filter(Boolean).join('');
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = value => value * Math.PI / 180;
  const earth = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earth * Math.asin(Math.sqrt(a));
}

function formatDistance(distanceMetersValue) {
  const distance = Number(distanceMetersValue);
  if (!Number.isFinite(distance) || distance <= 0) return '';
  if (distance < 1000) return ` (${distance}mくらい)`;
  return ` (${(distance / 1000).toFixed(1)}kmくらい)`;
}

async function fetchText(url, timeoutMs = 10000) {
  const res = await fetch(url, { headers: HTTP_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseJson(text) {
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

function inferImageMimeType(url) {
  const value = String(url || '').toLowerCase();
  if (value.endsWith('.png')) return 'image/png';
  if (value.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function stripTags(text) {
  return String(text || '').replace(/<[^>]+>/g, ' ');
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

function getTokyoDayKey() {
  const parts = getTokyoDateParts(new Date());
  return parts.date;
}

module.exports = {
  detectFlyerStockIntent,
  buildFlyerLocationPrompt,
  getNearbyFlyerSnapshot,
  buildRecipeFromFlyerSnapshot,
  buildFallbackRecipe,
  formatFlyerStockReply,
  formatFlyerRecipeReply,
};
