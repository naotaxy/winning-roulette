'use strict';

const { getResolvedPrivateProfile } = require('./private-profile');

const WBS_NEWS_URL = 'https://txbiz.tv-tokyo.co.jp/wbs/news';
const NHK_MAJOR_NEWS_RSS_URL = 'https://www3.nhk.or.jp/rss/news/cat0.xml';
const JR_SOBU_LOCAL_STATUS_URL = 'https://traininfo.jreast.co.jp/train_info/line.aspx?gid=1&lineid=chuo_sobuline_local';
const YAHOO_OEDO_STATUS_URL = 'https://transit.yahoo.co.jp/diainfo/131/0';
const HTTP_HEADERS = { 'user-agent': 'traperuko-linebot/1.0' };

async function buildMorningBriefingMessages(alarm = {}) {
  const newsMode = normalizeWakeNewsMode(alarm.newsMode);
  const profile = await getResolvedPrivateProfile({
    userId: alarm.userId || '',
    lineName: alarm.lineName || '',
    realName: alarm.realName || alarm.senderName || '',
  }).catch(() => null);
  const commute = buildCommuteProfile(profile, alarm);
  const trainStatusesPromise = fetchCommuteStatuses(commute.lines);

  const [wbsHighlights, majorNews, trainStatuses] = await Promise.all([
    newsMode === 'all' || newsMode === 'wbs'
      ? fetchWbsHighlights().catch(() => [])
      : Promise.resolve([]),
    newsMode === 'all' || newsMode === 'major'
      ? fetchMajorNewsHighlights().catch(() => [])
      : Promise.resolve([]),
    trainStatusesPromise,
  ]);

  const messages = [];
  const commuteText = formatCommuteBriefing(commute, trainStatuses);
  if (commuteText) messages.push({ type: 'text', text: commuteText });

  const wbsText = formatWbsBriefing(wbsHighlights);
  if (wbsText) messages.push({ type: 'text', text: wbsText });

  const majorNewsText = formatMajorNewsBriefing(majorNews);
  if (majorNewsText) messages.push({ type: 'text', text: majorNewsText });

  return messages.slice(0, 3);
}

async function fetchCommuteStatuses(lines = []) {
  if (!Array.isArray(lines) || !lines.length) return [];
  const settled = await Promise.allSettled(lines.map(fetchTrainStatus));
  return settled.map((result, index) => {
    if (result.status === 'fulfilled' && result.value) return result.value;
    return {
      name: lines[index]?.name || '通勤路線',
      routeLabel: lines[index]?.routeLabel || '',
      isNormal: null,
      summary: '運行情報の取得が今ちょっと鈍いみたい。出る前にだけ公式の詳細を見ておくと安心だよ。',
    };
  }).filter(Boolean);
}

function isMorningAlarm(alarm = {}) {
  const hour = Number(alarm.hour);
  return Number.isFinite(hour) && hour >= 4 && hour <= 10;
}

async function fetchWbsHighlights() {
  const html = await fetchText(WBS_NEWS_URL);
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!nextDataMatch) return [];

  const data = JSON.parse(nextDataMatch[1]);
  const rows = data?.props?.pageProps?.dataFromServer?.detailResult?.data || [];
  if (!Array.isArray(rows) || !rows.length) return [];

  const today = formatJstDate(shiftTokyoDay(0));
  const targetDate = pickLatestWbsBroadcastDate(rows, today);
  if (!targetDate) return [];
  const seen = new Set();
  return rows
    .filter(item => item?.broadcast_date === targetDate)
    .filter(item => {
      const key = String(item.episode_name || '').trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3)
    .map(item => ({
      title: clipText(item.episode_name, 38),
      summary: summarizeJapaneseText(item.header, 52),
      date: item.broadcast_date,
    }));
}

function pickLatestWbsBroadcastDate(rows, today) {
  const dates = [...new Set(
    rows
      .map(item => String(item?.broadcast_date || '').trim())
      .filter(value => /^\d{4}\/\d{2}\/\d{2}$/.test(value))
  )].sort();
  if (!dates.length) return '';

  const pastOrYesterday = dates.filter(date => date < today);
  if (pastOrYesterday.length) return pastOrYesterday[pastOrYesterday.length - 1];

  return dates[dates.length - 1] || '';
}

