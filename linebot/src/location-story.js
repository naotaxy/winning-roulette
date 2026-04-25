'use strict';

const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const WIKIPEDIA_API_URL = 'https://ja.wikipedia.org/w/api.php';
const USER_AGENT = 'traperuko-linebot/1.0 (+https://qiita.com/meisaitokei/items/5857bbb2b5a96b52341c)';

function detectLocationStoryIntent(text) {
  const compact = normalize(text);
  if (!compact) return null;
  if (/(この場所|この辺|このへん|近辺|近く|現在地|今いる場所|ここ).*(歴史|由来|昔|地形|面影|東のエデン|ノブレス|物語)/.test(compact)) {
    return { type: 'locationStory' };
  }
  if (/(歴史案内|面影案内|地形案内|東のエデン案内|ノブレス案内)/.test(compact)) {
    return { type: 'locationStory' };
  }
  return null;
}

function buildLocationStoryPrompt(hasRecentLocation = false) {
  return {
    type: 'text',
    text: hasRecentLocation
      ? 'この場所の歴史や面影をほどくなら、今の位置をもう一回送ってくれる？ 今いる場所に寄せて、小分けで案内するね。'
      : '位置情報を送ってくれたら、この場所の歴史や地形の気配、それが今どこに残ってるかを小分けで案内するよ。',
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

async function generateLocationStoryMessages({ latitude, longitude, label = '', profile = null } = {}) {
  const [areaLabel, wikiPages, traces] = await Promise.all([
    reverseGeocodeLabel(latitude, longitude),
    fetchWikipediaNearbyPages(latitude, longitude),
    fetchNearbyHistoricalTraces(latitude, longitude),
  ]);

  const insights = extractHistoricalInsights(wikiPages);
  const selectedTraces = selectStoryTraces(traces, profile);
  return buildStoryMessages({
    areaLabel: areaLabel || label || 'この場所',
    insights,
    selectedTraces,
    wikiPages,
    profile,
  });
}

function buildStoryMessages({ areaLabel, insights, selectedTraces, wikiPages, profile }) {
  const terrainLine = insights.terrain
    ? `${insights.terrain.title}の気配から入ると、${insights.terrain.sentence}`
    : buildFallbackTerrainLine(areaLabel);

  const historyLine = insights.history
    ? `${insights.history.title}を見ると、${insights.history.sentence}`
    : insights.figure
      ? `${insights.figure.title}に残る話を拾うと、${insights.figure.sentence}`
      : buildFallbackHistoryLine(areaLabel, selectedTraces);

  const firstMessage = [
    `${areaLabel}、少しだけ地層をめくるね。`,
    terrainLine,
  ].join('\n');

  const secondMessage = [
    '人の営みの筋を一本だけ拾うとね。',
    historyLine,
  ].join('\n');

  const spotLines = selectedTraces.length
    ? selectedTraces.map((trace, index) => `${index + 1}. ${trace.name} - ${trace.reason}\n${trace.mapUrl}`)
    : [
      ...(wikiPages[0]?.url ? [`${wikiPages[0].title}\n${wikiPages[0].url}`] : []),
      ...(wikiPages[1]?.url ? [`${wikiPages[1].title}\n${wikiPages[1].url}`] : []),
    ];

  const ending = profile?.preferenceHints?.shrine
    ? '神社や橋みたいに、街の空気がふっと変わる場所から入ると、あなたにはたぶん気持ちいいよ。行ってみる？'
    : '橋とか神社とか、今も触れられるものから辿ると、この街の過去が急に近くなるよ。行ってみる？';

  const thirdMessage = [
    '今の街に残ってる面影は、このへん。',
    ...spotLines,
    ending,
  ].filter(Boolean).join('\n');

  return [
    { type: 'text', text: clipText(firstMessage) },
    { type: 'text', text: clipText(secondMessage) },
    { type: 'text', text: clipText(thirdMessage) },
  ];
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
      headers: { 'User-Agent': USER_AGENT },
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

async function fetchWikipediaNearbyPages(latitude, longitude) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const params = new URLSearchParams({
      action: 'query',
      list: 'geosearch',
      gscoord: `${latitude}|${longitude}`,
      gsradius: '5000',
      gslimit: '8',
      format: 'json',
      origin: '*',
    });
    const res = await fetch(`${WIKIPEDIA_API_URL}?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const geoData = await res.json();
    const geoPages = geoData?.query?.geosearch || [];
    if (!geoPages.length) return [];

    const detailParams = new URLSearchParams({
      action: 'query',
      prop: 'extracts|info',
      pageids: geoPages.map(page => page.pageid).join('|'),
      exintro: '1',
      explaintext: '1',
      exchars: '320',
      inprop: 'url',
      format: 'json',
      origin: '*',
    });
    const detailRes = await fetch(`${WIKIPEDIA_API_URL}?${detailParams}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!detailRes.ok) return [];
    const detailData = await detailRes.json();
    const pages = detailData?.query?.pages || {};
    return geoPages
      .map(item => ({
        title: pages[item.pageid]?.title || item.title,
        extract: pages[item.pageid]?.extract || '',
        distance: item.dist || 0,
        url: pages[item.pageid]?.fullurl || '',
      }))
      .filter(page => page.title && page.extract);
  } catch (err) {
    if (err?.name !== 'AbortError') console.error('[location-story] wikipedia failed', err?.message || err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchNearbyHistoricalTraces(latitude, longitude) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    const query = [
      '[out:json][timeout:12];(',
      `nwr[historic](around:1800,${latitude},${longitude});`,
      `nwr[amenity="place_of_worship"](around:1800,${latitude},${longitude});`,
      `nwr[bridge](around:1800,${latitude},${longitude});`,
      `nwr[waterway](around:1800,${latitude},${longitude});`,
      `nwr[leisure="park"](around:1800,${latitude},${longitude});`,
      `nwr[tourism="attraction"](around:1800,${latitude},${longitude});`,
      ');out center 40;',
    ].join('');
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=UTF-8',
        'User-Agent': USER_AGENT,
      },
      body: query,
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.elements) ? json.elements : [];
  } catch (err) {
    if (err?.name !== 'AbortError') console.error('[location-story] overpass failed', err?.message || err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function extractHistoricalInsights(pages) {
  const terrainRegex = /(川|低地|台地|谷|丘|湿地|沼|池|段丘|河岸段丘|入江|崖|扇状地|水辺)/;
  const historyRegex = /(街道|宿場|市場|商人|流通|舟運|港|問屋|工場|産業|鉄道の開通|開通|創業|印刷|出版|物流|門前|参道)/;
  const figureRegex = /(創建|建立|ゆかり|生まれ|住んだ|活躍|記念|旧跡|徳川|将軍|文人|作家|画家)/;
  const historicalPageFilter = page => {
    const title = String(page?.title || '');
    const extract = String(page?.extract || '');
    if (/(駅ビル|ショッピングセンター|モール|百貨店|株式会社|大学|高校|中学校|小学校|企業|ホール|ビル)/.test(title)) return false;
    if (/(株式会社|主な事業|企業である|学校法人)/.test(extract)) return false;
    return true;
  };

  return {
    terrain: pickPageSentence(pages, terrainRegex, historicalPageFilter),
    history: pickPageSentence(pages, historyRegex, historicalPageFilter),
    figure: pickPageSentence(pages, figureRegex, historicalPageFilter),
  };
}

function pickPageSentence(pages, regex, pageFilter = null) {
  for (const page of pages) {
    if (typeof pageFilter === 'function' && !pageFilter(page)) continue;
    const sentences = splitSentences(page.extract);
    const sentence = sentences.find(line => regex.test(line));
    if (sentence) {
      return {
        title: page.title,
        sentence: sentence.length > 110 ? `${sentence.slice(0, 107)}...` : sentence,
      };
    }
  }
  return null;
}

function selectStoryTraces(elements, profile) {
  const seen = new Set();
  return elements
    .map(toTrace)
    .filter(Boolean)
    .sort((a, b) => scoreTrace(b, profile) - scoreTrace(a, profile))
    .filter(trace => {
      const key = `${trace.name}:${trace.kind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

function toTrace(element) {
  const tags = element?.tags || {};
  const name = String(tags.name || '').trim();
  const latitude = Number(element?.lat ?? element?.center?.lat);
  const longitude = Number(element?.lon ?? element?.center?.lon);
  if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (/^(明日への夢|時計台|記念碑|銅像|モニュメント)$/i.test(name)) return null;

  const kind = detectTraceKind(tags);
  if (kind === 'historic' && !/(跡|旧|古|宿|塚|橋|河岸|川|神社|寺|公園|御門|水)/.test(name)) return null;
  return {
    name,
    kind,
    reason: buildTraceReason(kind),
    mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude} ${name}`)}`,
  };
}

function detectTraceKind(tags) {
  if (tags.amenity === 'place_of_worship') return 'shrine';
  if (tags.bridge || tags.man_made === 'bridge') return 'bridge';
  if (tags.waterway) return 'water';
  if (tags.leisure === 'park') return 'park';
  if (tags.historic) return 'historic';
  if (tags.tourism === 'attraction') return 'attraction';
  return 'spot';
}

function buildTraceReason(kind) {
  if (kind === 'shrine') return '街の記憶が空気に残りやすい場所。';
  if (kind === 'bridge') return '流れと往来の名残を触りやすい場所。';
  if (kind === 'water') return '昔の地形の線をいちばん感じやすい場所。';
  if (kind === 'park') return '削られずに残った地形の気配を拾いやすい場所。';
  if (kind === 'historic') return 'この街の古い層がそのまま顔を出している場所。';
  return '今も面影に手を伸ばしやすい場所。';
}

function scoreTrace(trace, profile) {
  let score = 0;
  if (trace.kind === 'bridge') score += 6;
  if (trace.kind === 'water') score += 6;
  if (trace.kind === 'shrine') score += 6;
  if (trace.kind === 'park') score += 4;
  if (trace.kind === 'historic') score += 3;
  if (profile?.preferenceHints?.shrine && trace.kind === 'shrine') score += 3;
  if (profile?.preferenceHints?.outing && (trace.kind === 'park' || trace.kind === 'water')) score += 2;
  if (/(橋|川|神社|寺|公園|池|緑道|旧|跡|塚)/.test(trace.name)) score += 2;
  return score;
}

function buildFallbackTerrainLine(areaLabel) {
  if (/(武蔵野|吉祥寺|三鷹|中野|杉並|練馬|西荻|荻窪|小金井|国分寺|国立|立川)/.test(areaLabel)) {
    return `${areaLabel}は武蔵野台地の流れで見ると読みやすくて、水の線や谷の名残を拾うと昔の輪郭が急に見えてくるの。`;
  }
  if (/(千代田|中央|台東|墨田|江東|荒川|足立|葛飾|江戸川)/.test(areaLabel)) {
    return `${areaLabel}は低地と川筋の都合で育った街として見るとわかりやすいよ。水の流れと橋の位置に、昔の生活の癖が残りやすいの。`;
  }
  if (/(港|品川|大田)/.test(areaLabel)) {
    return `${areaLabel}は海と台地のあいだで街の重心が動いてきた場所として見ると面白いよ。坂と水辺の切り替わりに昔の気配が出るの。`;
  }
  return `${areaLabel}は、地形と人の流れで表情が変わってきた場所として見ると、急に面白くなるの。`;
}

function buildFallbackHistoryLine(areaLabel, selectedTraces) {
  if (selectedTraces?.length) {
    return `${selectedTraces[0].name}みたいな名前が残っているだけでも、この街が水や祈りや往来の線で組み立てられてきたことが少し見えるよ。`;
  }
  if (/(武蔵野|吉祥寺|中野|杉並|練馬)/.test(areaLabel)) {
    return `${areaLabel}の周辺は、街道と鉄道で重心がずれていくたびに、商いと暮らしの場所が塗り替わってきた感じがあるの。`;
  }
  return `${areaLabel}の周辺は、街道や鉄道や水辺の都合で、人と商いの重心が少しずつ動いてきた感じがあるよ。`;
}

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[。！？])/)
    .map(line => line.trim())
    .filter(Boolean);
}

function clipText(text) {
  const value = String(text || '').trim();
  return value.length > 1000 ? `${value.slice(0, 997)}...` : value;
}

function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

module.exports = {
  detectLocationStoryIntent,
  buildLocationStoryPrompt,
  generateLocationStoryMessages,
};
