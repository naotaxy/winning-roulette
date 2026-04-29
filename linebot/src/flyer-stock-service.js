'use strict';

const {
  getFlyerStockSnapshot,
  saveFlyerStockSnapshot,
  getFlyerFavoriteStores,
  saveFlyerFavoriteStore,
  removeFlyerFavoriteStore,
  saveIngredientPrices,
  getIngredientPriceHistory,
} = require('./firebase-admin');
const { getTokyoDateParts } = require('./date-utils');
const RECIPE_LIBRARY = require('./recipe-library');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const TOKUBAI_SEARCH_URL = 'https://tokubai.co.jp/search';
const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const FLYER_SEARCH_RADIUS_METERS = 2000;
const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ja-JP,ja;q=0.9',
};
const COORDINATE_AREA_FALLBACKS = [
  { label: '中野区江古田', lat: 35.7279, lon: 139.6659, radiusMeters: 2600, tokens: ['165-0022', '江古田', '中野区'] },
];

const FALLBACK_RECIPE_LIBRARY = [
  {
    title: '豚こまと小松菜の卵とじ',
    summary: '青菜と卵でまとまりやすい、平日に寄せやすい一皿。',
    servings: '2人前',
    estimatedTotalPrice: '',
    ingredients: [
      { name: '豚こま切れ', amount: '160', unit: 'g', countText: '1パック想定', estimatedPriceText: 'チラシ価格' },
      { name: '小松菜', amount: '1', unit: '束', countText: '1束', estimatedPriceText: 'チラシ価格' },
      { name: '卵', amount: '2', unit: '個', countText: '2個', estimatedPriceText: 'チラシ価格' },
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
    estimatedTotalPrice: '',
    ingredients: [
      { name: '鶏むね肉', amount: '220', unit: 'g', countText: '1枚', estimatedPriceText: 'チラシ価格' },
      { name: 'きのこ', amount: '1', unit: 'パック', countText: '1パック', estimatedPriceText: 'チラシ価格' },
      { name: 'ほうれん草', amount: '0.5', unit: '束', countText: '1/2束', estimatedPriceText: 'チラシ価格' },
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

// 東京スーパー相場めやす（2024-2025年平均帯）
const INGREDIENT_MARKET_PRICE_TABLE = [
  { keys: ['豚こま', '豚こま切れ'], label: '豚こま', min: 160, max: 220, per: '200g' },
  { keys: ['豚バラ', 'バラ肉'], label: '豚バラ', min: 200, max: 280, per: '200g' },
  { keys: ['豚ひき', '豚挽', 'ひき肉', '挽き肉'], label: '豚ひき', min: 180, max: 240, per: '200g' },
  { keys: ['豚ロース', 'ロース肉'], label: '豚ロース', min: 200, max: 280, per: '200g' },
  { keys: ['豚しゃぶ', 'しゃぶしゃぶ用豚'], label: '豚しゃぶ', min: 220, max: 320, per: '200g' },
  { keys: ['鶏もも', 'もも肉', 'とりもも'], label: '鶏もも', min: 200, max: 280, per: '300g' },
  { keys: ['鶏むね', 'むね肉', '胸肉', 'とりむね'], label: '鶏むね', min: 140, max: 200, per: '300g' },
  { keys: ['鶏ひき', '鶏挽', 'とりひき'], label: '鶏ひき', min: 160, max: 220, per: '200g' },
  { keys: ['手羽先', '手羽元', 'てばさき'], label: '手羽', min: 150, max: 220, per: '200g' },
  { keys: ['鮭', 'サーモン'], label: '鮭', min: 100, max: 160, per: '1切' },
  { keys: ['さば', 'サバ', 'さば缶'], label: 'サバ', min: 100, max: 150, per: '1切' },
  { keys: ['あじ', 'アジ'], label: 'アジ', min: 80, max: 130, per: '1尾' },
  { keys: ['たら', 'タラ'], label: 'タラ', min: 100, max: 160, per: '1切' },
  { keys: ['ぶり', 'ブリ'], label: 'ブリ', min: 130, max: 200, per: '1切' },
  { keys: ['小松菜'], label: '小松菜', min: 100, max: 150, per: '1束' },
  { keys: ['ほうれん草', 'ほうれんそう'], label: 'ほうれん草', min: 100, max: 160, per: '1束' },
  { keys: ['キャベツ'], label: 'キャベツ', min: 100, max: 180, per: '1/2個' },
  { keys: ['白菜', 'はくさい'], label: '白菜', min: 150, max: 250, per: '1/4個' },
  { keys: ['大根', 'だいこん'], label: '大根', min: 100, max: 180, per: '1/2本' },
  { keys: ['玉ねぎ', 'たまねぎ', 'オニオン'], label: '玉ねぎ', min: 60, max: 120, per: '1個' },
  { keys: ['にんじん', '人参', 'キャロット'], label: 'にんじん', min: 60, max: 100, per: '1本' },
  { keys: ['じゃがいも', 'ジャガイモ', 'ポテト'], label: 'じゃがいも', min: 60, max: 100, per: '1個' },
  { keys: ['ブロッコリー'], label: 'ブロッコリー', min: 150, max: 250, per: '1房' },
  { keys: ['もやし'], label: 'もやし', min: 20, max: 50, per: '1袋' },
  { keys: ['きのこ', 'しめじ', 'えのき', 'えのきだけ', 'まいたけ', 'しいたけ'], label: 'きのこ', min: 80, max: 150, per: '1パック' },
  { keys: ['なす', 'ナス'], label: 'なす', min: 80, max: 130, per: '2本' },
  { keys: ['ピーマン'], label: 'ピーマン', min: 80, max: 120, per: '1袋' },
  { keys: ['長ねぎ', 'ながねぎ', 'ねぎ', 'ネギ'], label: '長ねぎ', min: 100, max: 180, per: '1本' },
  { keys: ['卵', 'たまご', '玉子'], label: '卵', min: 180, max: 260, per: '10個' },
  { keys: ['豆腐', 'とうふ', '木綿豆腐', '絹ごし', '絹豆腐'], label: '豆腐', min: 60, max: 100, per: '1丁' },
  { keys: ['厚揚げ', 'あつあげ'], label: '厚揚げ', min: 80, max: 130, per: '1枚' },
  { keys: ['ウインナー', 'ソーセージ', 'ウィンナー'], label: 'ウインナー', min: 150, max: 250, per: '1袋' },
  { keys: ['ハム', 'スライスハム', 'ロースハム'], label: 'ハム', min: 150, max: 220, per: '1袋' },
  { keys: ['しょうが', '生姜', 'ジンジャー'], label: 'しょうが', min: 50, max: 100, per: '1片' },
  { keys: ['にんにく', 'ガーリック', 'ニンニク'], label: 'にんにく', min: 50, max: 100, per: '1個' },
];

const PANTRY_KEYWORDS = [
  'しょうゆ', '醤油', 'みりん', 'みりん風', '料理酒', '砂糖', '塩', '胡椒', 'こしょう',
  'サラダ油', 'ごま油', '油', '味噌', 'みそ', '片栗粉', '小麦粉', 'かたくり粉',
  'だしの素', 'バター', 'マヨネーズ', 'ケチャップ', 'オリーブオイル', 'オリーブ油',
  '鶏がらスープ', 'コンソメ', '中華だし', 'ガラスープ', '顆粒だし',
];

function detectGenre(normalized) {
  if (/(中華|中国料理|チャイニーズ|中華風)/.test(normalized)) return '中華';
  if (/(洋食|フレンチ|イタリアン|洋風|グラタン|パスタ|洋食系)/.test(normalized)) return '洋食';
  if (/(和食|日本料理|和風料理)/.test(normalized)) return '和食';
  return null;
}

function detectMainIngredient(normalized) {
  if (/(豚こま|豚こま切れ)/.test(normalized)) return '豚こま';
  if (/(豚バラ|バラ肉)/.test(normalized)) return '豚バラ';
  if (/(豚ひき|豚挽き|ひき肉)/.test(normalized)) return '豚ひき';
  if (/(豚しゃぶ|しゃぶしゃぶ)/.test(normalized)) return '豚しゃぶ';
  if (/(豚ロース|ロース肉)/.test(normalized)) return '豚ロース';
  if (/(鶏もも|もも肉|とりもも)/.test(normalized)) return '鶏もも';
  if (/(鶏むね|むね肉|胸肉|とりむね)/.test(normalized)) return '鶏むね';
  if (/(鶏ひき|鶏挽き|とりひき)/.test(normalized)) return '鶏ひき';
  if (/(手羽先|手羽元|てばさき)/.test(normalized)) return '手羽先';
  if (/(魚|さかな|鮭|さけ|サーモン|さば|サバ|さんま|アジ|あじ|タラ|たら|ぶり|ブリ)/.test(normalized)) return '魚';
  if (/(豆腐|とうふ|厚揚げ|あつあげ)/.test(normalized)) return '豆腐';
  if (/(卵|たまご|玉子)/.test(normalized)) return '卵';
  return null;
}

function detectFlyerStockIntent(text) {
  const normalized = normalize(text);
  if (!normalized) return null;

  const favoriteRankAdd = normalized.match(/([1-5])番(?:目)?(?:の店)?(?:を|の)?お気に入り(?:にして|登録|追加)?/);
  if (favoriteRankAdd) {
    return { type: 'flyerStock', action: 'favoriteAdd', rank: Number(favoriteRankAdd[1]) };
  }

  const favoriteRankRemove = normalized.match(/([1-5])番(?:目)?(?:の店)?(?:を|の)?お気に入り(?:から)?(?:外して|解除|削除)/);
  if (favoriteRankRemove) {
    return { type: 'flyerStock', action: 'favoriteRemove', rank: Number(favoriteRankRemove[1]) };
  }

  if (/(お気に入り店一覧|お気に入り一覧|特売お気に入り)/.test(normalized)) {
    return { type: 'flyerStock', action: 'favoritesList' };
  }

  if (/(お気に入り店.*特売|お気に入りの特売)/.test(normalized)) {
    return { type: 'flyerStock', action: 'favoriteSales' };
  }

  const storeSalesRank = normalized.match(/([1-5])番(?:目)?(?:の店)?(?:の特売|のチラシ|を見せて|を見たい)/);
  if (storeSalesRank) {
    return { type: 'flyerStock', action: 'storeSales', rank: Number(storeSalesRank[1]) };
  }

  // 会話の続き: 別レシピ要求（flyer word なしで成立）
  if (/(他のレシピ|別のレシピ|違うレシピ|次のレシピ|他には[？?]?$|ほかには[？?]?$|もう一品|ちがうやつ|別のやつ)/.test(normalized)) {
    return { type: 'flyerStock', action: 'recipeNext' };
  }

  const genre = detectGenre(normalized);
  const mainIngredient = detectMainIngredient(normalized);
  const hasRecipeWord = /(レシピ|料理|何作|なにつく|献立|晩ご飯|夕飯|何が作|何つく|何作れ|作れる|つくれる|使って|つかって)/.test(normalized);

  // 素材・ジャンル指定でのレシピ要求はチラシワード不要
  if ((genre || mainIngredient) && hasRecipeWord) {
    return { type: 'flyerStock', action: 'recipe', genre, mainIngredient };
  }

  if (/(店別特売|各店の特売|各店のチラシ|比較したい|店を比べたい|特売比較)/.test(normalized)) {
    return { type: 'flyerStock', action: 'list' };
  }

  const hasFlyerWord = /(チラシ|特売|広告掲載商品|価格リスト|広告商品|特売商品|食材リスト|買い物メモ|特売ストック|今日の買い物|安い食材)/.test(normalized);
  if (!hasFlyerWord) return null;

  if (hasRecipeWord) {
    return { type: 'flyerStock', action: 'recipe', genre, mainIngredient, locationLabel: extractPostalCodeTokens(normalized)[0] || '' };
  }
  return { type: 'flyerStock', action: 'list', locationLabel: extractPostalCodeTokens(normalized)[0] || '' };
}

function buildFlyerLocationPrompt(intent = {}, latestLocation = null) {
  const hasRecentLocation = !!latestLocation?.latitude && !!latestLocation?.longitude;
  const isRetry = intent?.retry === true;
  return {
    type: 'text',
    text: isRetry
      ? 'この地点だけだと候補を取り切れなかったの。住所か郵便番号をそのまま送ってくれたら、Tokubai検索に切り替えて見るね。'
      : hasRecentLocation
      ? '近くの特売をちゃんと絞るなら、位置情報をもう一回もらえると精度が上がるよ。送り直してくれたら、近いお店から広告掲載商品と価格を拾ってくるね。'
      : '近くのお店の広告掲載商品と価格を探すね。位置情報を送ってくれたら、近いお店から特売情報を拾って整えるよ。',
    quickReply: {
      items: [
        {
          type: 'action',
          action: {
            type: 'location',
            label: isRetry ? '位置情報を再送' : '位置情報を送る',
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
  const hasRequestedCoords = Number.isFinite(requestedLatitude) && Number.isFinite(requestedLongitude);
  const queryLatitude = hasRequestedCoords ? requestedLatitude : null;
  const queryLongitude = hasRequestedCoords ? requestedLongitude : null;
  locationLabel = await enrichFlyerLocationLabel(locationLabel, queryLatitude, queryLongitude);
  const hasLocationText = !!String(locationLabel || '').trim();
  const favoriteStores = sourceId
    ? (await getFlyerFavoriteStores(sourceId).catch(() => [])).filter(store => looksLikeFoodStore(store?.name))
    : [];
  if (!forceRefresh && sourceId && (!hasLocationText || hasRequestedCoords)) {
    const cached = await getFlyerStockSnapshot(sourceId, dayKey).catch(() => null);
    if (
      cached?.store?.url
      && Array.isArray(cached?.items)
      && cached.items.length
      && shouldReuseCachedSnapshot(cached, requestedLatitude, requestedLongitude, favoriteStores)
    ) {
      return cached;
    }
  }

  if (!hasRequestedCoords && !hasLocationText) return null;
  const favoriteUrlSet = new Set(favoriteStores.map(store => String(store?.url || '').trim()).filter(Boolean));

  // OSM とエリア直接検索を並列実行（OSM は閉店・改名が反映されないことがあるためエリア検索で補う）
  const [nearbyStores, areaDirectStores] = await Promise.all([
    hasRequestedCoords ? queryNearbySupermarkets(requestedLatitude, requestedLongitude) : Promise.resolve([]),
    searchTokubaiStoresByArea(locationLabel, hasRequestedCoords ? requestedLatitude : null, hasRequestedCoords ? requestedLongitude : null),
  ]);

  // OSM 店ごとに Tokubai URL を並列検索
  const osmResults = await Promise.allSettled(
    nearbyStores.slice(0, 12).map(async nearbyStore => {
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
    if (!looksLikeFoodStore(areaStore.name)) continue;
    if (!seenUrls.has(areaStore.url)) {
      seenUrls.add(areaStore.url);
      fetchTargets.push({ tokubaiStore: areaStore, nearbyStore: { distanceMeters: null } });
    }
  }

  // チラシ価格を並列取得（最大 10 店）
  const settled = await Promise.allSettled(
    fetchTargets.slice(0, 10).map(({ tokubaiStore, nearbyStore }) =>
      fetchTokubaiStoreSnapshot(tokubaiStore, nearbyStore).catch(() => null)
    )
  );
  const fetchedSnapshots = settled
    .filter(r => r.status === 'fulfilled' && r.value?.store?.name)
    .map(r => r.value);
  const enriched = fetchedSnapshots.filter(snapshot => Array.isArray(snapshot.items) && snapshot.items.length);
  const candidateSnapshots = fetchedSnapshots.filter(snapshot => !Array.isArray(snapshot.items) || !snapshot.items.length);
  const favoriteSettled = await Promise.allSettled(
    favoriteStores.slice(0, 2).map(store =>
      fetchTokubaiStoreSnapshot({
        shopId: store.shopId,
        url: store.url,
        name: store.name,
        address: store.address,
      }, {
        distanceMeters: Number.isFinite(Number(store.distanceMeters)) ? Number(store.distanceMeters) : null,
      }).catch(() => null)
    )
  );
  const favoriteSnapshots = favoriteSettled
    .filter(r => r.status === 'fulfilled' && r.value?.items?.length)
    .map(r => r.value);

  console.log(`[flyer-stock] enriched=${enriched.length} favorites=${favoriteSnapshots.length} areaDirectStores=${areaDirectStores.length} nearbyStores=${nearbyStores.length} fetchTargets=${fetchTargets.length} lat=${queryLatitude ?? 'none'} lon=${queryLongitude ?? 'none'} label="${locationLabel || ''}"`);

  if (!enriched.length && !favoriteSnapshots.length) {
    if (candidateSnapshots.length) {
      const comparisonPool = dedupeStoreSnapshots(candidateSnapshots).slice(0, 5);
      const stores = comparisonPool.map((storeSnapshot, index) => serializeStoreSnapshotForDisplay(storeSnapshot, {
        rank: index + 1,
        chosenUrl: comparisonPool[0]?.store?.url || '',
        favoriteUrlSet,
      }));
      return {
        source: 'tokubai-candidate-links',
        dayKey,
        locationLabel,
        queryLocation: { latitude: queryLatitude, longitude: queryLongitude, label: locationLabel || '' },
        store: comparisonPool[0]?.store || null,
        items: [],
        competitors: [],
        ingredientComparisons: {},
        stores,
        favoriteShopIds: favoriteStores.slice(0, 2).map(store => String(store.shopId || store.url || '')).filter(Boolean),
        fetchedAt: Date.now(),
        fetchedAtIso: new Date().toISOString(),
      };
    }

    const foodStores = areaDirectStores.filter(s => looksLikeFoodStore(s.name));
    if (foodStores.length) {
      // Tokubai 位置情報検索で見つかった食品系の店を表示（OSM より信頼できる）
      console.log(`[flyer-stock] overpass-only from areaDirectStores: ${foodStores[0]?.name}`);
      const stores = foodStores.slice(0, 3);
      return {
        source: 'overpass-only',
        dayKey,
        locationLabel,
        queryLocation: { latitude: queryLatitude, longitude: queryLongitude, label: locationLabel || '' },
        store: { shopId: stores[0].shopId || '', name: stores[0].name, address: stores[0].address, distanceMeters: null, url: stores[0].url || '' },
        items: [],
        competitors: stores.slice(1).map(s => ({ shopId: s.shopId || '', name: s.name, distanceMeters: null, url: s.url || '', avgItemPrice: null })),
        stores: stores.map((store, index) => ({
          rank: index + 1,
          shopId: store.shopId || '',
          name: store.name,
          address: store.address,
          url: store.url || '',
          distanceMeters: null,
          avgItemPrice: null,
          isChosen: index === 0,
          isFavorite: false,
          items: [],
          itemCount: 0,
        })),
        fetchedAt: Date.now(),
        fetchedAtIso: new Date().toISOString(),
      };
    }

    // GPS 座標があるのに Tokubai で店が見つからない → OSM のステールデータは使わない
    // null を返すと店情報なしのフォールバックレシピになる（誤った店名表示を避けるため）
    if (Number.isFinite(requestedLatitude) && Number.isFinite(requestedLongitude)) {
      const fallbackStores = buildTokubaiSearchFallbackStores(locationLabel, queryLatitude, queryLongitude);
      if (fallbackStores.length) {
        console.log(`[flyer-stock] fallback search links from location: ${fallbackStores[0]?.name}`);
        return buildCandidateOnlySnapshot({
          source: 'tokubai-search-fallback',
          dayKey,
          locationLabel,
          latitude: queryLatitude,
          longitude: queryLongitude,
          stores: fallbackStores,
          favoriteStores,
        });
      }
      console.log('[flyer-stock] GPS available but no Tokubai stores found — skip stale OSM data');
      return null;
    }

    // GPS なし → OSM を最終手段として使う
    if (!nearbyStores.length) {
      const fallbackStores = buildTokubaiSearchFallbackStores(locationLabel, queryLatitude, queryLongitude);
      if (fallbackStores.length) {
        return buildCandidateOnlySnapshot({
          source: 'tokubai-search-fallback',
          dayKey,
          locationLabel,
          latitude: queryLatitude,
          longitude: queryLongitude,
          stores: fallbackStores,
          favoriteStores,
        });
      }
      return null;
    }
    console.log(`[flyer-stock] overpass-only from OSM (no GPS): ${nearbyStores[0]?.name}`);
    const osmStores = nearbyStores.slice(0, 3);
    return {
      source: 'overpass-only',
      dayKey,
      locationLabel,
      queryLocation: { latitude: queryLatitude, longitude: queryLongitude, label: locationLabel || '' },
      store: { name: osmStores[0].name, address: osmStores[0].address, distanceMeters: osmStores[0].distanceMeters ?? null, url: null },
      items: [],
      competitors: osmStores.slice(1).map(s => ({ name: s.name, distanceMeters: s.distanceMeters ?? null, url: null, avgItemPrice: null })),
      stores: osmStores.map((store, index) => ({
        rank: index + 1,
        shopId: '',
        name: store.name,
        address: store.address,
        url: '',
        distanceMeters: store.distanceMeters ?? null,
        avgItemPrice: null,
        isChosen: index === 0,
        isFavorite: false,
        items: [],
        itemCount: 0,
      })),
      fetchedAt: Date.now(),
      fetchedAtIso: new Date().toISOString(),
    };
  }

  // 距離 null（エリア直接店）は距離あり店の後ろに回し、近場3店 + お気に入り2店を比較する
  enriched.sort((a, b) => (a.store.distanceMeters ?? Infinity) - (b.store.distanceMeters ?? Infinity));
  const nearbyTop3 = enriched.slice(0, 3);
  const comparisonPool = dedupeStoreSnapshots([
    ...nearbyTop3,
    ...favoriteSnapshots,
  ]).slice(0, 5);
  const chosen = pickCheapestStore(comparisonPool);
  const ingredientComparisons = buildIngredientComparisons(comparisonPool);
  const competitors = comparisonPool
    .filter(s => s.store.url !== chosen.store.url)
    .map(c => ({
      shopId: c.store.shopId || '',
      name: c.store.name,
      distanceMeters: c.store.distanceMeters,
      url: c.store.url,
      avgItemPrice: computeAvgItemPrice(c.items),
      isFavorite: favoriteUrlSet.has(String(c.store.url || '').trim()),
    }));
  const stores = comparisonPool.map((storeSnapshot, index) => serializeStoreSnapshotForDisplay(storeSnapshot, {
    rank: index + 1,
    chosenUrl: chosen?.store?.url || '',
    favoriteUrlSet,
  }));

  const payload = {
    source: chosen.source || 'tokubai-html',
    dayKey,
    locationLabel,
    queryLocation: {
      latitude: queryLatitude,
      longitude: queryLongitude,
      label: locationLabel || '',
    },
    store: chosen.store,
    items: chosen.items.slice(0, 18),
    competitors,
    ingredientComparisons,
    stores,
    favoriteShopIds: favoriteStores.slice(0, 2).map(store => String(store.shopId || store.url || '')).filter(Boolean),
    fetchedAt: Date.now(),
    fetchedAtIso: new Date().toISOString(),
  };
  if (sourceId) {
    await saveIngredientPrices(buildIngredientHistoryEntries(comparisonPool, dayKey)).catch(() => {});
    await saveFlyerStockSnapshot(sourceId, dayKey, payload).catch(() => {});
  }
  return payload;
}

async function buildRecipeFromFlyerSnapshot(snapshot, { excludedTitles = [], filters = {} } = {}) {
  if (!snapshot?.store?.name || !Array.isArray(snapshot.items) || !snapshot.items.length) {
    return null;
  }

  if (!GEMINI_API_KEY || typeof fetch !== 'function') {
    return buildFallbackRecipe(snapshot, excludedTitles, filters);
  }

  const filterHints = [
    filters.genre ? `ジャンル指定: ${filters.genre}` : '',
    filters.mainIngredient ? `メイン食材指定: ${filters.mainIngredient}` : '',
  ].filter(Boolean).join(' / ');

  const prompt = [
    'あなたは、忙しい社会人のために帰宅後すぐ作れる節約夕食レシピを提案する生活秘書です。',
    `対象店舗: ${snapshot.store.name}`,
    `住所: ${snapshot.store.address || '不明'}`,
    '以下の広告掲載商品と価格リストだけを材料候補として使って、今週まだ提案していないレシピを1つ提案してください。',
    `除外タイトル: ${excludedTitles.length ? excludedTitles.join(' / ') : 'なし'}`,
    filterHints ? `条件: ${filterHints}（この条件を優先して選ぶこと）` : '',
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
        maxOutputTokens: 600,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    return buildFallbackRecipe(snapshot, excludedTitles, filters);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(part => part?.text || '').join('\n').trim();
  const parsed = parseJson(text);
  if (!parsed?.title) return buildFallbackRecipe(snapshot, excludedTitles, filters);
  if (excludedTitles.includes(normalize(parsed.title))) return buildFallbackRecipe(snapshot, excludedTitles, filters);
  return enrichRecipePricing({
    title: parsed.title,
    summary: parsed.summary || '',
    servings: parsed.servings || '2人前',
    estimatedTotalPrice: parsed.estimatedTotalPrice || '',
    ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : [],
    steps: Array.isArray(parsed.steps) ? parsed.steps : [],
    reason: parsed.reason || '',
    source: 'tokubai-gemini-text',
  }, snapshot);
}

function formatFlyerStockReply(snapshot) {
  if (!snapshot?.store?.name || !Array.isArray(snapshot.items) || !snapshot.items.length) {
    const stores = Array.isArray(snapshot?.stores) && snapshot.stores.length
      ? snapshot.stores.slice(0, 5)
      : snapshot?.store?.name
        ? [{
          rank: 1,
          name: snapshot.store.name,
          address: snapshot.store.address || '',
          url: snapshot.store.url || '',
          distanceMeters: snapshot.store.distanceMeters ?? null,
          leafletLinks: snapshot.leafletLinks || snapshot.store.leafletLinks || [],
        }]
        : [];
    if (stores.length) {
      const lines = [
        '近くのチラシ候補は拾えたよ。',
        '価格リストの自動読み取りまでは安定しなかったから、まずTokubaiの店舗・チラシページを出すね。',
      ];
      stores.forEach(store => {
        const leaflets = Array.isArray(store.leafletLinks) ? store.leafletLinks.filter(Boolean).slice(0, 2) : [];
        lines.push('');
        lines.push(`${store.rank || lines.length}. ${store.name}${formatDistance(store.distanceMeters)}`);
        if (store.address) lines.push(store.address);
        if (store.url) lines.push(`店舗: ${store.url}`);
        leaflets.forEach((url, index) => lines.push(`チラシ画像${index + 1}: ${url}`));
      });
      lines.push('');
      lines.push('「1番をお気に入り」「2番の特売」みたいに続けて聞けるよ。位置を変えて探す時だけ、位置情報を送り直してね。');
      return lines.join('\n');
    }
    return 'この地点のチラシ候補を取り切れなかったの。郵便番号が分かる時は「近くのチラシ 165-0022」みたいに送ってくれたら、Tokubai検索で見に行くね。';
  }

  const stores = Array.isArray(snapshot.stores) && snapshot.stores.length
    ? snapshot.stores.slice(0, 5)
    : [serializeStoreSnapshotForDisplay({
      store: snapshot.store,
      items: snapshot.items,
    }, {
      rank: 1,
      chosenUrl: snapshot?.store?.url || '',
      favoriteUrlSet: new Set(),
    })];

  const lines = [
    `近くの3店と、お気に入りに入れてある少し遠めのお店2件まで見比べたよ。`,
    `今の軸にしたのは ${snapshot.store.name}${formatDistance(snapshot.store.distanceMeters)}。`,
  ].filter(Boolean);

  stores.forEach(store => {
    lines.push('');
    lines.push(formatStoreHeading(store));
    (store.items || []).slice(0, 3).forEach(item => {
      lines.push(`・${item.name} — ${item.unitText || '単位不明'} / ${item.mainPriceText || item.priceText || '価格不明'}${item.taxIncludedText ? ` (${item.taxIncludedText})` : ''}`);
    });
    if (store.itemCount > (store.items || []).length) {
      lines.push(`…ほか ${store.itemCount - store.items.length}件`);
    }
    if (store.url) lines.push(`チラシ: ${store.url}`);
  });
  lines.push('');
  lines.push('「1番をお気に入り」「2番の特売」「お気に入り店一覧」みたいに聞いてくれたら、そのまま続きを返せるよ。');
  lines.push('この特売で何を作るか見たい時は「近くの特売レシピ」って聞いてね。');
  return lines.join('\n');
}

function formatStoreHeading(store) {
  const flags = [];
  if (store.isChosen) flags.push('今の本命');
  if (store.isFavorite) flags.push('お気に入り');
  if (Number.isFinite(Number(store.avgItemPrice)) && Number(store.avgItemPrice) < 99999) {
    flags.push(`特売平均 約${Math.round(Number(store.avgItemPrice))}円`);
  }
  const marker = store.isChosen ? '◎' : store.isFavorite ? '★' : '・';
  return `${store.rank}. ${marker} ${store.name}${formatDistance(store.distanceMeters)}${flags.length ? ` — ${flags.join(' / ')}` : ''}`;
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
    const chosenStoreEntry = findStoreEntry(snapshot, null, snapshot.store.url);
    const chosenFavoriteBadge = chosenStoreEntry?.isFavorite ? ' / お気に入り' : '';

    lines.push('');
    lines.push('【近くのお店】');

    // 選ばれた店
    const chosenPriceText = chosenAvg !== null ? ` — 特売平均 約${Math.round(chosenAvg)}円` : '';
    const chosenSuffix = competitors.length && chosenAvg !== null ? ' ← いちばん安い' : '';
    lines.push(`◎ ${snapshot.store.name}${formatDistance(snapshot.store.distanceMeters)}${chosenPriceText}${chosenFavoriteBadge}${chosenSuffix}`);

    // 比較店
    for (const comp of competitors.slice(0, 2)) {
      const compPriceText = comp.avgItemPrice != null ? ` — 特売平均 約${Math.round(comp.avgItemPrice)}円` : '';
      const compFavoriteBadge = comp.isFavorite ? ' / お気に入り' : '';
      lines.push(`・${comp.name}${formatDistance(comp.distanceMeters)}${compPriceText}${compFavoriteBadge}`);
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
  node[shop="supermarket"](around:${FLYER_SEARCH_RADIUS_METERS},${latitude},${longitude});
  way[shop="supermarket"](around:${FLYER_SEARCH_RADIUS_METERS},${latitude},${longitude});
  relation[shop="supermarket"](around:${FLYER_SEARCH_RADIUS_METERS},${latitude},${longitude});
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
      if (!looksLikeFoodStore(name)) return null;
      return {
        name,
        branch: String(tags.branch || '').trim(),
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
  const candidateAreaTokens = extractAreaSearchTokens(candidate?.address || '');
  const candidateBranch = String(candidate?.branch || '').trim();
  const queries = uniqueStrings([
    [candidate?.name, candidateBranch].filter(Boolean).join(' '),
    ...candidateAreaTokens.map(token => [candidate?.name, token].filter(Boolean).join(' ')),
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
// GPS 座標があれば Tokubai の位置情報検索を直接使い、
// locationLabel に郵便番号・地名があればキーワード検索も併用する。
async function searchTokubaiStoresByArea(locationLabel, latitude, longitude) {
  const locPref = extractPrefecture(locationLabel);
  const seen = new Set();
  const results = [];
  const addStores = stores => {
    for (const store of stores || []) {
      if (!store?.shopId || seen.has(store.shopId)) continue;
      const storePref = extractPrefecture(store.address);
      if (locPref && storePref && locPref !== storePref) continue;
      seen.add(store.shopId);
      results.push({ ...store, distanceMeters: null });
    }
  };

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    const html = await fetchText(
      `${TOKUBAI_SEARCH_URL}?latitude=${latitude}&longitude=${longitude}`,
      8000,
    ).catch((err) => {
      console.warn(`[flyer-stock] Tokubai geo-search failed: ${err?.message}`);
      return '';
    });
    const stores = parseTokubaiSearchResults(html);
    console.log(`[flyer-stock] Tokubai geo-search html=${html.length}bytes stores=${stores.length} locPref="${extractPrefecture(locationLabel)}"`);
    // GPS 座標検索の結果をまず取り込み、あとで郵便番号・地名検索の結果も足す。
    addStores(stores);
  }

  // locationLabel の郵便番号・地名でも Tokubai を検索する。
  // GPS 検索だけだと店舗は見えてもチラシページに届かないことがあるため併用する。
  const tokens = getTokubaiAreaSearchTokens(locationLabel, latitude, longitude);
  if (tokens.length) {
    await Promise.allSettled(
      tokens.map(async token => {
        const html = await fetchText(
          `${TOKUBAI_SEARCH_URL}?latitude=&longitude=&from=&bargain_keyword=${encodeURIComponent(token)}`,
          8000,
        ).catch(() => '');
        addStores(parseTokubaiSearchResults(html));
      })
    );
  }
  return results;
}

// locationLabel から Tokubai キーワード検索用の地名トークンを抽出する（座標なし時のフォールバック）。
// 例: 「東京都中野区江古田3丁目2-14」→ ["江古田", "中野区"]
function extractAreaSearchTokens(locationLabel) {
  const text = String(locationLabel || '').normalize('NFKC').replace(/\s+/g, '');
  const tokens = [];

  for (const postalCode of extractPostalCodeTokens(text)) {
    tokens.push(postalCode);
  }

  // 丁目の前の地名: 「江古田3丁目」→「江古田」
  const neighborhoodMatch = text.match(/([^\d都道府県市区町村]{2,})(?=\d+丁目)/);
  if (neighborhoodMatch?.[1]) tokens.push(neighborhoodMatch[1]);

  // 区名: 「中野区」
  const wardMatch = text.match(/([^\s都道府]{2,4}区)/);
  if (wardMatch?.[1]) tokens.push(wardMatch[1]);

  return uniqueStrings(tokens).slice(0, 4);
}

function extractPostalCodeTokens(text) {
  const normalized = String(text || '').normalize('NFKC');
  return uniqueStrings(
    [...normalized.matchAll(/(?:〒\s*)?(\d{3})-?(\d{4})/g)]
      .map(match => `${match[1]}-${match[2]}`)
  );
}

function getTokubaiAreaSearchTokens(locationLabel, latitude = null, longitude = null) {
  return uniqueStrings([
    ...extractAreaSearchTokens(locationLabel),
    ...inferCoordinateAreaTokens(latitude, longitude),
  ]).slice(0, 6);
}

function inferCoordinateAreaTokens(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const tokens = [];
  for (const area of COORDINATE_AREA_FALLBACKS) {
    if (distanceMeters(lat, lon, area.lat, area.lon) <= area.radiusMeters) {
      tokens.push(...area.tokens);
    }
  }
  return uniqueStrings(tokens);
}

async function enrichFlyerLocationLabel(locationLabel, latitude, longitude) {
  const base = String(locationLabel || '').trim();
  const parts = [base];
  if (Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))) {
    parts.push(...inferCoordinateAreaTokens(latitude, longitude));
    if (!extractPostalCodeTokens(base).length) {
      const reverseLabel = await reverseGeocodeFlyerLocationLabel(latitude, longitude).catch(() => '');
      if (reverseLabel) parts.push(reverseLabel);
    }
  }
  return uniqueStrings(parts).join(' ');
}

async function reverseGeocodeFlyerLocationLabel(latitude, longitude) {
  if (typeof fetch !== 'function') return '';
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: String(latitude),
    lon: String(longitude),
    zoom: '18',
    addressdetails: '1',
    'accept-language': 'ja',
  });
  const res = await fetch(`${NOMINATIM_REVERSE_URL}?${params}`, {
    headers: {
      ...HTTP_HEADERS,
      'User-Agent': 'TraperSubot/1.0 (LINE Bot; flyer lookup)',
    },
    signal: AbortSignal.timeout(3500),
  }).catch(() => null);
  if (!res?.ok) return '';
  const data = await res.json().catch(() => null);
  const a = data?.address || {};
  return uniqueStrings([
    formatPostalCode(a.postcode),
    a.province,
    a.state,
    a.city,
    a.city_district,
    a.suburb,
    a.quarter,
    a.neighbourhood,
    a.road,
  ]).join(' ');
}

function formatPostalCode(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 7 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : '';
}

function buildTokubaiSearchFallbackStores(locationLabel, latitude = null, longitude = null) {
  const tokens = getTokubaiAreaSearchTokens(locationLabel, latitude, longitude);
  const stores = tokens.slice(0, 4).map((token, index) => ({
    shopId: `search-${normalize(token) || index}`,
    name: `${token} のTokubai検索結果`,
    address: String(locationLabel || '').trim(),
    url: `${TOKUBAI_SEARCH_URL}?latitude=&longitude=&from=&bargain_keyword=${encodeURIComponent(token)}`,
    distanceMeters: null,
    leafletLinks: [],
  }));
  if (!stores.length && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))) {
    stores.push({
      shopId: 'search-current-location',
      name: '現在地周辺のTokubai検索結果',
      address: String(locationLabel || '').trim(),
      url: `${TOKUBAI_SEARCH_URL}?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`,
      distanceMeters: null,
      leafletLinks: [],
    });
  }
  return stores;
}

function buildCandidateOnlySnapshot({ source, dayKey, locationLabel, latitude, longitude, stores = [], favoriteStores = [] } = {}) {
  const displayStores = stores.slice(0, 5).map((store, index) => ({
    rank: index + 1,
    shopId: store.shopId || '',
    name: store.name,
    address: store.address || '',
    url: store.url || '',
    distanceMeters: store.distanceMeters ?? null,
    leafletLinks: Array.isArray(store.leafletLinks) ? store.leafletLinks.slice(0, 3) : [],
    avgItemPrice: null,
    isChosen: index === 0,
    isFavorite: false,
    items: [],
    itemCount: 0,
  }));
  return {
    source,
    dayKey,
    locationLabel,
    queryLocation: { latitude, longitude, label: locationLabel || '' },
    store: displayStores[0] ? {
      shopId: displayStores[0].shopId,
      name: displayStores[0].name,
      address: displayStores[0].address,
      distanceMeters: displayStores[0].distanceMeters,
      url: displayStores[0].url,
      leafletLinks: displayStores[0].leafletLinks,
    } : null,
    items: [],
    competitors: displayStores.slice(1).map(store => ({
      shopId: store.shopId,
      name: store.name,
      distanceMeters: store.distanceMeters,
      url: store.url,
      avgItemPrice: null,
    })),
    ingredientComparisons: {},
    stores: displayStores,
    favoriteShopIds: favoriteStores.slice(0, 2).map(store => String(store.shopId || store.url || '')).filter(Boolean),
    fetchedAt: Date.now(),
    fetchedAtIso: new Date().toISOString(),
  };
}

function parseTokubaiSearchResults(html) {
  const oldMatches = [...String(html || '').matchAll(
    /<li[^>]*\bid='shop_(\d+)'[^>]*>[\s\S]*?<a class="shop_name" href="([^"]+)">([^<]+)<\/a>[\s\S]*?<div class='address'>\s*([\s\S]*?)\s*<\/div>/g
  )];
  const oldResults = oldMatches.map(match => ({
    shopId: match[1],
    url: new URL(match[2], 'https://tokubai.co.jp').toString(),
    name: decodeHtml(match[3]).trim(),
    address: decodeHtml(stripTags(match[4])).trim(),
  }));

  const currentMatches = [...String(html || '').matchAll(
    /<li[^>]*\bid=['"]shop_(\d+)['"][^>]*>\s*<a href=['"]([^'"]+)['"][^>]*>[\s\S]*?<span class=['"]shop_name['"]>\s*([\s\S]*?)\s*<span class=['"]small['"][\s\S]*?<\/span>\s*<\/span>[\s\S]*?<div class=['"]shop_address['"]>\s*([\s\S]*?)\s*<\/div>/g
  )];
  const currentResults = currentMatches.map(match => ({
    shopId: match[1],
    url: new URL(match[2], 'https://tokubai.co.jp').toString(),
    name: decodeHtml(stripTags(match[3])).trim(),
    address: decodeHtml(stripTags(match[4])).trim(),
  }));

  const seen = new Set();
  return [...oldResults, ...currentResults].filter(store => {
    if (!store.shopId || seen.has(store.shopId)) return false;
    seen.add(store.shopId);
    return true;
  });
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
  const branch = normalizeStoreBranch(candidate?.branch);
  if (branch && resultName.includes(branch)) score += 36;
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
  const leafletLinks = parseTokubaiLeafletLinks(html, tokubaiStore.url).slice(0, 3);
  let items = parseTokubaiStoreItems(html, tokubaiStore.url);
  let source = 'tokubai-html';
  if (!items.length) {
    items = await extractTokubaiLeafletItemsWithGemini(html, tokubaiStore.url).catch(() => []);
    if (items.length) source = 'tokubai-leaflet-gemini';
  }
  if (!items.length) source = leafletLinks.length ? 'tokubai-leaflet-links' : 'tokubai-store-link';
  return {
    store: {
      shopId: tokubaiStore.shopId || '',
      name: tokubaiStore.name,
      address: tokubaiStore.address,
      url: tokubaiStore.url,
      distanceMeters: nearbyStore?.distanceMeters || null,
    },
    items,
    leafletLinks,
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
        maxOutputTokens: 800,
        thinkingConfig: { thinkingBudget: 0 },
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
    /<a class="image_element[^"]*"[^>]*href="([^"]*\/leaflets\/\d+[^"]*)"/g
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
  const src = html.match(/data-src="(https?:\/\/[^"]*\/bargain_office_leaflets\/o=true\/[^"]+)"/)?.[1]
    || html.match(/<img[^>]*class="leaflet_image[^"]*"[^>]*data-src="([^"]+)"/)?.[1]
    || html.match(/<img class="leaflet transparent"[^>]*src="([^"]+)"/)?.[1]
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

function getCurrentSeason() {
  const month = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCMonth() + 1;
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'fall';
  return 'winter';
}

function buildFallbackRecipe(snapshot, excludedTitles = [], filters = {}) {
  const season = getCurrentSeason();
  const excluded = new Set((excludedTitles || []).map(t => normalize(t)));
  const allRecipes = [...RECIPE_LIBRARY, ...FALLBACK_RECIPE_LIBRARY];
  const pool = allRecipes.filter(r => !excluded.has(normalize(r.title)));

  // ジャンル・食材フィルタ（段階的フォールバック）
  let filtered = pool;
  if (filters.genre || filters.mainIngredient) {
    const byGenre = filters.genre ? pool.filter(r => r.genre === filters.genre) : pool;
    const byBoth = filters.mainIngredient ? byGenre.filter(r => r.mainIngredient === filters.mainIngredient) : byGenre;
    if (byBoth.length) filtered = byBoth;
    else if (byGenre.length) filtered = byGenre;
    // マッチなし → 全プールにフォールバック（filtered のまま pool）
  }

  const seasonal = filtered.filter(r => r.season === season || r.season === 'all' || !r.season);
  const candidates = seasonal.length ? seasonal : filtered.length ? filtered : pool;
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
  return target ? enrichRecipePricing({ ...target, source: 'fallback-library' }, snapshot) : null;
}

function enrichRecipePricing(recipe, snapshot) {
  const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  const enrichedIngredients = ingredients.map(ingredient => enrichIngredientPrice(ingredient, snapshot));
  const estimatedTotalPrice = recipe?.estimatedTotalPrice || buildRecipeTotalPriceText(enrichedIngredients);
  return {
    ...recipe,
    ingredients: enrichedIngredients,
    estimatedTotalPrice,
  };
}

function enrichIngredientPrice(ingredient, snapshot) {
  const name = String(ingredient?.name || '').trim();
  if (!name) return { ...ingredient };

  const keyName = getIngredientKeyName(name);
  const market = estimateMarketPrice(name, ingredient);
  const comparisonEntry = findBestComparisonEntry(snapshot, keyName, name);
  const sourcePriceText = comparisonEntry
    ? `近くの特売 ${comparisonEntry.priceText}${comparisonEntry.storeName ? ` (${comparisonEntry.storeName})` : ''}`
    : market?.referenceText || String(ingredient?.sourcePriceText || '').trim();

  return {
    ...ingredient,
    keyName,
    estimatedPriceText: market?.priceText || normalizePricePlaceholder(ingredient?.estimatedPriceText),
    sourcePriceText,
  };
}

function buildRecipeTotalPriceText(ingredients) {
  const ranges = ingredients
    .map(ingredient => extractPriceRange(ingredient?.estimatedPriceText))
    .filter(Boolean);
  if (!ranges.length) return '';
  const min = ranges.reduce((sum, range) => sum + range.min, 0);
  const max = ranges.reduce((sum, range) => sum + range.max, 0);
  return min === max ? `約${min}円` : `約${min}〜${max}円`;
}

function estimateMarketPrice(name, ingredient) {
  const rule = findMarketPriceRule(name);
  if (!rule) return null;

  const factor = estimateIngredientFactor(ingredient, rule.per);
  const min = Math.max(1, Math.round(rule.min * factor));
  const max = Math.max(min, Math.round(rule.max * factor));
  return {
    keyName: rule.label,
    min,
    max,
    priceText: formatPriceRange(min, max),
    referenceText: `東京相場 ${rule.per} ${rule.min}〜${rule.max}円`,
  };
}

function findMarketPriceRule(name) {
  const normalizedName = normalize(name);
  return INGREDIENT_MARKET_PRICE_TABLE.find(rule =>
    rule.keys.some(key => normalizedName.includes(normalize(key)) || normalize(key).includes(normalizedName))
  ) || null;
}

function getIngredientKeyName(name) {
  const rule = findMarketPriceRule(name);
  if (rule?.label) return rule.label;
  return String(name || '').replace(/\s+/g, '').slice(0, 24);
}

function estimateIngredientFactor(ingredient, rulePer) {
  const base = parseRulePer(rulePer);
  const current = parseIngredientVolume(ingredient);
  if (!base || !current) return 1;
  if (normalizeUnit(base.unit) !== normalizeUnit(current.unit)) return 1;
  return clampNumber(current.value / base.value, 0.5, 3);
}

function parseRulePer(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fraction = raw.match(/^(\d+)\/(\d+)(.+)$/);
  if (fraction) {
    return { value: Number(fraction[1]) / Number(fraction[2]), unit: fraction[3] };
  }
  const numeric = raw.match(/^(\d+(?:\.\d+)?)(.+)$/);
  if (numeric) {
    return { value: Number(numeric[1]), unit: numeric[2] };
  }
  return { value: 1, unit: raw };
}

function parseIngredientVolume(ingredient) {
  const amount = Number(String(ingredient?.amount || '').replace(/[^\d.]/g, ''));
  const unit = String(ingredient?.unit || '').trim();
  if (Number.isFinite(amount) && amount > 0 && unit) {
    return { value: amount, unit };
  }

  const countText = String(ingredient?.countText || '').trim();
  const fraction = countText.match(/^(\d+)\/(\d+)(.+)$/);
  if (fraction) {
    return { value: Number(fraction[1]) / Number(fraction[2]), unit: fraction[3] };
  }
  const numeric = countText.match(/^(\d+(?:\.\d+)?)(.+)$/);
  if (numeric) {
    return { value: Number(numeric[1]), unit: numeric[2] };
  }
  return null;
}

function normalizeUnit(unit) {
  return String(unit || '')
    .replace(/\s+/g, '')
    .replace(/グラム/g, 'g')
    .replace(/ｇ/g, 'g')
    .replace(/本分/g, '本')
    .replace(/束分/g, '束')
    .replace(/パック分/g, 'パック')
    .replace(/切れ/g, '切')
    .replace(/枚分/g, '枚')
    .replace(/個分/g, '個');
}

function formatPriceRange(min, max) {
  if (min === max) return `約${min}円`;
  if (max - min <= 20) return `約${Math.round((min + max) / 2)}円`;
  return `約${min}〜${max}円`;
}

function normalizePricePlaceholder(value) {
  const text = String(value || '').trim();
  if (!text || text === 'チラシ価格') return '相場を確認中';
  return text;
}

function extractPriceRange(text) {
  const raw = String(text || '').replace(/,/g, '');
  const range = raw.match(/(\d+)\D+(\d+)円/);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
  }
  const single = raw.match(/(\d+)円/);
  if (single) {
    const value = Number(single[1]);
    return Number.isFinite(value) ? { min: value, max: value } : null;
  }
  return null;
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

function buildIngredientComparisons(storeSnapshots = []) {
  const map = {};
  for (const snapshot of storeSnapshots) {
    for (const item of snapshot?.items || []) {
      const keyName = getIngredientKeyName(item?.name);
      if (!keyName) continue;
      const numericPrice = extractItemPrice(item?.mainPriceText || item?.priceText || '');
      const entry = {
        keyName,
        itemName: item.name,
        storeName: snapshot?.store?.name || '',
        storeUrl: snapshot?.store?.url || '',
        distanceMeters: snapshot?.store?.distanceMeters ?? null,
        priceText: item.mainPriceText || item.priceText || '',
        numericPrice: numericPrice || null,
        unitText: item.unitText || '',
        taxIncludedText: item.taxIncludedText || '',
      };
      if (!map[keyName]) map[keyName] = [];
      map[keyName].push(entry);
    }
  }

  for (const keyName of Object.keys(map)) {
    map[keyName] = map[keyName]
      .sort((left, right) => {
        const lp = Number.isFinite(left.numericPrice) ? left.numericPrice : Infinity;
        const rp = Number.isFinite(right.numericPrice) ? right.numericPrice : Infinity;
        if (lp !== rp) return lp - rp;
        const ld = Number.isFinite(left.distanceMeters) ? left.distanceMeters : Infinity;
        const rd = Number.isFinite(right.distanceMeters) ? right.distanceMeters : Infinity;
        return ld - rd;
      })
      .slice(0, 3);
  }

  return map;
}

function buildIngredientHistoryEntries(storeSnapshots = [], dayKey = '') {
  const entries = [];
  for (const snapshot of storeSnapshots) {
    for (const item of snapshot?.items || []) {
      const keyName = getIngredientKeyName(item?.name);
      const numericPrice = extractItemPrice(item?.mainPriceText || item?.priceText || '');
      if (!keyName || !numericPrice) continue;
      entries.push({
        keyName,
        dayKey,
        itemName: item.name,
        storeName: snapshot?.store?.name || '',
        storeUrl: snapshot?.store?.url || '',
        unitText: item.unitText || '',
        priceText: item.mainPriceText || item.priceText || '',
        numericPrice,
        distanceMeters: snapshot?.store?.distanceMeters ?? null,
      });
    }
  }
  return entries;
}

function dedupeStoreSnapshots(storeSnapshots = []) {
  const seen = new Set();
  const result = [];
  for (const snapshot of storeSnapshots) {
    const url = String(snapshot?.store?.url || '').trim();
    const name = normalize(snapshot?.store?.name || '');
    const key = url || `name:${name}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(snapshot);
  }
  return result;
}

function serializeStoreSnapshotForDisplay(snapshot, { rank = 1, chosenUrl = '', favoriteUrlSet = new Set() } = {}) {
  const url = String(snapshot?.store?.url || '').trim();
  const favorite = favoriteUrlSet.has(url);
  const items = Array.isArray(snapshot?.items) ? snapshot.items.slice(0, 8) : [];
  const avgItemPrice = items.length ? computeAvgItemPrice(items) : null;
  return {
    rank,
    shopId: snapshot?.store?.shopId || '',
    name: snapshot?.store?.name || '',
    address: snapshot?.store?.address || '',
    url,
    distanceMeters: snapshot?.store?.distanceMeters ?? null,
    leafletLinks: Array.isArray(snapshot?.leafletLinks) ? snapshot.leafletLinks.slice(0, 3) : [],
    avgItemPrice: Number.isFinite(avgItemPrice) && avgItemPrice < 99999 ? avgItemPrice : null,
    isChosen: !!chosenUrl && chosenUrl === url,
    isFavorite: favorite,
    items,
    itemCount: Array.isArray(snapshot?.items) ? snapshot.items.length : items.length,
  };
}

function findStoreEntry(snapshot, rank = null, url = '') {
  const stores = Array.isArray(snapshot?.stores) ? snapshot.stores : [];
  const hasRank = rank !== null && rank !== undefined && rank !== '' && Number.isFinite(Number(rank));
  if (hasRank) {
    return stores.find(store => Number(store.rank) === Number(rank)) || null;
  }
  if (url) {
    return stores.find(store => String(store.url || '').trim() === String(url || '').trim()) || null;
  }
  return null;
}

async function addFavoriteStoreFromSnapshot(sourceId, snapshot, rank = 1) {
  const store = findStoreEntry(snapshot, rank);
  if (!store?.shopId && !store?.url) return null;
  if (!looksLikeFoodStore(store.name)) return null;
  return saveFlyerFavoriteStore(sourceId, {
    shopId: store.shopId || store.url,
    name: store.name,
    address: store.address,
    url: store.url,
    distanceMeters: store.distanceMeters,
  });
}

async function removeFavoriteStoreFromSnapshot(sourceId, snapshot, rank = 1) {
  const store = findStoreEntry(snapshot, rank);
  if (!store?.shopId && !store?.url) return false;
  return removeFlyerFavoriteStore(sourceId, store.shopId || store.url);
}

function formatFavoriteStoreListReply(favorites = []) {
  const foodFavorites = favorites.filter(store => looksLikeFoodStore(store?.name));
  if (!foodFavorites.length) {
    return '今はお気に入り店はまだ入ってないよ。近くのチラシを見たあとに「1番をお気に入り」みたいに言ってくれたら、比較対象として覚えておくね。';
  }
  const lines = ['今覚えているお気に入り店はこの2件までだよ。'];
  foodFavorites.slice(0, 2).forEach((store, index) => {
    lines.push(`・${index + 1}. ${store.name}${formatDistance(store.distanceMeters)}${store.address ? ` / ${store.address}` : ''}`);
  });
  lines.push('外したい時は、近くのチラシを出したあとで「1番をお気に入り解除」みたいに言ってね。');
  return lines.join('\n');
}

function formatStoreSalesReply(snapshot, rank = 1) {
  const store = findStoreEntry(snapshot, rank);
  if (!store) {
    return 'その番号のお店がまだ見つからなかったの。先に「近くのチラシ」でもう一回一覧を出してから、番号で呼んでね。';
  }
  const lines = [
    `${store.name}${formatDistance(store.distanceMeters)}の特売メモだよ。`,
    store.address || '',
    store.url ? `チラシ: ${store.url}` : '',
    '',
  ].filter(Boolean);
  (store.items || []).slice(0, 8).forEach(item => {
    lines.push(`・${item.name} — ${item.unitText || '単位不明'} / ${item.mainPriceText || item.priceText || '価格不明'}${item.taxIncludedText ? ` (${item.taxIncludedText})` : ''}`);
  });
  if (!Array.isArray(store.items) || !store.items.length) {
    const leaflets = Array.isArray(store.leafletLinks) ? store.leafletLinks.filter(Boolean).slice(0, 3) : [];
    if (leaflets.length) {
      lines.push('価格リストの自動読み取りはまだ不安定だけど、チラシ画像はここから見られるよ。');
      leaflets.forEach((url, index) => lines.push(`・チラシ画像${index + 1}: ${url}`));
    } else {
      lines.push('価格リストの自動読み取りはまだ不安定だけど、上の店舗ページからチラシを確認できるよ。');
    }
  }
  if (store.itemCount > (store.items || []).length) {
    lines.push(`…ほか ${store.itemCount - store.items.length}件`);
  }
  return lines.join('\n');
}

function findBestComparisonEntry(snapshot, keyName, ingredientName = '') {
  const candidates = snapshot?.ingredientComparisons?.[keyName] || [];
  if (candidates.length) return candidates[0];

  const fallbackKey = getIngredientKeyName(ingredientName);
  const fallbackCandidates = snapshot?.ingredientComparisons?.[fallbackKey] || [];
  return fallbackCandidates[0] || null;
}

function buildIngredientPriceFlex(snapshot, recipe) {
  const buttons = (recipe?.ingredients || [])
    .filter(ingredient => !isPantryIngredient(ingredient?.name))
    .slice(0, 6)
    .map(ingredient => buildIngredientButton(ingredient))
    .filter(Boolean);
  if (!buttons.length) return null;

  return {
    type: 'flex',
    altText: `${recipe?.title || 'レシピ'}の材料価格`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'text',
            text: '材料の値段を見る',
            weight: 'bold',
            size: 'lg',
          },
          {
            type: 'text',
            text: '押すと近くのお店の比較と最近の推移を返すよ。',
            size: 'sm',
            color: '#666666',
            wrap: true,
          },
          ...buttons,
        ],
      },
    },
  };
}

function buildIngredientButton(ingredient) {
  const keyName = getIngredientKeyName(ingredient?.name);
  if (!keyName) return null;
  const label = clipButtonLabel(`${ingredient.name} ${ingredient.estimatedPriceText || ''}`.trim());
  const data = `flyer:ingredient:${encodeURIComponent(keyName)}:${encodeURIComponent(String(ingredient.name || '').trim())}`;
  return {
    type: 'button',
    style: 'secondary',
    height: 'sm',
    action: {
      type: 'postback',
      label,
      data,
      displayText: `${ingredient.name}の値段`,
    },
  };
}

async function buildIngredientPriceDrilldownReply(sourceId, keyName, ingredientName = '') {
  const snapshot = await getNearbyFlyerSnapshot({ sourceId }).catch(() => null);
  const history = await getIngredientPriceHistory(keyName, 30).catch(() => []);
  const comparisons = snapshot?.ingredientComparisons?.[keyName] || [];
  const marketRule = findMarketPriceRule(ingredientName || keyName);
  const lines = [`${ingredientName || keyName}の値段メモだよ。`];

  if (comparisons.length) {
    lines.push('');
    lines.push('近くのお店の比較:');
    comparisons.forEach((entry, index) => {
      const head = index === 0 ? '◎' : '・';
      const text = [
        `${head} ${entry.storeName || '近くのお店'}`,
        formatDistance(entry.distanceMeters),
        ` ${entry.priceText || '価格不明'}`,
        entry.unitText ? ` / ${entry.unitText}` : '',
      ].join('');
      lines.push(text.trim());
    });
  }

  if (marketRule) {
    lines.push('');
    lines.push(`東京スーパー相場のめやす: ${marketRule.per} ${marketRule.min}〜${marketRule.max}円`);
  }

  const recentHistory = compressIngredientHistory(history).slice(0, 6);
  if (recentHistory.length) {
    lines.push('');
    lines.push('最近の推移:');
    recentHistory.forEach(entry => {
      lines.push(`・${formatHistoryDay(entry.dayKey)} ${entry.storeName || '記録'} ${entry.priceText || `${entry.numericPrice}円`}${entry.unitText ? ` / ${entry.unitText}` : ''}`);
    });
  } else {
    lines.push('');
    lines.push('まだ履歴が少ないから、これから少しずつ覚えていくね。');
  }

  return lines.join('\n');
}

function compressIngredientHistory(history = []) {
  const seen = new Set();
  const result = [];
  for (const entry of history) {
    const key = `${entry.dayKey}|${entry.storeName}|${entry.priceText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function formatHistoryDay(dayKey) {
  const value = String(dayKey || '');
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${Number(match[2])}/${Number(match[3])}`;
}

function isPantryIngredient(name) {
  const normalized = normalize(name);
  if (!normalized) return false;
  return PANTRY_KEYWORDS.some(keyword => normalized.includes(normalize(keyword)));
}

function clipButtonLabel(text) {
  const value = String(text || '').trim();
  return value.length <= 20 ? value : `${value.slice(0, 19)}…`;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function shouldReuseCachedSnapshot(snapshot, latitude, longitude, favoriteStores = []) {
  if (!snapshot?.store?.url || !Array.isArray(snapshot?.items) || !snapshot.items.length) return false;
  // competitors フィールドがない旧フォーマットは再取得する
  if (!Array.isArray(snapshot.competitors)) return false;
  if (!Array.isArray(snapshot.stores) || !snapshot.stores.length) return false;
  const cachedFavoriteIds = (snapshot.favoriteShopIds || []).map(value => String(value || '')).filter(Boolean).sort().join('|');
  const currentFavoriteIds = favoriteStores.map(store => String(store?.shopId || store?.url || '')).filter(Boolean).sort().join('|');
  if (cachedFavoriteIds !== currentFavoriteIds) return false;
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

function looksLikeFoodStore(name) {
  if (!name) return false;
  const normalized = String(name || '').normalize('NFKC');
  if (/(セブンイレブン|セブン-イレブン|ファミリーマート|ファミマ|ローソン|ミニストップ|デイリーヤマザキ|ニューヤマザキ|ポプラ|コンビニ|Lawson|FamilyMart|7-Eleven|LAWSON STORE 100|ローソンストア100)/i.test(normalized)) return false;
  if (/おそうじ|クリーニング|クリーンプラザ|ホワイト急便|スワローチェーン|学研|くもん|公文|BE studio|スタジオ|塾|整骨|接骨|歯科|クリニック|病院|医院|美容院|美容室|サロン|ヘアカット|眼科|耳鼻|皮膚科|保険|不動産|ハウス|AOKI|フィットネス|エニタイム|ジム|chocoZAP|チョコザップ|ドラッグ|どらっぐ|薬局|ぱぱす|マツモトキヨシ|ウエルシア|スギ薬局|ココカラファイン|ツルハ|サンドラッグ|クリエイト|ガスト|ファミレス|レストラン|居酒屋|カフェ|なんでも酒や|カクヤス|酒や|リカー|ラクーン/.test(normalized)) return false;
  return true;
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
    tags['addr:quarter'],
    tags['addr:neighbourhood'],
    tags['addr:street'],
    tags['addr:block_number'],
    tags['addr:housenumber'],
  ].filter(Boolean).join('');
}

function normalizeStoreBranch(value) {
  return normalize(value).replace(/(駅前)?店$/, '');
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
  buildIngredientPriceFlex,
  buildIngredientPriceDrilldownReply,
  addFavoriteStoreFromSnapshot,
  removeFavoriteStoreFromSnapshot,
  formatFavoriteStoreListReply,
  formatStoreSalesReply,
};
