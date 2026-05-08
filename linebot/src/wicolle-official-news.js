'use strict';

const WICOLLE_NEWS_URL = 'https://wecc.mo.konami.net/aut/main/html/news/index.php?ssid=1&lang=1&tz_offset=9&display_type=0';
const WICOLLE_DETAIL_URL = 'https://wecc.mo.konami.net/aut/main/html/news/detail.php';
const WICOLLE_LOOKBACK_DAYS = 14;
const WICOLLE_MAX_ITEMS = 8;
const WICOLLE_DEFAULT_MAX_PROBE_REQUESTS = 48;
const DEFAULT_DETAIL_ID_SEEDS = ['2026050810', '2026050707', '2026050703'];

async function fetchWicolleOfficialNews(options = {}) {
  const ssid = String(options.ssid || process.env.WICOLLE_SSID || '').trim();
  if (!ssid) {
    return { allItems: [], ok: false, note: 'WICOLLE_SSID not set' };
  }

  const fetchImpl = options.fetchImpl || fetch;
  const cookie = buildWicolleCookie(ssid);
  try {
    let html = '';
    let listNote = '';
    try {
      const res = await fetchImpl(WICOLLE_NEWS_URL, {
        headers: buildWicolleHeaders(cookie),
        signal: AbortSignal.timeout(options.timeoutMs || 7000),
      });
      if (res.ok) {
        html = await res.text();
      } else {
        listNote = `list status ${res.status}`;
      }
    } catch (err) {
      listNote = `list fetch ${err?.message || err}`;
    }

    if (html && /login|session|expired|error|ログイン|セッション|認証|ログアウト/i.test(stripTags(html).slice(0, 500)) && !/detail\.php\?idx=/.test(html)) {
      return { allItems: [], ok: false, note: 'session expired' };
    }

    const now = options.now || new Date();
    const detailIdxSeeds = parseDetailIdxSeeds([
      ...DEFAULT_DETAIL_ID_SEEDS,
      ...(Array.isArray(options.detailIdxs) ? options.detailIdxs : parseDetailIdxSeeds(options.detailIdxs || '')),
      ...parseDetailIdxSeeds(process.env.WICOLLE_DETAIL_ID_SEEDS || process.env.WICOLLE_DETAIL_IDS || ''),
    ]);
    const discoveredIdxs = generateRecentDetailIdxCandidates(now, options.lookbackDays || WICOLLE_LOOKBACK_DAYS);
    const listItems = mergeWicolleItems(
      parseWicolleNewsList(html),
      [...discoveredIdxs, ...detailIdxSeeds].map(idx => ({
        idx,
        date: formatWicolleIdxDate(idx),
        title: '',
        content: '',
        source: detailIdxSeeds.includes(idx) ? 'detail-seed' : 'auto-probe',
      }))
    )
      .filter(item => isRecentWicolleIdx(item.idx, now, options.lookbackDays || WICOLLE_LOOKBACK_DAYS));
    const detailed = await fetchWicolleDetailItems(listItems, {
      cookie,
      fetchImpl,
      maxItems: options.maxItems || WICOLLE_MAX_ITEMS,
      maxProbeRequests: options.maxProbeRequests || WICOLLE_DEFAULT_MAX_PROBE_REQUESTS,
      timeoutMs: options.timeoutMs || 7000,
    });

    const allItems = detailed
      .filter(isUsableWicolleItem)
      .map(item => ({
        ...item,
        category: classifyWicolleItem(item),
      }));
    return {
      allItems,
      ok: allItems.length > 0,
      note: allItems.length ? '' : (listNote || 'no current items'),
    };
  } catch (err) {
    return { allItems: [], ok: false, note: err?.message || String(err) };
  }
}

async function fetchWicolleDetailContent(idx, cookie, fetchImpl = fetch, timeoutMs = 7000) {
  const item = await fetchWicolleDetailItem(idx, cookie, fetchImpl, timeoutMs);
  return item.content;
}

