'use strict';

const { randomUUID } = require('crypto');
const { getTokyoDateParts } = require('./date-utils');
const {
  getGeoGameConfig,
  getGeoGame,
  saveGeoGame,
  saveGeoGameAnswer,
  finishGeoGame,
  reserveGeoGameStart,
  getGeoGameGeocodeCache,
  saveGeoGameGeocodeCache,
} = require('./firebase-admin');

const COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php';
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const GEOCODE_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const NOMINATIM_MIN_INTERVAL_MS = 1100;

const TOKYO_BOUNDS = {
  minLat: 35.49,
  maxLat: 35.84,
  minLng: 139.45,
  maxLng: 139.93,
};

const TOKYO_SEEDS = [
  { label: '東京駅', lat: 35.681236, lng: 139.767125 },
  { label: '銀座', lat: 35.671989, lng: 139.764936 },
  { label: '日本橋', lat: 35.684067, lng: 139.774503 },
  { label: '秋葉原', lat: 35.698353, lng: 139.773114 },
  { label: '上野', lat: 35.713768, lng: 139.777254 },
  { label: '浅草', lat: 35.714765, lng: 139.796655 },
  { label: '押上', lat: 35.710063, lng: 139.8107 },
  { label: '両国', lat: 35.696709, lng: 139.793177 },
  { label: 'お台場', lat: 35.627381, lng: 139.776549 },
  { label: '豊洲', lat: 35.655021, lng: 139.796659 },
  { label: '東京タワー', lat: 35.658581, lng: 139.745433 },
  { label: '六本木', lat: 35.662836, lng: 139.731443 },
  { label: '表参道', lat: 35.665247, lng: 139.712314 },
  { label: '原宿', lat: 35.670168, lng: 139.702687 },
  { label: '渋谷', lat: 35.658034, lng: 139.701636 },
  { label: '新宿', lat: 35.689592, lng: 139.700413 },
  { label: '神楽坂', lat: 35.703742, lng: 139.734173 },
  { label: '池袋', lat: 35.729503, lng: 139.7109 },
  { label: '品川', lat: 35.628471, lng: 139.73876 },
  { label: '目黒', lat: 35.633998, lng: 139.715828 },
  { label: '中野', lat: 35.706032, lng: 139.665652 },
  { label: '吉祥寺', lat: 35.702258, lng: 139.57979 },
];

const revealTimers = new Map();
let lastNominatimAt = 0;
let nominatimQueue = Promise.resolve();

function detectGeoGameIntent(text) {
  const raw = String(text || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  if (!raw) return null;
  const t = raw.replace(/^(@?秘書トラペル子)/, '');
  const gamePrefix = /^(ジオゲーム|場所当て|場所あて|ここどこ|地理ゲーム|geogame|geo)/;
  const shortStart = /^(ジオゲーム|場所当て|場所あて|ここどこ|地理ゲーム|geogame|geo)$/;

  if (shortStart.test(t) || (gamePrefix.test(t) && /(開始|スタート|やろ|やる|出題|問題|遊ぼ)/.test(t))) {
    return { type: 'geoGame', action: 'start' };
  }

  const body = t.replace(gamePrefix, '');
  if (/^(正解|結果|答え合わせ|答え教えて|終了|締切|しめきり|ギブアップ|答え$)/.test(body)) {
    return { type: 'geoGame', action: 'reveal' };
  }
  if (/^(中止|キャンセル|やめ|終了して)$/.test(body)) {
    return { type: 'geoGame', action: 'cancel' };
  }
  if (/^(状況|状態|ステータス|残り時間)$/.test(body)) {
    return { type: 'geoGame', action: 'status' };
  }

  const answerMatch = body.match(/^(回答|予想|推理|場所|guess|answer)[:：]?(.*)$/);
  if (answerMatch) {
    return { type: 'geoGame', action: 'answer', answer: answerMatch[2] || '' };
  }

  return null;
}

async function handleGeoGameIntent({ event, client, sourceId, senderName, intent }) {
  if (!sourceId) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ジオゲームはグループかトークの場所が分かる時だけ始められるよ。もう一回呼んでね。',
    });
  }

  if (intent.action === 'start') {
    return startGeoGame({ event, client, sourceId, senderName });
  }
  if (intent.action === 'answer') {
    return answerGeoGame({ event, client, sourceId, senderName, answerText: intent.answer });
  }
  if (intent.action === 'reveal') {
    return revealGeoGame({ event, client, sourceId, auto: false });
  }
  if (intent.action === 'cancel') {
    return cancelGeoGame({ event, client, sourceId });
  }
  if (intent.action === 'status') {
    return showGeoGameStatus({ event, client, sourceId });
  }

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: 'ジオゲームは「ジオゲーム」「回答 新宿駅」「正解」で動くよ。私と一緒に遊んでくれるの、ちょっと楽しみ。',
  });
}

