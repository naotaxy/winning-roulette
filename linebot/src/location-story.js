'use strict';

const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const WIKIPEDIA_API_URL = 'https://ja.wikipedia.org/w/api.php';
const USER_AGENT = 'traperuko-linebot/1.0 (+https://qiita.com/meisaitokei/items/5857bbb2b5a96b52341c)';
const GOOGLE_MAPS_SEARCH_URL = 'https://www.google.com/maps/search/?api=1&query=';
const TOKYO_AREA_HINTS = [
  {
    pattern: /(中野|東中野|落合|江古田|新井薬師|哲学堂)/,
    terrain: 'このあたりは武蔵野台地の縁で、神田川や妙正寺川へ落ちていく低いほうを意識すると、街の輪郭がすっと見えてくるの。',
    history: '青梅街道側の往来と川沿いの暮らしが重なって、新宿の外縁を支える生活圏として育ってきた場所。台地の上と谷筋で、街の性格が少しずつ違うのが面白いよ。',
    spots: [
      { name: '神田川', query: '神田川 東中野', reason: '谷筋の線をそのまま辿れて、街の高低差がよくわかる場所。' },
      { name: '哲学堂公園', query: '哲学堂公園', reason: '台地の起伏と静けさがまだ残っていて、街の古い呼吸を拾いやすい場所。' },
      { name: '中野氷川神社', query: '中野氷川神社', reason: '街の芯が祈りの場所に寄っていた頃の空気を感じやすい場所。' },
    ],
  },
  {
    pattern: /(水道橋|神保町|御茶ノ水|本郷|神田|湯島)/,
    terrain: 'ここは神田川が台地を切った段差を見ると読みやすい場所。坂を一本越えるだけで、街の役割ががらっと変わるの。',
    history: '水道と橋、学校と本、印刷と出版が近い距離で重なってきたエリアで、知の流通と物の流通が同じ地形に乗っていた感じが残ってるよ。',
    spots: [
      { name: '神田川', query: '神田川 御茶ノ水', reason: '川と崖の関係が見えやすくて、この一帯の立体感がすぐ伝わる場所。' },
      { name: '神保町古書店街', query: '神保町古書店街', reason: '出版と古書の層がそのまま街並みに残っている場所。' },
      { name: '水道橋', query: '水道橋', reason: '名前そのものが水の通り道の記憶を抱えている場所。' },
    ],
  },
  {
    pattern: /(吉祥寺|井の頭|三鷹|武蔵野|西荻|荻窪)/,
    terrain: 'このあたりは武蔵野台地の乾いた高さと、井の頭池や玉川上水みたいな水の筋を一緒に見ると、街の贅沢さがよくわかるの。',
    history: '雑木林の気配と、後から伸びた鉄道の便利さが重なって、暮らしやすさと遊びの密度が育った場所。水があるから、街の柔らかさが残りやすいよ。',
    spots: [
      { name: '井の頭池', query: '井の頭池', reason: 'この一帯の水源の気配を一番わかりやすく掴める場所。' },
      { name: '井の頭弁財天', query: '井の頭弁財天', reason: '水辺の信仰が今もそのまま残る、街の芯に近い場所。' },
      { name: '玉川上水', query: '玉川上水 三鷹', reason: '人が引いた水の線が、そのまま街の骨格になったのを感じられる場所。' },
    ],
  },
  {
    pattern: /(日本橋|人形町|茅場町|八丁堀|京橋|兜町)/,
    terrain: 'このあたりは低地と掘割の都合で街が組まれてきたので、水の流れと橋の位置を拾うと急に読みやすくなるよ。',
    history: '河岸と問屋、金融と物流が折り重なって、江戸から東京まで商いの心臓みたいな役を続けてきた場所。通りの名前がそのまま仕事の記憶になってるの。',
    spots: [
      { name: '日本橋', query: '日本橋', reason: '物流と街道の起点が重なった、街の名刺みたいな場所。' },
      { name: '小網神社', query: '小網神社', reason: '商いの町に残る祈りの空気を触りやすい場所。' },
      { name: '霊岸橋', query: '霊岸橋', reason: '水路の街だった頃の手触りをまだ想像しやすい場所。' },
    ],
  },
  {
    pattern: /(浅草|蔵前|両国|向島|押上|墨田|台東)/,
    terrain: 'ここは隅田川の大きな流れを背骨にして見るといい場所。低地の街は、水と橋の置き方に生活の癖が残るの。',
    history: '寺社への参詣、職人の手仕事、川沿いの興行や流通がずっと重なってきたエリアで、表通りより一本入ったところに昔の温度が残りやすいよ。',
    spots: [
      { name: '駒形橋', query: '駒形橋', reason: '川向こうとの距離感で、この街の広がり方がよく見える場所。' },
      { name: '隅田川テラス', query: '隅田川テラス 浅草', reason: '低地の街と大きい川の関係を、そのまま身体で掴みやすい場所。' },
      { name: '浅草寺', query: '浅草寺', reason: '参詣の町としての芯が、今もいちばんわかりやすく残る場所。' },
    ],
  },
  {
    pattern: /(深川|門前仲町|清澄|森下|木場|江東|豊洲)/,
    terrain: 'この一帯は運河と埋立の記憶を持った低地だから、水の面積を意識すると街の作りがすごく見えやすいよ。',
    history: '材木や倉庫、門前町、のちの再開発まで、水運の都合で役割を変え続けてきた場所。真っすぐな道ほど、後から引かれた意志が見えたりするの。',
    spots: [
      { name: '富岡八幡宮', query: '富岡八幡宮', reason: '門前町の空気を今もいちばん感じやすい場所。' },
      { name: '小名木川', query: '小名木川', reason: '運河の街だったことを、そのまま辿りやすい線。' },
      { name: '清澄庭園', query: '清澄庭園', reason: '水と石の使い方に、この土地の静かな贅沢が残る場所。' },
    ],
  },
  {
    pattern: /(品川|北品川|高輪|大崎|五反田|御殿山)/,
    terrain: 'ここは海側の低い地と高輪の高い地が近くて、坂を一本越えるだけで街の顔が変わるのが特徴だよ。',
    history: '東海道の宿場と海辺の往来、それに近代以降の鉄道が折り重なって、東京の出入口としてずっと忙しかった場所。古い道筋を知ると景色が変わるよ。',
    spots: [
      { name: '品川宿跡', query: '品川宿跡', reason: '街道の町だった頃の気配を一番まっすぐ拾える場所。' },
      { name: '御殿山', query: '御殿山', reason: '高いところから街の重心を読み直しやすい場所。' },
      { name: '泉岳寺', query: '泉岳寺', reason: '街道沿いの時間の厚みが、静かに残っている場所。' },
    ],
  },
  {
    pattern: /(麻布|六本木|赤坂|青山|虎ノ門|溜池|六本木一丁目)/,
    terrain: 'このあたりは台地と谷が細かく入り組んでいて、坂の名前を追うだけでも街の地形図が立ち上がってくるよ。',
    history: '大名屋敷の名残、近代の再編、外資や文化施設の流入が重なって、古さと新しさが同じ坂に同居してきた場所。低いところほど水の記憶が濃いの。',
    spots: [
      { name: '赤坂氷川神社', query: '赤坂氷川神社', reason: '谷と台地の境目で、街の気圧が少し変わるのを感じやすい場所。' },
      { name: '古川', query: '古川 南麻布', reason: '今は見えにくい水の線を思い出す入口としてちょうどいい場所。' },
      { name: '檜町公園', query: '檜町公園', reason: '再開発の中でも地形の落ち着きが残る場所。' },
    ],
  },
];