async function fetchMajorNewsHighlights() {
  const xml = await fetchText(NHK_MAJOR_NEWS_RSS_URL);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map(match => parseRssItem(match[1]))
    .filter(item => item?.title && item?.pubDate);

  if (!items.length) return [];

  const since = shiftTokyoHours(-18);
  return items
    .filter(item => new Date(item.pubDate).getTime() >= since.getTime())
    .slice(0, 2)
    .map(item => ({
      title: clipText(item.title, 42),
      summary: summarizeJapaneseText(item.description, 58),
      pubDate: item.pubDate,
    }));
}

async function fetchTrainStatus(line) {
  if (!line?.url) return null;
  const html = await fetchText(line.url);
  if (line.source === 'jr') {
    return parseJrEastTrainStatus(line, html);
  }
  return parseYahooTrainStatus(line, html);
}

function parseJrEastTrainStatus(line, html) {
  const flat = normalizeHtml(html);
  const statusMatch = flat.match(/traininfo-line-info__status[^>]*>\s*<span>([^<]+)<\/span>/);
  const status = statusMatch?.[1] || '';
  const isNormal = /平常運転/.test(status);
  return {
    name: line.name,
    routeLabel: line.routeLabel || '',
    isNormal,
    summary: isNormal
      ? '平常運転。振替輸送の案内も今のところ出ていないよ。'
      : `${status || '運行情報あり'}。出る前に念のためJR東日本の詳細も見てね。`,
  };
}

function parseYahooTrainStatus(line, html) {
  const flat = normalizeHtml(html);
  const summaryMatch = flat.match(/<div id="mdServiceStatus">[\s\S]*?<dt><span[^>]*><\/span>([^<]+)<\/dt><dd[^>]*><p>([^<]+)<\/p>/);
  const status = summaryMatch?.[1] || '';
  const detail = summaryMatch?.[2] || '';
  const isNormal = /平常運転/.test(status) && /事故･遅延に関する情報はありません/.test(detail);
  return {
    name: line.name,
    routeLabel: line.routeLabel || '',
    isNormal,
    summary: isNormal
      ? '平常運転。今のところ事故や大きい遅延の案内は出ていないよ。'
      : `${status || '運行情報あり'}。${detail || '出発前に詳細を見ておくと安心。'}`,
  };
}

function buildCommuteProfile(profile, alarm = {}) {
  const storedLines = Array.isArray(alarm?.commuteLines)
    ? alarm.commuteLines
      .filter(line => line && typeof line === 'object' && line.name && line.url)
      .map(line => ({
        name: line.name,
        source: line.source,
        url: line.url,
        routeLabel: line.routeLabel || '',
      }))
    : [];
  const storedRouteLabel = String(alarm?.commuteRouteLabel || '').trim();
  const sourceText = [
    profile?.rawText,
    ...(profile?.summaryLines || []),
    alarm?.weatherPlace,
    alarm?.senderName,
    alarm?.realName,
    alarm?.lineName,
  ].filter(Boolean).join(' ');

  const routeLabel = inferCommuteRouteLabel(sourceText);
  const inferredLines = [];
  if (/(都営大江戸線|大江戸線|新江古田|東中野)/.test(sourceText)) {
    inferredLines.push({
      name: '都営大江戸線',
      source: 'yahoo',
      url: YAHOO_OEDO_STATUS_URL,
      routeLabel: '新江古田〜東中野',
    });
  }
  if (/(中央・総武|総武線各駅|総武線|水道橋)/.test(sourceText)) {
    inferredLines.push({
      name: 'JR中央・総武各駅停車',
      source: 'jr',
      url: JR_SOBU_LOCAL_STATUS_URL,
      routeLabel: '東中野〜水道橋',
    });
  }
  if (!inferredLines.length && /(米澤|ヨ)/.test(sourceText)) {
    inferredLines.push(
      {
        name: '都営大江戸線',
        source: 'yahoo',
        url: YAHOO_OEDO_STATUS_URL,
        routeLabel: '新江古田〜東中野',
      },
      {
        name: 'JR中央・総武各駅停車',
        source: 'jr',
        url: JR_SOBU_LOCAL_STATUS_URL,
        routeLabel: '東中野〜水道橋',
      },
    );
  }
  const lines = storedLines.length ? storedLines : inferredLines;
  const resolvedRouteLabel = storedRouteLabel || routeLabel || (lines.length ? '東橋バス停 → 新江古田 → 東中野 → 水道橋' : '');
  return { routeLabel: resolvedRouteLabel, lines };
}