async function startGeoGame({ event, client, sourceId, senderName }) {
  const config = normalizeGeoGameConfig(await getGeoGameConfig());
  if (!config.enabled) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ジオゲームは今OFFになってるよ。config/geoGame/enabled を true にしたら、すぐ出題できるようにしておくね。',
    });
  }

  const current = await getGeoGame(sourceId);
  if (isActiveGame(current)) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: formatActiveGameText(current),
    });
  }
  if (current?.status === 'active') {
    await finishGeoGame(sourceId, current, 'expired');
    clearRevealTimer(sourceId);
  }

  const today = getTokyoDateParts();
  const usage = await reserveGeoGameStart(today.date, config.dailyLimit);
  if (!usage.allowed) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: [
        `今日のジオゲームは${usage.limit}回までにしてあるよ。`,
        '無料サービスに負荷をかけないための上限なの。',
        'また明日、私に出題させてね。',
      ].join('\n'),
    });
  }

  let photo;
  try {
    photo = await fetchTokyoCommonsPhoto(config);
  } catch (err) {
    console.error('[geo-game] photo fetch failed', err);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '無料の写真データを取りに行ったんだけど、今はうまく見つけられなかったの。\n少しあとで「ジオゲーム」って呼んで。次はちゃんと出したいな。',
    });
  }

  const now = Date.now();
  const game = {
    id: randomUUID(),
    status: 'active',
    sourceId,
    startedBy: senderName || '不明',
    startedAt: now,
    expiresAt: now + config.answerWindowSeconds * 1000,
    answerWindowSeconds: config.answerWindowSeconds,
    photo,
    answerLat: photo.lat,
    answerLng: photo.lng,
    answers: {},
  };

  await saveGeoGame(sourceId, game);
  scheduleAutoReveal(sourceId, client, game, config);

  return client.replyMessage(event.replyToken, buildStartMessages(game));
}

async function answerGeoGame({ event, client, sourceId, senderName, answerText }) {
  const game = await getGeoGame(sourceId);
  if (!game) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '今はジオゲームが始まってないよ。\n「@秘書トラペル子 ジオゲーム」で、私が都内の写真を出すね。',
    });
  }
  if (!isActiveGame(game)) {
    return revealGeoGame({ event, client, sourceId, auto: false, game });
  }

  const rawAnswer = String(answerText || '').trim();
  if (!rawAnswer) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '回答する場所が空っぽみたい。\n「@秘書トラペル子 回答 新宿駅」みたいに送ってね。',
    });
  }

  let geocoded;
  try {
    geocoded = await geocodeGuess(rawAnswer);
  } catch (err) {
    console.error('[geo-game] geocode failed', err);
  }
  if (!geocoded) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `「${trimText(rawAnswer, 30)}」の場所が見つけられなかったの。\n駅名、ランドマーク名、または「35.658,139.701」みたいな座標で答えてね。`,
    });
  }

  const answerKey = makeAnswerKey(event.source.userId, senderName);
  const previous = game.answers?.[answerKey];
  const distanceMeters = calculateDistanceMeters(
    Number(game.answerLat),
    Number(game.answerLng),
    geocoded.lat,
    geocoded.lng,
  );
  await saveGeoGameAnswer(sourceId, answerKey, {
    userId: event.source.userId || null,
    senderName: senderName || '不明',
    raw: rawAnswer,
    label: geocoded.label,
    displayName: geocoded.displayName || null,
    lat: geocoded.lat,
    lng: geocoded.lng,
    distanceMeters,
    answeredAt: Date.now(),
  });

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: [
      previous ? '回答、上書きして預かったよ。勝ちに来てて好き。' : '回答、ちゃんと預かったよ。',
      `場所は「${trimText(geocoded.label || rawAnswer, 36)}」として受け取ったね。`,
      '距離は正解発表まで内緒。少しだけ、どきどきして待ってて。',
    ].join('\n'),
  });
}

