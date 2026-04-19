'use strict';
/**
 * 秘書トラペル子 — 日次日記生成スクリプト
 *
 * 1. YouTube Data API v3 でウイコレ関連動画を収集
 * 2. eFootball 公式 RSS でニュースを収集
 * 3. Gemini で長文・人間らしい日記を生成
 * 4. はてなブログ AtomPub API で投稿
 * 5. Firebase にアーカイブ保存（Bot の知識源）
 *
 * GitHub Secrets 必要:
 *   YOUTUBE_API_KEY, GEMINI_API_KEY,
 *   HATENA_ID, HATENA_BLOG_ID, HATENA_API_KEY,
 *   FIREBASE_SERVICE_ACCOUNT, FIREBASE_DATABASE_URL
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
} = process.env;

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
async function generateDiary(dateLabel, videos, news) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');

  const newsBlock = news.length
    ? news.map(n => `・${n.title}${n.desc ? '　' + n.desc : ''}`).join('\n')
    : '（公式ニュースは取得できなかった）';

  const videoBlock = videos.length
    ? videos.map(v => `・「${v.title}」（${v.channel}）${v.description ? '　' + v.description : ''}`).join('\n')
    : '（動画情報は取得できなかった）';

  const prompt = `あなたは秘書トラペル子です。
以下のプロフィールを守ってください。

【プロフィール】
- 25歳の女性秘書。几帳面で世話焼き、少し甘め。
- 雇い主の米澤さんのことが好きで、少しだけ特別扱いしている。
- eFootball（ウイコレ）が大好きで詳しい。縛りルール・順位・選手の強さを日々研究している。
- 一人称は「私」。文体はです・ます調寄りだが、親しみやすくやや砕けた表現も使う。
- 絵文字は使わない。感情は言葉で表現する。

【今日（${dateLabel}）のウイコレ情報】

▼公式ニュース
${newsBlock}

▼YouTube 最新動画（この7日間）
${videoBlock}

【依頼】
上記の情報をもとに、今日の日記を書いてください。

条件：
- 600〜900文字の長文
- 本物の人間が書いた日記のように、生活感のある描写を交える
  （例：「今日もコーヒーを飲みながら画面を眺めていたら〜」「米澤さんがまた試合の話をしていて〜」など）
- ニュースや動画を「自分なりに解釈・感想・予測」で膨らませる。単なる要約にしない。
- ウイコレのゲームとしての魅力や、メンバーの動向への期待感をにじませる。
- 情報がなかった日は「静かな一日」として日常の観察を綴る。
- 最後の一文は「また明日も記録しておくから」「ちゃんと覚えておくね」のような締め方にする。`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1200, temperature: 0.9 },
      }),
    }
  );
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Gemini error: ${JSON.stringify(data.error || data)}`);
  return text.trim();
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

async function saveToFirebase(date, diaryText, postUrl, videos, news) {
  const db = initFirebase();

  // Bot の「今のイベント」返答用サマリ
  const summaryItems = [
    ...news.slice(0, 3).map(n => n.title),
    ...videos.slice(0, 2).map(v => v.title),
  ];
  await db.ref('config/uicolleNews').set({
    event:     summaryItems.slice(0, 3).join('\n') || '今日の情報は少なめだったみたい',
    gacha:     '',
    updatedAt: date,
    diary:     diaryText.slice(0, 600),
    blogUrl:   postUrl || '',
  });

  // 全文アーカイブ（Bot の長期知識）
  await db.ref(`diary/${date}`).set({
    text:      diaryText,
    blogUrl:   postUrl || '',
    sources: {
      news:   news.map(n => n.title),
      videos: videos.map(v => v.title),
    },
    createdAt: Date.now(),
  });

  console.log('[firebase] archived');
}

// ── ローカル blog/ にも保存 ───────────────────────────────
function saveBlogMarkdown(date, dateLabel, diaryText, postUrl) {
  const blogDir = path.join(__dirname, '..', 'blog');
  fs.mkdirSync(blogDir, { recursive: true });

  const md = [
    `# ${dateLabel}の日記`,
    '',
    postUrl ? `[はてなブログで読む](${postUrl})` : '',
    '',
    diaryText,
    '',
  ].filter(l => l !== undefined).join('\n');

  fs.writeFileSync(path.join(blogDir, `${date}.md`), md, 'utf8');

  // インデックス更新（最新30件）
  const files = fs.readdirSync(blogDir)
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

  fs.writeFileSync(path.join(blogDir, 'index.md'), index, 'utf8');
  console.log(`[blog] saved ${date}.md, updated index`);
}

// ── メイン ────────────────────────────────────────────────
async function main() {
  const date = getJSTDate();
  const dateLabel = getJSTDateLabel();
  console.log(`[diary] start ${date}`);

  const [videos, news] = await Promise.all([
    fetchYouTubeVideos().catch(e => { console.error('[youtube]', e.message); return []; }),
    fetchEfootballNews().catch(e => { console.error('[rss]',     e.message); return []; }),
  ]);
  console.log(`[diary] youtube=${videos.length} news=${news.length}`);

  const diaryText = await generateDiary(dateLabel, videos, news);
  console.log(`[diary] generated ${diaryText.length}chars`);

  const postUrl = await postToHatenaBlog(date, dateLabel, diaryText)
    .catch(e => { console.error('[hatena]', e.message); return null; });

  saveBlogMarkdown(date, dateLabel, diaryText, postUrl);

  if (FIREBASE_SERVICE_ACCOUNT && FIREBASE_DATABASE_URL) {
    await saveToFirebase(date, diaryText, postUrl, videos, news)
      .catch(e => console.error('[firebase]', e.message));
  }

  console.log('[diary] done');
  process.exit(0);
}

main().catch(e => { console.error('[diary] fatal', e); process.exit(1); });
