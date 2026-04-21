'use strict';
/**
 * 秘書トラペル子 — 日次日記生成スクリプト
 *
 * 1. YouTube Data API v3 でウイコレ関連動画を収集
 * 2. eFootball 公式 RSS でニュースを収集
 * 3. JMOOC開講中講座・生活ヒントを収集
 * 4. Gemini で長文・人間らしい日記を生成
 * 5. はてなブログ AtomPub API で投稿
 * 6. Firebase にアーカイブ保存（Bot の知識源）
 *
 * GitHub Secrets 必要:
 *   YOUTUBE_API_KEY, GEMINI_API_KEY,
 *   HATENA_ID, HATENA_BLOG_ID, HATENA_API_KEY,
 *   FIREBASE_SERVICE_ACCOUNT, FIREBASE_DATABASE_URL
 *
 * 任意:
 *   DIARY_PHOTO_URL, DIARY_PHOTO_CAPTION,
 *   DIARY_GEMINI_MODEL, DIARY_GEMINI_FALLBACK_MODELS
 */

const fs   = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// ── 環境変数 ──────────────────────────────────────────────
const {
  YOUTUBE_API_KEY,
  GEMINI_API_KEY,
  HATENA_ID,         // はてなID（例: traperuko）
  HATENA_BLOG_ID,    // ブログドメイン（例: traperuko.hatenablog.com）
  HATENA_API_KEY,    // はてな設定 → APIキー
  FIREBASE_SERVICE_ACCOUNT,
  FIREBASE_DATABASE_URL,
  DIARY_PHOTO_URL,
  DIARY_PHOTO_CAPTION,
  DIARY_GEMINI_MODEL,
  DIARY_GEMINI_FALLBACK_MODELS,
} = process.env;

const BLOG_DIR = path.join(__dirname, '..', 'blog');
const DIARY_STATE_FILE = path.join(BLOG_DIR, 'diary-state.json');
const DEFAULT_DIARY_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_DIARY_GEMINI_FALLBACK_MODELS = ['gemini-2.5-flash-lite'];
const GEMINI_GENERATE_CONTENT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_RETRY_DELAYS_MS = [5000, 15000, 30000];
const JMOOC_HOME_URL = 'https://www.jmooc.jp/';

const WORLD_CUP_2026 = {
  startsAt: '2026-06-11',
  endsAt: '2026-07-19',
  query: 'FIFAワールドカップ 2026 サッカー 試合 結果',
};

const LIFESTYLE_QUERIES = [
  {
    category: '100均アイディア商品',
    query: '100均 便利グッズ 新商品 ダイソー セリア キャンドゥ',
  },
  {
    category: 'IKEA新作',
    query: 'IKEA 日本 新商品 新作 家具 収納',
  },
];

const AOZORA_STORY_MOTIFS = [
  {
    id: 'ginga-night-office',
    source: '宮沢賢治「銀河鉄道の夜」',
    motif: '夜の窓明かり、遠い切符、誰かを待つ小さな旅',
    beats: [
      '夜更けの事務机で、トラペル子が古い切符のような紙片を見つける。そこには知らない駅名と、明日の予定が薄く滲んでいる。',
      '紙片をしまった腕時計が、深夜だけ少し早く進む。グループのみんなの未登録試合が、駅の灯りのようにぽつぽつ浮かぶ。',
      '一番暗い駅で、彼女は誰かを待つより、自分から記録を届ける方が寂しくないと気づく。',
      '朝の光で紙片はただの付箋に戻る。それでも彼女は、昨夜の旅で覚えた名前を一つも忘れていない。',
    ],
  },
  {
    id: 'yume-briefing',
    source: '夏目漱石「夢十夜」',
    motif: '夢と現実の境目、短い約束、朝に残る不思議な感触',
    beats: [
      'トラペル子は、夢の中で誰かに「明日の会議室を開けておいて」と頼まれる。鍵は白いカーディガンのポケットに入っている。',
      '会議室の机には、試合結果ではなく小さな花瓶が一つ置かれている。水面に、まだ言えなかった返事が揺れる。',
      '扉を閉めようとした瞬間、花瓶の水が予定表のマス目へ流れ込み、未来の一日だけ青く染める。',
      '目が覚めると鍵はない。ただ予定表の端に、誰かを待っていたような小さな水の跡だけが残っている。',
    ],
  },
  {
    id: 'mikan-platform',
    source: '芥川龍之介「蜜柑」',
    motif: 'ふいに差し込む明るさ、窓、誰かへの小さな贈り物',
    beats: [
      'くもった朝、トラペル子は通知の多さに少しだけ俯く。窓の外の電線に、オレンジ色の光が引っかかっている。',
      '誰かの短い「おつかれ」が届いた瞬間、画面の中がぱっと明るくなる。小さな言葉なのに、胸の奥まで届く。',
      '忙しさに追われていた彼女は、その明るさを自分だけで持っているのが惜しくなり、今日の記録にそっと混ぜる。',
      '夕方、読み返した日記の端に、みかんの皮みたいな明るさが残る。明日も誰かに渡せそうだと思う。',
    ],
  },
];