async function revealGeoGame({ event, client, sourceId, auto = false, game = null }) {
  const current = game || await getGeoGame(sourceId);
  if (!current) {
    const text = '今は発表するジオゲームがないよ。\n「@秘書トラペル子 ジオゲーム」で新しい問題を出せるよ。';
    if (auto) return pushText(client, sourceId, text);
    return client.replyMessage(event.replyToken, { type: 'text', text });
  }

  const messages = buildRevealMessages(current, { auto });
  clearRevealTimer(sourceId);
  if (auto) {
    try {
      await client.pushMessage(sourceId, messages);
      await finishGeoGame(sourceId, current, 'finished');
    } catch (err) {
      console.error('[geo-game] auto reveal push failed', err);
    }
    return;
  }

  await finishGeoGame(sourceId, current, 'finished');
  return client.replyMessage(event.replyToken, messages);
}

async function cancelGeoGame({ event, client, sourceId }) {
  const current = await getGeoGame(sourceId);
  if (!current) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '今は止めるジオゲームがないみたい。',
    });
  }
  clearRevealTimer(sourceId);
  await finishGeoGame(sourceId, current, 'canceled');
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: 'ジオゲーム、今回は中止にしたよ。\nまた遊びたくなったら呼んで。私、出題するのけっこう好きかも。',
  });
}

async function showGeoGameStatus({ event, client, sourceId }) {
  const current = await getGeoGame(sourceId);
  if (!current || current.status !== 'active') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '今はジオゲームが始まってないよ。\n「@秘書トラペル子 ジオゲーム」で始められるよ。',
    });
  }
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: formatActiveGameText(current),
  });
}

function buildStartMessages(game) {
  const seconds = Math.ceil((game.expiresAt - Date.now()) / 1000);
  return [
    {
      type: 'image',
      originalContentUrl: game.photo.imageUrl,
      previewImageUrl: game.photo.previewUrl || game.photo.imageUrl,
    },
    {
      type: 'text',
      text: [
        'ジオゲーム開始だよ。',
        'この写真、都内のどこでしょう？',
        `制限時間は${formatSeconds(seconds)}。時間になったら私が自動で正解発表するね。`,
        '',
        '回答例:',
        '@秘書トラペル子 回答 新宿駅',
        '@秘書トラペル子 回答 35.658,139.701',
        '',
        '写真はWikimedia Commonsの位置情報付き画像から選んでるよ。出典とライセンスは正解発表で出すね。',
      ].join('\n'),
    },
  ];
}