function inferCommuteRouteLabel(text) {
  const parts = [];
  if (/東橋/.test(text)) parts.push('東橋バス停');
  if (/新江古田/.test(text)) parts.push('新江古田');
  if (/東中野/.test(text)) parts.push('東中野');
  if (/水道橋/.test(text)) parts.push('水道橋');
  return parts.length >= 2 ? parts.join(' → ') : '';
}

function formatCommuteBriefing(commute, statuses) {
  if ((!Array.isArray(statuses) || !statuses.length) && !commute?.routeLabel) return '';
  const lines = ['そのあと、通勤まわりだけ先に見てきたよ。'];
  if (commute?.routeLabel) {
    lines.push(`いつもの筋は ${commute.routeLabel} で見てる。`);
  }
  if (!Array.isArray(statuses) || !statuses.length) {
    lines.push('運行情報の取得が今ちょっと鈍いみたい。出る前にだけ、公式の詳細を見てね。');
    return lines.join('\n');
  }
  for (const status of statuses.filter(Boolean)) {
    lines.push(`・${status.name}${status.routeLabel ? ` (${status.routeLabel})` : ''}: ${status.summary}`);
  }
  return lines.join('\n');
}

function formatWbsBriefing(items) {
  if (!Array.isArray(items) || !items.length) return '';
  const lines = ['昨夜のWBSは、今朝ならこのへんだけ押さえておけば十分。'];
  items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title}`);
    if (item.summary) lines.push(`   ${item.summary}`);
  });
  return lines.join('\n');
}

function formatMajorNewsBriefing(items) {
  if (!Array.isArray(items) || !items.length) return '';
  const lines = ['世の中の大きめニュースも、朝の分だけ少し置いておくね。'];
  items.forEach(item => {
    lines.push(`・${item.title}`);
    if (item.summary) lines.push(`  ${item.summary}`);
  });
  return lines.join('\n');
}

function parseRssItem(raw) {
  return {
    title: decodeHtml(stripTags(extractTag(raw, 'title'))),
    description: decodeHtml(stripTags(extractTag(raw, 'description'))),
    pubDate: extractTag(raw, 'pubDate'),
    link: extractTag(raw, 'link'),
  };
}

function extractTag(text, tagName) {
  const match = String(text || '').match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match?.[1]?.trim() || '';
}

function normalizeHtml(html) {
  return String(html || '').replace(/\s+/g, ' ');
}

function summarizeJapaneseText(text, max = 56) {
  const value = decodeHtml(stripTags(text))
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) return '';
  const sentence = value.split(/(?<=[。！？])/)[0] || value;
  return clipText(sentence, max);
}

function clipText(text, max = 60) {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function stripTags(text) {
  return String(text || '').replace(/<[^>]+>/g, ' ');
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

async function fetchText(url) {
  const controller = AbortSignal.timeout(8000);
  const res = await fetch(url, { headers: HTTP_HEADERS, signal: controller });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}`);
  }
  return res.text();
}

function shiftTokyoDay(deltaDays) {
  const now = new Date();
  const base = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base;
}

function shiftTokyoHours(deltaHours) {
  return new Date(Date.now() + deltaHours * 60 * 60 * 1000);
}

function formatJstDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

function normalizeWakeNewsMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'wbs') return 'wbs';
  if (mode === 'major') return 'major';
  if (mode === 'none') return 'none';
  return 'all';
}

module.exports = {
  isMorningAlarm,
  buildMorningBriefingMessages,
  buildCommuteProfile,
};