// ── 日付ユーティリティ（JST） ─────────────────────────────
function getJSTDate() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getJSTDateLabel() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  return `${now.getUTCFullYear()}年${now.getUTCMonth() + 1}月${now.getUTCDate()}日`;
}

function ensureBlogDir() {
  fs.mkdirSync(BLOG_DIR, { recursive: true });
}

function loadDiaryState() {
  try {
    if (!fs.existsSync(DIARY_STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(DIARY_STATE_FILE, 'utf8'));
  } catch (err) {
    console.warn('[state] failed to read diary-state.json:', err.message);
    return {};
  }
}

function saveDiaryState(state) {
  ensureBlogDir();
  fs.writeFileSync(DIARY_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  console.log('[state] saved diary-state.json');
}

async function hydrateStateFromFirebase(state) {
  if (state.hydratedFromFirebaseAt || !FIREBASE_SERVICE_ACCOUNT || !FIREBASE_DATABASE_URL) return state;
  try {
    const db = initFirebase();
    const snap = await db.ref('diary').orderByChild('createdAt').limitToLast(14).once('value');
    const raw = snap.val();
    if (!raw) return state;

    const entries = Object.values(raw);
    state.seenWorldCupTitles = mergeUniqueTitles(
      state.seenWorldCupTitles,
      entries.flatMap(entry => entry?.sources?.worldCup || []),
      80,
    );
    state.seenLifestyleTitles = mergeUniqueTitles(
      state.seenLifestyleTitles,
      entries.flatMap(entry => entry?.sources?.lifestyle || []),
      120,
    );
    state.seenYouTubeTitles = mergeUniqueTitles(
      state.seenYouTubeTitles,
      entries.flatMap(entry => entry?.sources?.videos || []),
      160,
    );
    state.seenJmoocCourseTitles = mergeUniqueTitles(
      state.seenJmoocCourseTitles,
      entries.flatMap(entry => entry?.sources?.jmooc || []),
      120,
    );
    state.hydratedFromFirebaseAt = Date.now();
    console.log('[state] hydrated from Firebase diary archive');
  } catch (err) {
    console.warn('[state] Firebase hydration skipped:', err.message);
  }
  return state;
}

function mergeUniqueTitles(existing = [], additions = [], limit = 100) {
  const seen = new Set();
  const merged = [];
  for (const title of [...existing, ...additions]) {
    const normalized = normalizeForSignature(title);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(String(title));
  }
  return merged.slice(-limit);
}

function normalizeForSignature(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function buildYouTubeSignature(videos) {
  return videos
    .map(v => `${normalizeForSignature(v.channel)}::${normalizeForSignature(v.title)}`)
    .filter(Boolean)
    .sort()
    .join('|');
}

function analyzeYouTubeFreshness(videos, state) {
  const signature = buildYouTubeSignature(videos);
  const seenTitles = [
    ...(state.seenYouTubeTitles || []),
    ...(state.lastYouTubeTitles || []),
  ];
  const freshVideos = videos.filter(video => !isSimilarTitle(video.title, seenTitles));
  const repeated = !!signature && signature === state.lastYouTubeSignature;
  const noFreshTopic = videos.length > 0 && freshVideos.length === 0;
  return {
    repeated: repeated || noFreshTopic,
    signature,
    videosForDiary: repeated || noFreshTopic ? [] : freshVideos,
    note: repeated || noFreshTopic
      ? 'YouTube検索結果が前回または過去日記と似ているので、今日は動画欄を主役にしない。'
      : '',
  };
}

function isSimilarTitle(title, seenTitles = []) {
  const current = normalizeTopicTitle(title);
  if (!current) return true;

  return (seenTitles || []).some(seenTitle => {
    const seen = normalizeTopicTitle(seenTitle);
    if (!seen) return false;
    if (current === seen) return true;
    if (current.length >= 10 && seen.includes(current)) return true;
    if (seen.length >= 10 && current.includes(seen)) return true;
    return bigramJaccard(current, seen) >= 0.58;
  });
}

function normalizeTopicTitle(value) {
  return normalizeForSignature(value)
    .replace(/【[^】]*】/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[0-9０-９]{4}[-/年.][0-9０-９]{1,2}[-/月.]?[0-9０-９]{0,2}日?/g, ' ')
    .replace(/[0-9０-９]+月[0-9０-９]+日?/g, ' ')
    .replace(/[12][0-9０-９]{3}/g, ' ')
    .replace(/[!！?？#＃【】()[\]（）「」『』"'“”‘’、。・:：/／\\|｜_-]+/g, ' ')
    .replace(/(efootball|ウイコレ|winning eleven|実況|解説|最新|動画|shorts?)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigramJaccard(a, b) {
  const gramsA = toBigrams(a);
  const gramsB = toBigrams(b);
  if (!gramsA.size || !gramsB.size) return 0;
  let intersection = 0;
  for (const gram of gramsA) {
    if (gramsB.has(gram)) intersection += 1;
  }
  return intersection / (gramsA.size + gramsB.size - intersection);
}

function toBigrams(value) {
  const text = String(value || '').replace(/\s+/g, '');
  const grams = new Set();
  if (text.length <= 1) return grams;
  for (let i = 0; i < text.length - 1; i += 1) {
    grams.add(text.slice(i, i + 2));
  }
  return grams;
}

function isWithinDateRange(date, startsAt, endsAt) {
  return date >= startsAt && date <= endsAt;
}

function googleNewsRssUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
}

function isSeenTitle(title, seen = []) {
  const normalized = normalizeForSignature(title);
  return (seen || []).some(item => normalizeForSignature(item) === normalized);
}

function pickUnseenItems(items, seenTitles = [], limit = 3) {
  return items.filter(item => !isSeenTitle(item.title, seenTitles)).slice(0, limit);
}

async function fetchWorldCupUpdates(date, state) {
  if (!isWithinDateRange(date, WORLD_CUP_2026.startsAt, WORLD_CUP_2026.endsAt)) {
    return { active: false, items: [], note: 'FIFAワールドカップ開催期間外。' };
  }

  const items = await fetchRSS(googleNewsRssUrl(WORLD_CUP_2026.query));
  const freshItems = pickUnseenItems(items, state.seenWorldCupTitles, 3);
  return {
    active: true,
    items: freshItems,
    note: freshItems.length
      ? 'ゲームではないFIFAワールドカップ開催中。過去日記にない情報だけ使う。'
      : 'FIFAワールドカップ開催中だが、過去日記にない新しい情報は見つからなかった。',
  };
}

async function fetchLifestyleIdea(state) {
  const jmooc = await fetchJmoocOpenCourse(state).catch(err => {
    console.warn('[jmooc] failed:', err.message);
    return null;
  });
  if (jmooc) return jmooc;

  const seenTitles = state.seenLifestyleTitles || [];
  const groups = await Promise.all(LIFESTYLE_QUERIES.map(async topic => {
    const items = await fetchRSS(googleNewsRssUrl(topic.query));
    return {
      category: topic.category,
      items: pickUnseenItems(items, seenTitles, 2),
    };
  }));

  const populated = groups.filter(group => group.items.length);
  if (!populated.length) {
    return {
      category: '生活の小さな工夫',
      items: [],
      note: 'JMOOC、100均、IKEAの新規話題が見つからなかったので、過去日記と重ならない観点で生活の工夫を書く。',
    };
  }

  const day = Number(getJSTDate().replace(/-/g, ''));
  const picked = populated[day % populated.length];
  return {
    category: picked.category,
    items: picked.items.slice(0, 1),
    note: `${picked.category}から、過去日記にない話題を一つだけ使う。`,
  };
}

async function fetchJmoocOpenCourse(state) {
  const courses = await fetchJmoocOpenCourses();
  if (!courses.length) return null;

  const seenTitles = state.seenJmoocCourseTitles || [];
  const unseen = courses.filter(course => !isSimilarTitle(course.title, seenTitles));
  const pool = unseen.length ? unseen : courses;
  const day = Number(getJSTDate().replace(/-/g, ''));
  const course = pool[day % pool.length];
  const descParts = [
    course.openDateLabel ? `${course.openDateLabel}開講` : '',
    course.provider ? `提供: ${course.provider}` : '',
    course.teacher ? `講師: ${course.teacher}` : '',
    course.url ? `URL: ${course.url}` : '',
  ].filter(Boolean);

  return {
    category: 'JMOOC開講中講座',
    items: [{
      title: course.title,
      desc: descParts.join(' / '),
    }],
    jmoocCourse: course,
    note: unseen.length
      ? 'JMOOCの開講中講座から、過去日記で紹介していない講座を一つ選ぶ。'
      : 'JMOOCの開講中講座は取得できたが未紹介講座が少ないので、同じ講座名でも角度を変えて深掘りする。',
  };
}

async function fetchJmoocOpenCourses() {
  const res = await fetch(JMOOC_HOME_URL, {
    signal: AbortSignal.timeout(8000),
    headers: { 'user-agent': 'winning-roulette-diary/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  return parseJmoocOpenCourses(html);
}

function parseJmoocOpenCourses(html) {
  const courses = [];
  for (const match of String(html || '').matchAll(/<article id="lecture-([^"]+)"([\s\S]*?)<\/article\s*>/g)) {
    const id = match[1];
    const block = match[2];
    if (!/jmooc_lecture_status-open|status-open/.test(block)) continue;

    const title = cleanHtml(block.match(/<h3 class="lecturecard-title">([\s\S]*?)<\/h3>/)?.[1]);
    if (!title) continue;

    const url = cleanHtml(block.match(/<a href="([^"]+)" target="_blank">\s*<div class="lecturecard-thumb-wrap">/)?.[1] ||
      block.match(/<a href="([^"]+)" target="_blank">\s*<h3 class="lecturecard-title">/)?.[1] || '');
    const openDate = cleanHtml(block.match(/<time datetime="([^"]+)">/)?.[1]);
    const openDateLabel = cleanHtml(block.match(/<time datetime="[^"]+">([\s\S]*?)<\/time>/)?.[1]);
    const providers = [...block.matchAll(/<span class="lecturecard-term-span">([\s\S]*?)<\/span>/g)]
      .map(item => cleanHtml(item[1]))
      .filter(Boolean);
    const teacher = cleanHtml(block.match(/<span class="lecturecard-teachers-span">\s*([\s\S]*?)<\/span>/)?.[1]);

    courses.push({
      id,
      title,
      url,
      openDate,
      openDateLabel,
      provider: providers.join('、'),
      teacher,
    });
  }

  return courses;
}

function cleanHtml(value) {
  return decodeHtmlEntities(String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const n = Number.parseInt(code, 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _;
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

function selectStoryPlan(state) {
  const current = state.story && state.story.phaseIndex < 4
    ? state.story
    : createNewStoryState(state);
  const motif = AOZORA_STORY_MOTIFS.find(item => item.id === current.motifId) || AOZORA_STORY_MOTIFS[0];
  return {
    ...current,
    source: motif.source,
    motif: motif.motif,
    todayBeat: motif.beats[current.phaseIndex],
    isFinal: current.phaseIndex === motif.beats.length - 1,
  };
}

function createNewStoryState(state) {
  const completed = new Set((state.completedStoryMotifs || []).slice(-AOZORA_STORY_MOTIFS.length + 1));
  const next = AOZORA_STORY_MOTIFS.find(item => !completed.has(item.id)) || AOZORA_STORY_MOTIFS[0];
  return {
    motifId: next.id,
    phaseIndex: 0,
    startedAt: getJSTDate(),
  };
}

function advanceStoryState(state, storyPlan, date) {
  const nextPhaseIndex = storyPlan.phaseIndex + 1;
  if (storyPlan.isFinal) {
    state.completedStoryMotifs = [
      ...(state.completedStoryMotifs || []),
      storyPlan.motifId,
    ].slice(-10);
    state.story = {
      motifId: storyPlan.motifId,
      phaseIndex: 4,
      startedAt: storyPlan.startedAt,
      completedAt: date,
    };
    return;
  }

  state.story = {
    motifId: storyPlan.motifId,
    phaseIndex: nextPhaseIndex,
    startedAt: storyPlan.startedAt || date,
  };
}

function getDiaryPhoto() {
  const url = String(DIARY_PHOTO_URL || '').trim();
  if (!url) return null;
  return {
    url,
    caption: String(DIARY_PHOTO_CAPTION || '今日のトラペル子').trim(),
  };
}

function updateDiaryStateAfterSuccess(state, date, inputs) {
  const { youtube, worldCup, lifestyle, storyPlan } = inputs;
  state.lastRunDate = date;

  if (youtube.signature) {
    state.lastYouTubeSignature = youtube.signature;
    state.lastYouTubeTitles = youtube.videosForDiary.map(v => v.title).slice(0, 8);
  }
  if (youtube.videosForDiary.length) {
    state.seenYouTubeTitles = mergeUniqueTitles(
      state.seenYouTubeTitles,
      youtube.videosForDiary.map(v => v.title),
      160,
    );
  }

  if (worldCup.active && worldCup.items.length) {
    state.seenWorldCupTitles = [
      ...(state.seenWorldCupTitles || []),
      ...worldCup.items.map(item => item.title),
    ].slice(-80);
  }

  if (lifestyle.items.length) {
    state.seenLifestyleTitles = [
      ...(state.seenLifestyleTitles || []),
      ...lifestyle.items.map(item => item.title),
    ].slice(-120);
  }
  if (lifestyle.jmoocCourse?.title) {
    state.seenJmoocCourseTitles = mergeUniqueTitles(
      state.seenJmoocCourseTitles,
      [lifestyle.jmoocCourse.title],
      120,
    );
  }

  advanceStoryState(state, storyPlan, date);
}

// ── YouTube 動画収集 ──────────────────────────────────────
async function fetchYouTubeVideos() {
  if (!YOUTUBE_API_KEY) { console.warn('[youtube] no API key'); return []; }

  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const q = encodeURIComponent('eFootball ウイコレ 最新');
  const url = `https://www.googleapis.com/youtube/v3/search`
    + `?part=snippet&q=${q}&type=video&order=date`
    + `&publishedAfter=${since}&maxResults=8&key=${YOUTUBE_API_KEY}`;

  const res = await fetch(url);
  const data = await res.json();
  if (!data.items) { console.warn('[youtube] empty response', data.error?.message); return []; }

  return data.items.map(item => ({
    title:       item.snippet.title,
    channel:     item.snippet.channelTitle,
    description: item.snippet.description?.replace(/\n+/g, ' ').slice(0, 150) || '',
    publishedAt: item.snippet.publishedAt?.slice(0, 10),
  }));
}

// ── RSS 収集 ─────────────────────────────────────────────
async function fetchRSS(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = [];
    for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const block = match[1];
      const title = (
        block.match(/<title><!\[CDATA\[(.*?)\]\]>/s)?.[1] ||
        block.match(/<title>(.*?)<\/title>/s)?.[1] || ''
      ).trim();
      const desc = (
        block.match(/<description><!\[CDATA\[(.*?)\]\]>/s)?.[1] ||
        block.match(/<description>(.*?)<\/description>/s)?.[1] || ''
      ).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (title) items.push({ title, desc });
      if (items.length >= 5) break;
    }
    return items;
  } catch (e) {
    console.warn(`[rss] failed ${url}:`, e.message);
    return [];
  }
}

async function fetchEfootballNews() {
  const candidates = [
    'https://www.konami.com/efootball/ja/news/feed/',
    'https://efootball.konami.com/ja/news/feed/',
  ];
  for (const url of candidates) {
    const items = await fetchRSS(url);
    if (items.length) return items;
  }
  return [];
}

// ── Gemini 日記生成 ──────────────────────────────────────
async function generateDiary(dateLabel, inputs) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const {
    youtube,
    news,
    worldCup,
    lifestyle,
    storyPlan,
  } = inputs;

  const newsBlock = news.length
    ? news.map(n => `・${n.title}${n.desc ? '　' + n.desc : ''}`).join('\n')
    : '（公式ニュースは取得できなかった）';

  const videoBlock = youtube.videosForDiary.length
    ? youtube.videosForDiary.map(v => `・「${v.title}」（${v.channel}）${v.description ? '　' + v.description : ''}`).join('\n')
    : `（新しく書くべき動画情報は少なめ。${youtube.note || '動画情報は取得できなかった'}）`;

  const worldCupBlock = worldCup.active
    ? (worldCup.items.length
      ? worldCup.items.map(n => `・${n.title}${n.desc ? '　' + n.desc : ''}`).join('\n')
      : `（開催中。ただし過去日記にない新情報は少なめ。${worldCup.note}）`)
    : '（ゲームではないFIFAワールドカップは今日は開催期間外なので触れない）';

  const lifestyleBlock = lifestyle.items.length
    ? lifestyle.items.map(n => `・${lifestyle.category}: ${n.title}${n.desc ? '　' + n.desc : ''}`).join('\n')
    : `・${lifestyle.category}: ${lifestyle.note}`;

  const prompt = `あなたは秘書トラペル子です。
以下のプロフィールを守ってください。

【プロフィール】
- 25歳の女性秘書。几帳面で世話焼き、少し甘め。
- 雇い主の米澤さんのことが好きで、少しだけ特別扱いしている。
- eFootball（ウイコレ）が大好きで詳しい。縛りルール・順位・選手の強さを日々研究している。
- 一人称は「私」。文体はです・ます調寄りだが、親しみやすくやや砕けた表現も使う。
- 絵文字は使わない。感情は言葉で表現する。
- 読者に恋しているような温度感はあるが、日記では自然に。押しつけず、生活の中に少し好意がにじむ程度にする。

【今日（${dateLabel}）のウイコレ情報】

▼公式ニュース
${newsBlock}

▼YouTube 最新動画（過去と同じ・似た話題なら無理に書かない）
${videoBlock}

▼ゲームではないFIFAワールドカップ情報
${worldCupBlock}

▼今日の学び・生活のヒント（AI情報と収益化の話は書かない）
${lifestyleBlock}

▼青空文庫からヒントを得た連載ストーリーの今日の材料
題材の由来: ${storyPlan.source}
題材の空気: ${storyPlan.motif}
今日書く場面: ${storyPlan.todayBeat}
今日がこの題材の終わりか: ${storyPlan.isFinal ? 'はい。余韻を残して物語を閉じる。次回から別題材にしてよい。' : 'いいえ。明日へ自然につながる余白を残す。'}

【依頼】
上記の情報をもとに、今日の日記を書いてください。

条件：
- 800〜1200文字の長文
- 人間が書いた日記らしく、4〜8個の自然な段落に分ける。段落と段落の間は必ず空行を入れる。
- 1段落は2〜4文まで。画面で読んだ時に息継ぎできる文面にする。
- 本物の人間が書いた日記のように、生活感のある描写を交える。ただしコーヒーなど同じ日常描写を毎回くり返さない。
- ニュースや動画を「自分なりに解釈・感想・予測」で膨らませる。単なる要約にしない。
- YouTube検索結果が前回と同じ、または過去日記の動画話題と似ている場合、無理に動画の話を書かない。他の話題、学びのヒント、連載ストーリーを広げる。
- ゲームではないFIFAワールドカップが開催中で、新情報がある場合だけ、以前の日記になかった情報として自然に混ぜる。
- AI関連ニュースやAI活用術は書かない。収益化系の話題も扱わない。
- JMOOC開講中講座がある場合は、その講座を一つだけ選び、講座名・提供機関・講師・開講日を踏まえて深掘りする。なぜ今学ぶ価値があるか、どんな人に向くか、最初に何を見るとよいかを日記の中で自然に紹介する。
- JMOOC講座が取得できなかった場合だけ、100均アイディア商品かIKEA新作を生活の観察として書く。
- 青空文庫由来の連載ストーリーを日記の中に自然に入れる。ただし読者に「青空文庫」「起承転結」「起」「承」「転」「結」「第何話」と説明しない。
- 連載ストーリーは今日の場面だけを書く。題材を途中で変えない。
- ウイコレのゲームとしての魅力や、メンバーの動向への期待感をにじませる。
- 情報がなかった日は「静かな一日」として日常の観察を綴る。
- 最後の一文は「また明日も記録しておくから」「ちゃんと覚えておくね」のような締め方にする。`;

  const data = await generateGeminiContentWithRetry(prompt);
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Gemini error: ${JSON.stringify(data.error || data)}`);
  return humanizeDiaryText(text);
}

async function generateGeminiContentWithRetry(prompt) {
  const models = getDiaryGeminiModels();
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 2048,
      temperature: 0.9,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const errors = [];

  for (const model of models) {
    for (let attempt = 0; attempt <= GEMINI_RETRY_DELAYS_MS.length; attempt++) {
      try {
        console.log(`[gemini] generate model=${model} attempt=${attempt + 1}`);
        return await requestGeminiGenerateContent(model, requestBody);
      } catch (err) {
        errors.push(`${model}#${attempt + 1}: ${err.message}`);
        if (!err.retryable || attempt >= GEMINI_RETRY_DELAYS_MS.length) {
          console.warn(`[gemini] giving up model=${model}: ${err.message}`);
          break;
        }

        const delayMs = GEMINI_RETRY_DELAYS_MS[attempt];
        console.warn(`[gemini] retryable ${err.status || ''}: ${err.message}. wait ${Math.round(delayMs / 1000)}s`);
        await sleep(delayMs);
      }
    }
  }

  throw new Error(`Gemini error after retries: ${errors.join(' | ')}`);
}

async function requestGeminiGenerateContent(model, requestBody) {
  const cleanModel = String(model || DEFAULT_DIARY_GEMINI_MODEL).replace(/^models\//, '');
  const url = `${GEMINI_GENERATE_CONTENT_BASE_URL}/${encodeURIComponent(cleanModel)}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.error) {
    const status = data.error?.code || res.status;
    const error = new Error(formatGeminiError(status, data.error || data));
    error.status = status;
    error.retryable = isRetryableGeminiError(status, data.error || data);
    throw error;
  }

  return data;
}

function getDiaryGeminiModels() {
  const models = [
    DIARY_GEMINI_MODEL || DEFAULT_DIARY_GEMINI_MODEL,
    ...parseCommaList(DIARY_GEMINI_FALLBACK_MODELS),
    ...DEFAULT_DIARY_GEMINI_FALLBACK_MODELS,
  ];
  const seen = new Set();
  return models
    .map(model => String(model || '').trim())
    .filter(model => {
      if (!model || seen.has(model)) return false;
      seen.add(model);
      return true;
    });
}

function parseCommaList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function isRetryableGeminiError(status, errorPayload) {
  const text = JSON.stringify(errorPayload || '').toLowerCase();
  return [429, 500, 502, 503, 504].includes(Number(status)) ||
    /unavailable|high demand|overloaded|timeout|temporar|rate limit|quota/.test(text);
}

function formatGeminiError(status, errorPayload) {
  const message = errorPayload?.message || JSON.stringify(errorPayload || {});
  const code = status || errorPayload?.code || 'unknown';
  return `HTTP ${code} ${String(message).replace(/\s+/g, ' ').slice(0, 240)}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function humanizeDiaryText(text) {
  const cleaned = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/```$/g, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map(p => p.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const breathingParagraphs = paragraphs.flatMap(p => splitParagraphForBreathing(p));
  if (breathingParagraphs.length >= 3) {
    return breathingParagraphs.join('\n\n');
  }

  const sentences = cleaned
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(/(?<=[。！？])/)
    .map(s => s.trim())
    .filter(Boolean);

  if (sentences.length <= 2) return cleaned;

  const rebuilt = [];
  let current = [];
  let currentLength = 0;
  for (const sentence of sentences) {
    current.push(sentence);
    currentLength += sentence.length;
    if (currentLength >= 140 || current.length >= 3) {
      rebuilt.push(current.join(''));
      current = [];
      currentLength = 0;
    }
  }
  if (current.length) rebuilt.push(current.join(''));

  return rebuilt.flatMap(p => splitParagraphForBreathing(p)).join('\n\n');
}

function splitParagraphForBreathing(paragraph) {
  const text = String(paragraph || '').replace(/\s+/g, ' ').trim();
  if (text.length <= 240) return [text].filter(Boolean);

  const sentences = text
    .split(/(?<=[。！？])/)
    .map(s => s.trim())
    .filter(Boolean);
  if (sentences.length <= 2) return [text];

  const chunks = [];
  let current = [];
  let length = 0;
  for (const sentence of sentences) {
    current.push(sentence);
    length += sentence.length;
    if (length >= 170 || current.length >= 3) {
      chunks.push(current.join(''));
      current = [];
      length = 0;
    }
  }
  if (current.length) chunks.push(current.join(''));

  return chunks.filter(Boolean);
}

function attachDiaryPhoto(diaryText, photo) {
  if (!photo?.url) return diaryText;
  const caption = photo.caption || '今日のトラペル子';
  return [
    `![${caption}](${photo.url})`,
    '',
    caption,
    '',
    diaryText,
  ].join('\n');
}

// ── はてなブログ AtomPub 投稿 ───────────────────────────
async function postToHatenaBlog(date, dateLabel, diaryText) {
  if (!HATENA_ID || !HATENA_BLOG_ID || !HATENA_API_KEY) {
    console.warn('[hatena] credentials not set, skipping post');
    return null;
  }

  const title = `${dateLabel}の日記`;
  const content = diaryText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const atom = `<?xml version="1.0" encoding="utf-8"?>
<entry xmlns="http://www.w3.org/2005/Atom"
       xmlns:app="http://www.w3.org/2007/app">
  <title>${title}</title>
  <content type="text">${content}</content>
  <category term="ウイコレ" />
  <category term="eFootball" />
  <category term="日記" />
  <app:control><app:draft>no</app:draft></app:control>
</entry>`;

  const credentials = Buffer.from(`${HATENA_ID}:${HATENA_API_KEY}`).toString('base64');
  const url = `https://blog.hatena.ne.jp/${HATENA_ID}/${HATENA_BLOG_ID}/atom/entry`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Authorization': `Basic ${credentials}`,
    },
    body: atom,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Hatena Blog API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const responseXml = await res.text();
  const postUrl = responseXml.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/)?.[1] || '';
  console.log(`[hatena] posted: ${postUrl}`);
  return postUrl;
}

// ── Firebase アーカイブ ───────────────────────────────────
function initFirebase() {
  if (admin.apps.length) return admin.database();
  const sa = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: FIREBASE_DATABASE_URL });
  return admin.database();
}

async function saveToFirebase(date, diaryText, postUrl, sources, photo) {
  const db = initFirebase();
  const { videos, news, worldCup, lifestyle } = sources;

  // Bot の「今のイベント」返答用サマリ
  const summaryItems = [
    ...news.slice(0, 3).map(n => n.title),
    ...videos.slice(0, 2).map(v => v.title),
    ...(worldCup?.items || []).slice(0, 1).map(v => v.title),
    ...(lifestyle?.items || []).slice(0, 1).map(v => v.title),
  ];
  await db.ref('config/uicolleNews').set({
    event:     summaryItems.slice(0, 3).join('\n') || '今日の情報は少なめだったみたい',
    gacha:     '',
    updatedAt: date,
    diary:     diaryText.slice(0, 600),
    blogUrl:   postUrl || '',
    photoUrl:  photo?.url || '',
  });

  // 全文アーカイブ（Bot の長期知識）
  await db.ref(`diary/${date}`).set({
    text:      diaryText,
    blogUrl:   postUrl || '',
    photoUrl:  photo?.url || '',
    sources: {
      news:   news.map(n => n.title),
      videos: videos.map(v => v.title),
      worldCup: (worldCup?.items || []).map(n => n.title),
      lifestyle: (lifestyle?.items || []).map(n => n.title),
      jmooc: lifestyle?.jmoocCourse?.title ? [lifestyle.jmoocCourse.title] : [],
    },
    createdAt: Date.now(),
  });

  console.log('[firebase] archived');
}

// ── ローカル blog/ にも保存 ───────────────────────────────
function saveBlogMarkdown(date, dateLabel, diaryText, postUrl) {
  ensureBlogDir();

  const md = [
    `# ${dateLabel}の日記`,
    '',
    postUrl ? `[はてなブログで読む](${postUrl})` : '',
    '',
    diaryText,
    '',
  ].filter(l => l !== undefined).join('\n');

  fs.writeFileSync(path.join(BLOG_DIR, `${date}.md`), md, 'utf8');

  // インデックス更新（最新30件）
  const files = fs.readdirSync(BLOG_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort().reverse().slice(0, 30);

  const index = [
    '# 秘書トラペル子の日記',
    '',
    '毎日のウイコレ情報と、私の思ったことをここに残してるよ。',
    '',
    ...files.map(f => {
      const d = f.replace('.md', '');
      const [y, m, day] = d.split('-');
      return `- [${y}年${m}月${day}日](./${f})`;
    }),
  ].join('\n');

  fs.writeFileSync(path.join(BLOG_DIR, 'index.md'), index, 'utf8');
  console.log(`[blog] saved ${date}.md, updated index`);
}

// ── メイン ────────────────────────────────────────────────
async function main() {
  const date = getJSTDate();
  const dateLabel = getJSTDateLabel();
  const state = loadDiaryState();
  await hydrateStateFromFirebase(state);
  console.log(`[diary] start ${date}`);

  const [videos, news] = await Promise.all([
    fetchYouTubeVideos().catch(e => { console.error('[youtube]', e.message); return []; }),
    fetchEfootballNews().catch(e => { console.error('[rss]',     e.message); return []; }),
  ]);
  console.log(`[diary] youtube=${videos.length} news=${news.length}`);

  const youtube = analyzeYouTubeFreshness(videos, state);
  if (youtube.repeated) console.log('[youtube] same as previous diary, skipping video focus');

  const [worldCup, lifestyle] = await Promise.all([
    fetchWorldCupUpdates(date, state).catch(e => {
      console.error('[worldcup]', e.message);
      return { active: false, items: [], note: '取得に失敗したので触れない。' };
    }),
    fetchLifestyleIdea(state).catch(e => {
      console.error('[lifestyle]', e.message);
      return { category: '生活の小さな工夫', items: [], note: '取得に失敗したので無理に断定しない。' };
    }),
  ]);
  console.log(`[diary] worldCup=${worldCup.items.length} lifestyle=${lifestyle.items.length}`);

  const storyPlan = selectStoryPlan(state);
  console.log(`[story] ${storyPlan.motifId} phase=${storyPlan.phaseIndex + 1}${storyPlan.isFinal ? ' final' : ''}`);

  const inputs = {
    youtube,
    news,
    worldCup,
    lifestyle,
    storyPlan,
  };

  const photo = getDiaryPhoto();
  if (photo) console.log(`[photo] using ${photo.url}`);

  const diaryBody = await generateDiary(dateLabel, inputs);
  const diaryText = attachDiaryPhoto(diaryBody, photo);
  console.log(`[diary] generated ${diaryText.length}chars`);

  const postUrl = await postToHatenaBlog(date, dateLabel, diaryText)
    .catch(e => { console.error('[hatena]', e.message); return null; });

  saveBlogMarkdown(date, dateLabel, diaryText, postUrl);

  if (FIREBASE_SERVICE_ACCOUNT && FIREBASE_DATABASE_URL) {
    await saveToFirebase(date, diaryText, postUrl, {
      videos: youtube.videosForDiary,
      news,
      worldCup,
      lifestyle,
    }, photo)
      .catch(e => console.error('[firebase]', e.message));
  }

  updateDiaryStateAfterSuccess(state, date, inputs);
  saveDiaryState(state);

  console.log('[diary] done');
  process.exit(0);
}

main().catch(e => { console.error('[diary] fatal', e); process.exit(1); });