function buildRevealMessages(game, { auto = false } = {}) {
  const photo = game.photo || {};
  const answers = Object.values(game.answers || {})
    .filter(answer => Number.isFinite(Number(answer.distanceMeters)))
    .sort((a, b) => (a.distanceMeters - b.distanceMeters) || ((a.answeredAt || 0) - (b.answeredAt || 0)));

  const lines = [
    auto ? '時間になったから、ジオゲームの正解発表だよ。' : 'ジオゲーム、正解発表だよ。',
    `正解座標: ${formatCoord(game.answerLat, game.answerLng)}`,
    `地図: ${buildOpenStreetMapUrl(game.answerLat, game.answerLng)}`,
    '',
  ];

  if (!answers.length) {
    lines.push('今回は回答がなかったみたい。次は私に勝負させてね。');
  } else {
    const top = answers[0];
    lines.push(`一番近かったのは ${top.senderName || '誰か'}さん。誤差は${formatDistance(top.distanceMeters)}。`);
    lines.push('ちゃんと狙ってきた感じ、ちょっとかっこよかった。');
    lines.push('');
    lines.push('結果');
    answers.slice(0, 10).forEach((answer, index) => {
      lines.push(`${index + 1}位 ${answer.senderName || '不明'}さん: ${formatDistance(answer.distanceMeters)}（${trimText(answer.raw || answer.label, 24)}）`);
    });
  }

  lines.push('');
  lines.push('写真情報');
  lines.push(`タイトル: ${trimText(photo.title || 'Wikimedia Commons image', 80)}`);
  if (photo.author) lines.push(`作者: ${trimText(photo.author, 80)}`);
  if (photo.license) lines.push(`ライセンス: ${trimText(photo.license, 80)}`);
  if (photo.pageUrl) lines.push(`出典: ${photo.pageUrl}`);
  lines.push('座標と回答検索にはOpenStreetMap系の無料データを使ってるよ。');

  return { type: 'text', text: lines.join('\n').slice(0, 4900) };
}

function formatActiveGameText(game) {
  const remainingMs = Math.max(0, Number(game.expiresAt) - Date.now());
  const answerCount = Object.keys(game.answers || {}).length;
  return [
    'ジオゲームは進行中だよ。',
    `残り時間: ${formatSeconds(Math.ceil(remainingMs / 1000))}`,
    `回答数: ${answerCount}件`,
    '',
    '回答は「@秘書トラペル子 回答 渋谷駅」みたいに送ってね。',
    '「@秘書トラペル子 正解」で手動発表もできるよ。',
  ].join('\n');
}

async function fetchTokyoCommonsPhoto(config) {
  const seeds = shuffle(TOKYO_SEEDS);
  const attempts = Math.min(config.maxPhotoSearchAttempts, seeds.length);
  for (let i = 0; i < attempts; i += 1) {
    const seed = seeds[i];
    const candidates = await fetchCommonsCandidates(seed, config);
    if (!candidates.length) continue;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  throw new Error('No Wikimedia Commons geotagged image found in Tokyo seeds');
}

async function fetchCommonsCandidates(seed, config) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'geosearch',
    ggscoord: `${seed.lat}|${seed.lng}`,
    ggsradius: String(config.radiusMeters),
    ggslimit: String(config.commonsLimit),
    ggsnamespace: '6',
    prop: 'imageinfo|coordinates',
    iiprop: 'url|mime|extmetadata',
    iiurlwidth: String(config.imageWidth),
    format: 'json',
    origin: '*',
  });
  const json = await fetchJson(`${COMMONS_API_URL}?${params.toString()}`, {
    'User-Agent': getUserAgent(),
  });
  const pages = Object.values(json?.query?.pages || {});
  return shuffle(pages.map(page => normalizeCommonsPage(page, seed)).filter(Boolean));
}

function normalizeCommonsPage(page, seed) {
  const image = page?.imageinfo?.[0];
  if (!image) return null;

  const title = String(page.title || '');
  if (/(?:map|地図|locator|diagram|schema|route|flag|logo|icon|seal|symbol|svg|pdf|karte)/i.test(title)) {
    return null;
  }

  const mime = String(image.mime || '').toLowerCase();
  if (mime && !['image/jpeg', 'image/png'].includes(mime)) return null;

  const ext = image.extmetadata || {};
  const coord = page.coordinates?.[0] || {};
  const lat = Number(coord.lat ?? metaValue(ext.GPSLatitude));
  const lng = Number(coord.lon ?? metaValue(ext.GPSLongitude));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !isWithinTokyoBounds(lat, lng)) return null;

  const imageUrl = image.thumburl || image.url;
  if (!imageUrl || !/^https:\/\//.test(imageUrl)) return null;

  return {
    title: cleanTitle(metaValue(ext.ObjectName) || title),
    imageUrl,
    previewUrl: image.thumburl || imageUrl,
    pageUrl: image.descriptionurl || image.descriptionshorturl || null,
    author: stripHtml(metaValue(ext.Artist)),
    credit: stripHtml(metaValue(ext.Credit)),
    license: stripHtml(metaValue(ext.LicenseShortName) || metaValue(ext.UsageTerms)),
    licenseUrl: metaValue(ext.LicenseUrl) || null,
    lat,
    lng,
    seed: seed.label,
  };
}