async function fetchWicolleDetailItem(idx, cookie, fetchImpl = fetch, timeoutMs = 7000) {
  if (!idx) return { idx: '', title: '', content: '' };
  const url = buildWicolleDetailUrl(idx);
  const res = await fetchImpl(url, {
    headers: buildWicolleHeaders(cookie, WICOLLE_NEWS_URL),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return { idx, title: '', content: '' };
  const html = await res.text();
  const bodyHtml = html.split(/<\/style>/i).pop() || html;
  const detail = bodyHtml.match(/<div[^>]+class=["'][^"']*detail_body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]
    || bodyHtml.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    || '';
  const content = normalizeWicolleText(detail || bodyHtml).slice(0, 1000);
  const extractedTitle = extractWicolleDetailTitle(html, detail);
  return {
    idx,
    date: formatWicolleIdxDate(idx),
    title: isGenericWicolleTitle(extractedTitle) ? inferWicolleTitleFromContent(content) : extractedTitle,
    content,
    detailUrl: url,
  };
}

async function fetchWicolleDetailItems(items, options) {
  const maxItems = Number(options.maxItems || WICOLLE_MAX_ITEMS);
  const maxProbeRequests = Number(options.maxProbeRequests || WICOLLE_DEFAULT_MAX_PROBE_REQUESTS);
  const candidates = (Array.isArray(items) ? items : []).slice(0, maxProbeRequests);
  const results = [];
  const batchSize = 8;

  for (let i = 0; i < candidates.length && results.length < maxItems; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const detailed = await Promise.all(batch.map(async item => {
      const detail = await fetchWicolleDetailItem(item.idx, options.cookie, options.fetchImpl, options.timeoutMs).catch(() => null);
      return {
        ...item,
        title: normalizeWicolleText(item.title || detail?.title || '').slice(0, 120),
        content: detail?.content || '',
        detailUrl: buildWicolleDetailUrl(item.idx),
        source: item.source || 'wicolle-list',
      };
    }));
    for (const item of detailed) {
      if (isUsableWicolleItem(item)) results.push(item);
      if (results.length >= maxItems) break;
    }
  }

  return results;
}

function buildWicolleNewsSnapshot(result, options = {}) {
  const existing = options.existing || {};
  const date = options.date || '';
  const allItems = Array.isArray(result?.allItems) ? result.allItems : [];
  const items = allItems.slice(0, 20).map(item => ({
    idx: item.idx || '',
    date: item.date || '',
    title: item.title || '',
    content: clipWicolleText(item.content || '', 700),
    category: item.category || classifyWicolleItem(item),
    source: item.source || '',
    detailUrl: item.detailUrl || buildWicolleDetailUrl(item.idx),
    keywords: extractWicolleKeywords(item),
  }));

  return {
    event: buildUicolleFieldSummary(items, 'event'),
    gacha: buildUicolleFieldSummary(items, 'gacha'),
    updatedAt: date,
    diary: existing.diary || '',
    blogUrl: existing.blogUrl || '',
    photoUrl: existing.photoUrl || '',
    source: items.length ? 'wicolle-game-news' : 'none',
    note: result?.note || '',
    fetchedAt: Date.now(),
    items,
  };
}

function shouldRefreshUicolleNews(news, kind, today) {
  if (!process.env.WICOLLE_SSID) return false;
  if (!news) return true;
  if (news.source !== 'wicolle-game-news') return true;
  if (news.updatedAt !== today) return true;
  if (!Array.isArray(news.items) || !news.items.length) return true;
  if (kind === 'event' && !String(news.event || '').trim()) return true;
  if (kind === 'gacha' && !String(news.gacha || '').trim()) return true;
  return false;
}

function parseWicolleNewsList(html) {
  const items = [];
  const seen = new Set();
  const source = String(html || '');
  for (const match of source.matchAll(/<a[^>]+href=["'][^"']*detail\.php\?idx=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const idx = match[1];
    if (!idx || seen.has(idx)) continue;
    seen.add(idx);
    const block = match[2] || '';
    const title = decodeHtml(
      block.match(/<img[^>]+alt=["']([^"']+)["']/i)?.[1]
      || block.match(/<div[^>]+class=["'][^"']*infolist_title[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]
      || stripTags(block)
    ).trim();
    items.push({
      idx,
      date: formatWicolleIdxDate(idx),
      title: normalizeWicolleText(title).slice(0, 120),
      content: '',
    });
  }
  for (const match of source.matchAll(/detail\.php\?idx=(\d{8,})/gi)) {
    const idx = match[1];
    if (!idx || seen.has(idx)) continue;
    seen.add(idx);
    items.push({
      idx,
      date: formatWicolleIdxDate(idx),
      title: '',
      content: '',
      source: 'wicolle-list-loose',
    });
  }
  return items;
}

function mergeWicolleItems(primary, seeded) {
  const result = [];
  const seen = new Set();
  for (const item of [...(primary || []), ...(seeded || [])]) {
    if (!item?.idx || seen.has(item.idx)) continue;
    seen.add(item.idx);
    result.push(item);
  }
  return result;
}

function parseDetailIdxSeeds(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[,\s]+/);
  return values
    .map(v => String(v || '').trim())
    .map(v => v.match(/idx=(\d+)/)?.[1] || v.match(/^(\d{8,})$/)?.[1] || '')
    .filter(Boolean);
}

function generateRecentDetailIdxCandidates(now = new Date(), lookbackDays = WICOLLE_LOOKBACK_DAYS) {
  const candidates = [];
  const base = new Date(now.getTime());
  for (let offset = 0; offset < lookbackDays; offset++) {
    const date = new Date(base.getTime() - offset * 24 * 60 * 60 * 1000);
    const ymd = formatDateForIdx(date);
    for (let suffix = 20; suffix >= 1; suffix--) {
      candidates.push(`${ymd}${String(suffix).padStart(2, '0')}`);
    }
  }
  return candidates;
}

function formatDateForIdx(date) {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}${parts.month}${parts.day}`;
}

function isUsableWicolleItem(item) {
  const title = normalizeWicolleText(item?.title || '');
  const content = normalizeWicolleText(item?.content || '');
  if (!item?.idx || content.length < 8) return false;
  // Reject error/login pages (English and Japanese)
  // NOTE: ログイン(?!ボーナス) to avoid false-rejecting "ログインボーナス" (game feature)
  if (/ページが見つかりません|not found|error|session expired|login/i.test(content)) return false;
  if (/ログイン(?!ボーナス)|セッション.*切れ|ご利用には.*ログイン|アクセス.*制限|unauthorized/.test(content)) return false;
  // Must contain game-specific content to avoid false positives from login/redirect pages
  const combined = title + ' ' + content;
  if (!/(ウイコレ|ウイニングイレブン|eFootball|ガチャ|スカウト|イベント|チャレンジ|ミッション|ログインボーナス|ボーナスタイム|選手|カード|開催|スペシャル|KONAMI|コラボ)/i.test(combined)) return false;
  return true;
}

function extractWicolleDetailTitle(html, detailHtml = '') {
  const title = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    || String(html || '').match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || String(html || '').match(/<div[^>]+class=["'][^"']*(?:detail_title|news_title|title)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]
    || String(html || '').match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    || String(detailHtml || '').match(/<img[^>]+alt=["']([^"']+)["']/i)?.[1]
    || '';
  return normalizeWicolleText(title)
    .replace(/^ウイニングイレブンカードコレクション\s*/i, '')
    .replace(/^ウイコレ\s*/i, '')
    .slice(0, 120);
}

function isGenericWicolleTitle(title) {
  return /^(インフォメーション|お知らせ|news)?$/i.test(normalizeWicolleText(title));
}

function inferWicolleTitleFromContent(content) {
  const text = normalizeWicolleText(content);
  const patterns = [
    /(スペシャルチャレンジデイズ)/,
    /(ネクサスオークション)/,
    /(ロード・?トゥ・?グローリー)/,
    /([『"]?NARUTO[^」』]*[」』]?\s*コラボ記念(?:ピックアップ)?(?:11連)?ガチャ)/,
    /(コラボ記念(?:ピックアップ)?(?:11連)?ガチャ)/,
    /((?:ピックアップ|毎週1回無料|11連|コラボ記念)[^。]{0,50}ガチャ)/,
    /(エターナル\s*2026[^。]{0,30})/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return normalizeWicolleText(match[1]).slice(0, 80);
  }
  const firstSentence = text.split(/。|！|!|\n/).map(s => s.trim()).find(Boolean);
  return firstSentence ? firstSentence.slice(0, 80) : 'ウイコレ公式インフォ';
}

function buildUicolleFieldSummary(items, kind) {
  return (Array.isArray(items) ? items : [])
    .filter(item => item.category === kind || classifyWicolleItem(item) === kind)
    .slice(0, 4)
    .map(item => {
      const title = normalizeWicolleText(item.title || '');
      const header = `【${item.date || item.idx || '日付不明'}】${title}`;
      const content = item.content ? `\n${clipWicolleText(item.content, 360)}` : '';
      return `${header}${content}`;
    })
    .join('\n\n');
}

function classifyWicolleItem(item) {
  if (isWicolleGachaItem(item)) return 'gacha';
  if (isWicolleEventItem(item)) return 'event';
  return 'other';
}

function extractWicolleKeywords(item) {
  const text = normalizeWicolleText(`${item?.title || ''} ${item?.content || ''}`);
  const keywords = [
    'スペシャルチャレンジデイズ',
    'ロード・トゥ・グローリー',
    'ボーナスタイム',
    'ログインボーナス',
    'ミッション',
    'ゲストチーム',
    'ネクサスオークション',
    'NARUTO',
    'スカウト',
    'ガチャ',
    'ピックアップ',
    'レジェンド',
    'エピック',
    'ショータイム',
  ].filter(keyword => text.includes(keyword));
  return [...new Set(keywords)];
}

function isWicolleEventItem(item) {
  const text = normalizeWicolleText(`${item?.title || ''} ${item?.content || ''}`);
  if (!text || isNonWicolleDiaryTopic(text)) return false;
  if (isWicolleGachaItem(item)) return false;
  return /(イベント|チャレンジ|デイズ|キャンペーン|ロード・?トゥ・?グローリー|ボーナスタイム|ログインボーナス|ミッション|カップ|ツアー|フェス|リーグ|マッチ|ゲストチーム|開催|ランキング|スタジアム|キャンプ|グローリー|ネクサスオークション|オークション|入札期間)/i.test(text);
}

function isWicolleGachaItem(item) {
  const text = normalizeWicolleText(`${item?.title || ''} ${item?.content || ''}`);
  if (!text || isNonWicolleDiaryTopic(text)) return false;
  return /(ガチャ|スカウト|パック|カード|選手登場|スペシャル.*選手|レジェンド|エピック|epic|legend|potw|show\s*time|ショータイム|ブースター|booster|ナショナル|ピックアップ)/i.test(text);
}

function isNonWicolleDiaryTopic(text) {
  return /(ikea|イケア|ダイソー|セリア|キャンドゥ|100均|百均|unico|standard products|スタンダードプロダクツ|ポケベル|90年代|注目アイテム|ショップ|グッズ|家具|収納|ソファ|トレー|シリコン|文具|JMOOC|講座|青空文庫)/i.test(String(text || ''));
}

function normalizeWicolleText(value) {
  return decodeHtml(stripTags(String(value || '')))
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function clipWicolleText(text, maxLength) {
  const normalized = normalizeWicolleText(text);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function buildWicolleCookie(ssid) {
  const webview = encodeURIComponent(`lang=1&tz_offset=9&_ssid=${ssid}&ssid=&legal_country=164`);
  return `_ssid=${ssid}; WEBVIEW=${webview}`;
}

function buildWicolleHeaders(cookie, referer = '') {
  const headers = {
    Cookie: cookie,
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ja',
  };
  if (referer) headers['Referer'] = referer;
  return headers;
}

function buildWicolleDetailUrl(idx) {
  return `${WICOLLE_DETAIL_URL}?idx=${encodeURIComponent(idx)}&ssid=1&lang=1&tz_offset=9&display_type=0`;
}

function isRecentWicolleIdx(idx, now = new Date(), lookbackDays = WICOLLE_LOOKBACK_DAYS) {
  const date = parseWicolleIdxDate(idx);
  if (!date) return true;
  const ageMs = now.getTime() - date.getTime();
  return ageMs <= lookbackDays * 24 * 60 * 60 * 1000 && ageMs >= -2 * 24 * 60 * 60 * 1000;
}

function parseWicolleIdxDate(idx) {
  const m = String(idx || '').match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00`);
}

function formatWicolleIdxDate(idx) {
  const m = String(idx || '').match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : '';
}

module.exports = {
  fetchWicolleOfficialNews,
  buildWicolleNewsSnapshot,
  shouldRefreshUicolleNews,
  parseWicolleNewsList,
  classifyWicolleItem,
  parseDetailIdxSeeds,
  generateRecentDetailIdxCandidates,
};
