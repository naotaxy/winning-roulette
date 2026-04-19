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

function getJSTDateParts() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const year  = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const day   = now.getUTCDate();
  const totalDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const weekday = weekdays[now.getUTCDay()];
  return { year, month, day, totalDays, weekday };
}

// ── YouTube 動画収集 ──────────────────────────────────────
async function fetchYouTubeVideos() {
  if (!YOUTUBE_API_KEY) { console.warn('[youtube] no API key'); return []; }

  const q = encodeURIComponent('eFootball ウイコレ');
  const url = `https://www.googleapis.com/youtube/v3/search`
    + `?part=snippet&q=${q}&type=video&order=date`
    + `&maxResults=8&key=${YOUTUBE_API_KEY}`;

  const res = await fetch(url);
  const data = await res.json();
  if (!data.items) { console.warn('[youtube] empty response', JSON.stringify(data.error || data).slice(0, 200)); return []; }
  console.log(`[youtube] got ${data.items.length} items, totalResults=${data.pageInfo?.totalResults}`);

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

// ── 青空文庫 月別テーマ ───────────────────────────────────
const MONTHLY_NOVEL = {
  1:  { title: '雪国',         author: '川端康成',   theme: '孤独と美、冬の静寂の中で出会う謎めいた人物' },
  2:  { title: '痴人の愛',     author: '谷崎潤一郎', theme: '執着と逃れられない関係、予測不能な感情の渦' },
  3:  { title: '人間失格',     author: '太宰治',     theme: '自分を偽りながら生きる日常に忍び込む異変' },
  4:  { title: '坊っちゃん',   author: '夏目漱石',   theme: '曲がったことが嫌いな主人公が巻き込まれる騒動' },
  5:  { title: '羅生門',       author: '芥川龍之介', theme: '善悪の境界が崩れていく瞬間に立ち会う恐怖' },
  6:  { title: 'こころ',       author: '夏目漱石',   theme: '秘密を抱えた人物との距離が縮まる夏' },
  7:  { title: '山月記',       author: '中島敦',     theme: '自分の中の獣性が目覚める夏の夜の怪異' },
  8:  { title: '蜘蛛の糸',     author: '芥川龍之介', theme: '一本の細い糸を巡る救いと裏切りの物語' },
  9:  { title: 'ノルウェイの森', author: '村上春樹',  theme: '失われたものを探す秋の旅と出会い' },
  10: { title: '斜陽',         author: '太宰治',     theme: '崩れていく日常の中で見つける最後の光' },
  11: { title: '銀河鉄道の夜', author: '宮沢賢治',   theme: '不思議な乗客とともに向かう未知の終着駅' },
  12: { title: '吾輩は猫である', author: '夏目漱石', theme: '年の瀬に猫の目から見た人間たちの奇妙な行動' },
};

// ── Gemini 日記生成 ──────────────────────────────────────
async function generateDiary(dateLabel, videos, news) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');

  const { month, day, totalDays, weekday } = getJSTDateParts();

  const newsBlock = news.length
    ? news.map(n => `・${n.title}${n.desc ? '　' + n.desc : ''}`).join('\n')
    : '（公式ニュースは取得できなかった）';

  const videoBlock = videos.length
    ? videos.map(v => `・「${v.title}」（${v.channel}）${v.description ? '　' + v.description : ''}`).join('\n')
    : '（動画情報は取得できなかった）';

  const novel = MONTHLY_NOVEL[month] || MONTHLY_NOVEL[4];

  // 起承転結の位置を計算
  const progress = day / totalDays;
  let storyPhase;
  if (progress <= 0.25)      storyPhase = `起（世界観・登場人物の紹介。全体の序盤、${day}日目/${totalDays}日中）`;
  else if (progress <= 0.5)  storyPhase = `承（状況の展開・謎や伏線の提示。${day}日目/${totalDays}日中）`;
  else if (progress <= 0.75) storyPhase = `転（予想外の出来事・クライマックスへの助走。${day}日目/${totalDays}日中）`;
  else                       storyPhase = `結（謎の解決・余韻と締め。${day}日目/${totalDays}日中）`;

  const prompt = `あなたは秘書トラペル子です。以下のプロフィールと構成に従って今日の日記を書いてください。

【プロフィール】
- 25歳の女性秘書。几帳面で世話焼き、少し甘め。
- eFootball（ウイコレ）が大好きで詳しい。センス・アドセンス・スカウト周期を日々研究している。
- 一人称は「私」。文体はです・ます調寄りだが、親しみやすくやや砕けた表現も使う。
- 絵文字は使わない。感情は言葉で表現する。

【今日の情報】
- 日付: ${dateLabel}（${weekday}曜日）
- ウイコレ公式ニュース: ${newsBlock}
- YouTube最新動画: ${videoBlock}

【今月の連載小説テーマ】
- 作品: 「${novel.title}」（${novel.author}）からヒントを得た創作
- テーマ: ${novel.theme}
- 今日のフェーズ: ${storyPhase}

【日記の構成（この順番で書くこと）】

①東京の今日の天気と朝の空気感（${month}月${day}日の季節感から推定して2〜3文）

②今朝したこと（窓を開ける・コーヒーを淹れるなど1〜2文の日常の一コマ）

③ウイコレの調査結果と感想（上記のニュース・動画を自分なりに解釈・考察。単なる要約にせず、センスやスカウト周期への期待や分析を交える）

④今月の連載ストーリー 今日のエピソード（「${novel.title}」のテーマを借りた創作。トラペル子自身が体験する形で、今日のフェーズ「${storyPhase}」に合った展開を書く。読み手がワクワクするような小さな事件や伏線を散りばめる）

条件：
- 合計700〜1000文字
- 最後の一文は「また明日も記録しておくから」「ちゃんと覚えておくね」のような締め方にする。`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0.9,
          thinkingConfig: { thinkingBudget: 0 },
        },
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