async function geocodeGuess(query) {
  const direct = parseCoordinateGuess(query);
  if (direct) return direct;

  const normalized = String(query || '').normalize('NFKC').trim();
  if (!normalized) return null;
  const cacheKey = makeCacheKey(normalized);
  const cached = await getGeoGameGeocodeCache(cacheKey);
  if (cached && Date.now() - Number(cached.savedAt || 0) < GEOCODE_CACHE_TTL) {
    return {
      lat: Number(cached.lat),
      lng: Number(cached.lng),
      label: cached.label,
      displayName: cached.displayName,
      provider: 'nominatim-cache',
    };
  }

  const searchQuery = /東京|東京都|tokyo/i.test(normalized) ? normalized : `${normalized} 東京`;
  const params = new URLSearchParams({
    format: 'jsonv2',
    q: searchQuery,
    limit: '1',
    countrycodes: 'jp',
    'accept-language': 'ja',
    viewbox: `${TOKYO_BOUNDS.minLng},${TOKYO_BOUNDS.maxLat},${TOKYO_BOUNDS.maxLng},${TOKYO_BOUNDS.minLat}`,
  });
  const results = await fetchNominatimJson(`${NOMINATIM_SEARCH_URL}?${params.toString()}`, {
    'User-Agent': getUserAgent(),
    Referer: process.env.GEOGAME_REFERER || 'https://naotaxy.github.io/winning-roulette/',
  });
  const first = Array.isArray(results) ? results[0] : null;
  if (!first) return null;

  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const geocoded = {
    lat,
    lng,
    label: first.name || normalized,
    displayName: first.display_name || null,
    provider: 'nominatim',
  };
  await saveGeoGameGeocodeCache(cacheKey, geocoded);
  return geocoded;
}

