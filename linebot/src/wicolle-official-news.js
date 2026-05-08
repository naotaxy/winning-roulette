'use strict';

const WICOLLE_NEWS_URL = 'https://wecc.mo.konami.net/aut/main/html/news/index.php?ssid=1&lang=1&tz_offset=9&display_type=0';
const WICOLLE_DETAIL_URL = 'https://wecc.mo.konami.net/aut/main/html/news/detail.php';
const WICOLLE_LOOKBACK_DAYS = 14;
const WICOLLE_MAX_ITEMS = 8;

async function fetchWicolleOfficialNews(options = {}) {
  const ssid = String(options.ssid || process.env.WICOLLE_SSID || '').trim();
  if (!ssid) {
    return { allItems: [], ok: false, note: 'WICOLLE_SSID not set' };
  }

  const fetchImpl = options.fetchImpl || fetch;
  const cookie = buildWicolleCookie(ssid);
  try {
    const res = await fetchImpl(WICOLLE_NEWS_URL, {
      headers: buildWicolleHeaders(cookie),
      signal: AbortSignal.timeout(options.timeoutMs || 7000),
    });
    if (!res.ok) {
      return { allItems: [], ok: false, note: `list status ${res.status}` };
    }

    const html = await res.text();
    if (/login|session|expired|error/i.test(stripTags(html).slice(0, 500)) && !/detail\.php\?idx=/.test(html)) {
      return { allItems: [], ok: false, note: 'session expired' };
    }

    const now = options.now || new Date();
    const listItems = parseWicolleNewsList(html)
      .filter(item => isRecentWicolleIdx(item.idx, now, options.lookbackDays || WICOLLE_LOOKBACK_DAYS));
    const limited = listItems.slice(0, options.maxItems || WICOLLE_MAX_ITEMS);
    const detailed = await Promise.all(limited.map(async item => ({
      ...item,
      content: await fetchWicolleDetailContent(item.idx, cookie, fetchImpl, options.timeoutMs || 7000).catch(() => ''),
    })));

    const allItems = detailed
      .filter(item => item.title)
      .map(item => ({
        ...item,
        category: classifyWicolleItem(item),
      }));
    return {
      allItems,
      ok: allItems.length > 0,
      note: allItems.length ? '' : 'no current items',
    };
  } catch (err) {
    return { allItems: [], ok: false, note: err?.message || String(err) };
  }
}

async function fetchWicolleDetailContent(idx, cookie, fetchImpl = fetch, timeoutMs = 7000) {
  if (!idx) return '';
  const url = `${WICOLLE_DETAIL_URL}?idx=${encodeURIComponent(idx)}`;
  const res = await fetchImpl(url, {
    headers: buildWicolleHeaders(cookie),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return '';
  const html = await res.text();
  const bodyHtml = html.split(/<\/style>/i).pop() || html;
  const detail = bodyHtml.match(/<div[^>]+class=["'][^"']*detail_body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]
    || bodyHtml.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    || '';
  return normalizeWicolleText(detail).slice(0, 1000);
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
  for (const match of source.matchAll(/<a[^>]+href=["']\.\/detail\.php\?idx=(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
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
  return items;
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

function isWicolleEventItem(item) {
  const text = normalizeWicolleText(`${item?.title || ''} ${item?.content || ''}`);
  if (!text || isNonWicolleDiaryTopic(text)) return false;
  if (isWicolleGachaItem(item)) return false;
  return /(イベント|チャレンジ|デイズ|キャンペーン|ロード・?トゥ・?グローリー|ボーナスタイム|ログインボーナス|ミッション|カップ|ツアー|フェス|リーグ|マッチ|ゲストチーム|開催|ランキング|スタジアム|キャンプ|グローリー)/i.test(text);
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
  const webview = encodeURIComponent(`lang=1&tz_offset=9&_ssid=${ssid}`);
  return `_ssid=${ssid}; WEBVIEW=${webview}`;
}

function buildWicolleHeaders(cookie) {
  return {
    Cookie: cookie,
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ja,en-US;q=0.8,en;q=0.6',
  };
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
};