function detectLocationStoryIntent(text) {
  const compact = normalize(text);
  if (!compact) return null;
  if (/(この場所|この辺|このへん|近辺|近く|現在地|今いる場所|ここ).*(歴史|由来|昔|地形|面影|ノブレス|物語)/.test(compact)) {
    return { type: 'locationStory' };
  }
  if (/(歴史案内|面影案内|地形案内|ノブレス案内)/.test(compact)) {
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
  const manualHint = findTokyoAreaHint(areaLabel || label || '', wikiPages);
  return buildStoryMessages({
    areaLabel: areaLabel || label || 'この場所',
    insights,
    selectedTraces,
    wikiPages,
    profile,
    manualHint,
  });
}

function buildStoryMessages({ areaLabel, insights, selectedTraces, wikiPages, profile, manualHint = null }) {
  const terrainLine = manualHint?.terrain
    ? manualHint.terrain
    : insights.terrain
    ? `${insights.terrain.title}の気配から入ると、${insights.terrain.sentence}`
    : buildFallbackTerrainLine(areaLabel);

  const historyLine = manualHint?.history
    ? manualHint.history
    : insights.history
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

  const spotTraces = mergeStoryTraces(buildManualHintTraces(manualHint), selectedTraces);
  const spotLines = spotTraces.length
    ? spotTraces.map((trace, index) => `${index + 1}. ${trace.name} - ${trace.reason}\n${trace.mapUrl}`)
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

function findTokyoAreaHint(areaLabel, wikiPages) {
  const searchText = [areaLabel, ...(wikiPages || []).map(page => page?.title || '')].join(' ');
  return TOKYO_AREA_HINTS.find(hint => hint.pattern.test(searchText)) || null;
}

function buildManualHintTraces(manualHint) {
  if (!manualHint?.spots?.length) return [];
  return manualHint.spots.map(spot => ({
    name: spot.name,
    kind: 'curated',
    reason: spot.reason,
    mapUrl: `${GOOGLE_MAPS_SEARCH_URL}${encodeURIComponent(spot.query || spot.name)}`,
  }));
}

function mergeStoryTraces(primary, secondary) {
  const seen = new Set();
  return [...(primary || []), ...(secondary || [])]
    .filter(trace => trace?.name && trace?.mapUrl)
    .filter(trace => {
      const key = String(trace.name).trim();
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