async function fetchNominatimJson(url, headers) {
  const run = nominatimQueue.then(async () => {
    const waitMs = NOMINATIM_MIN_INTERVAL_MS - (Date.now() - lastNominatimAt);
    if (waitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    lastNominatimAt = Date.now();
    return fetchJson(url, headers);
  });
  nominatimQueue = run.catch(() => {});
  return run;
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function scheduleAutoReveal(sourceId, client, game, config) {
  clearRevealTimer(sourceId);
  if (!config.autoReveal) return;
  const delayMs = Math.max(1500, Number(game.expiresAt) - Date.now() + 1000);
  const timer = setTimeout(async () => {
    try {
      const current = await getGeoGame(sourceId);
      if (!current || current.id !== game.id || current.status !== 'active') return;
      if (Date.now() < Number(current.expiresAt)) return;
      await revealGeoGame({ client, sourceId, auto: true, game: current });
    } catch (err) {
      console.error('[geo-game] auto reveal failed', err);
    }
  }, delayMs);
  if (typeof timer.unref === 'function') timer.unref();
  revealTimers.set(sourceId, timer);
}

function clearRevealTimer(sourceId) {
  const timer = revealTimers.get(sourceId);
  if (timer) clearTimeout(timer);
  revealTimers.delete(sourceId);
}

async function pushText(client, to, text) {
  return client.pushMessage(to, { type: 'text', text });
}

function normalizeGeoGameConfig(raw = {}) {
  return {
    enabled: !isFalse(process.env.GEOGAME_ENABLED) && raw.enabled !== false,
    autoReveal: !isFalse(process.env.GEOGAME_AUTO_REVEAL) && raw.autoReveal !== false,
    dailyLimit: clampInt(raw.dailyLimit ?? process.env.GEOGAME_DAILY_LIMIT, 5, 1, 20),
    answerWindowSeconds: clampInt(raw.answerWindowSeconds ?? process.env.GEOGAME_ANSWER_SECONDS, 180, 60, 600),
    radiusMeters: clampInt(raw.radiusMeters ?? process.env.GEOGAME_RADIUS_METERS, 1400, 300, 3000),
    commonsLimit: clampInt(raw.commonsLimit ?? process.env.GEOGAME_COMMONS_LIMIT, 35, 10, 50),
    imageWidth: clampInt(raw.imageWidth ?? process.env.GEOGAME_IMAGE_WIDTH, 640, 320, 1024),
    maxPhotoSearchAttempts: clampInt(raw.maxPhotoSearchAttempts ?? process.env.GEOGAME_SEARCH_ATTEMPTS, 8, 2, 16),
  };
}

function isFalse(value) {
  return /^(false|0|off|no)$/i.test(String(value || '').trim());
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function isActiveGame(game) {
  return !!game && game.status === 'active' && Date.now() < Number(game.expiresAt || 0);
}

function parseCoordinateGuess(query) {
  const match = String(query || '').match(/(-?\d{1,2}(?:\.\d+)?)[,，/|:：](-?\d{2,3}(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {
    lat,
    lng,
    label: `${lat},${lng}`,
    displayName: null,
    provider: 'coordinate',
  };
}

function calculateDistanceMeters(lat1, lng1, lat2, lng2) {
  const earthRadius = 6371008.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function toRad(value) {
  return Number(value) * Math.PI / 180;
}

function formatDistance(meters) {
  const n = Number(meters);
  if (!Number.isFinite(n)) return '不明';
  if (n < 1000) return `${Math.round(n)}m`;
  return `${(n / 1000).toFixed(n < 10000 ? 2 : 1)}km`;
}

function formatSeconds(seconds) {
  const n = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(n / 60);
  const rest = n % 60;
  if (!minutes) return `${rest}秒`;
  if (!rest) return `${minutes}分`;
  return `${minutes}分${rest}秒`;
}

function formatCoord(lat, lng) {
  return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}

function buildOpenStreetMapUrl(lat, lng) {
  const la = Number(lat).toFixed(5);
  const lo = Number(lng).toFixed(5);
  return `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=17/${la}/${lo}`;
}

function isWithinTokyoBounds(lat, lng) {
  return lat >= TOKYO_BOUNDS.minLat
    && lat <= TOKYO_BOUNDS.maxLat
    && lng >= TOKYO_BOUNDS.minLng
    && lng <= TOKYO_BOUNDS.maxLng;
}

function makeAnswerKey(userId, senderName) {
  const base = userId || senderName || `guest_${Date.now()}`;
  return String(base).replace(/[.#$/[\]]/g, '_').slice(0, 80);
}

function makeCacheKey(value) {
  return Buffer.from(String(value).normalize('NFKC').toLowerCase()).toString('base64url').slice(0, 180);
}

function metaValue(item) {
  if (item == null) return '';
  if (typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'value')) return String(item.value || '');
  return String(item || '');
}

function cleanTitle(value) {
  return stripHtml(value).replace(/^file:/i, '').replace(/\.(jpe?g|png)$/i, '').trim();
}

function stripHtml(value) {
  return decodeBasicEntities(String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function decodeBasicEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _;
    });
}

function trimText(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function getUserAgent() {
  return process.env.GEOGAME_USER_AGENT
    || 'winning-roulette-linebot/1.0 (LINE geo game; https://naotaxy.github.io/winning-roulette/)';
}

module.exports = {
  detectGeoGameIntent,
  handleGeoGameIntent,
  normalizeGeoGameConfig,
  calculateDistanceMeters,
  parseCoordinateGuess,
};
