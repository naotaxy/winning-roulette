'use strict';

const { getResolvedPrivateProfile } = require('./private-profile');

const WBS_NEWS_URL = 'https://txbiz.tv-tokyo.co.jp/wbs/news';
const NHK_MAJOR_NEWS_RSS_URL = 'https://www3.nhk.or.jp/rss/news/cat0.xml';
const JR_SOBU_LOCAL_STATUS_URL = 'https://traininfo.jreast.co.jp/train_info/line.aspx?gid=1&lineid=chuo_sobuline_local';
const YAHOO_OEDO_STATUS_URL = 'https://transit.yahoo.co.jp/diainfo/131/0';
const JARTIC_TRAFFIC_URL = 'https://www.jartic.or.jp/';
const YAHOO_ROAD_TRAFFIC_URL = 'https://roadway.yahoo.co.jp/';
const HTTP_HEADERS = { 'user-agent': 'traperuko-linebot/1.0' };

async function buildMorningBriefingMessages(alarm = {}) {
  const newsMode = normalizeWakeNewsMode(alarm.newsMode);
  const profile = await getResolvedPrivateProfile({
    userId: alarm.userId || '',
    lineName: alarm.lineName || '',
    realName: alarm.realName || alarm.senderName || '',
  }).catch(() => null);
  const commute = buildCommuteProfile(profile, alarm);
  const commuteStatusesPromise = commute.mode === 'train'
    ? fetchCommuteStatuses(commute.lines)
    : Promise.resolve([]);

  const [wbsHighlights, majorNews, commuteStatuses] = await Promise.all([
    newsMode === 'all' || newsMode === 'wbs'
      ? fetchWbsHighlights().catch(() => [])
      : Promise.resolve([]),
    newsMode === 'all' || newsMode === 'major'
      ? fetchMajorNewsHighlights().catch(() => [])
      : Promise.resolve([]),
    commuteStatusesPromise,
  ]);

  const messages = [];
  const commuteText = formatCommuteBriefing(commute, commuteStatuses);
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
  const sourceText = [
    profile?.rawText,
    ...(profile?.summaryLines || []),
    profile?.commuteRouteText,
    profile?.roadRouteText,
    alarm?.commuteRouteLabel,
    alarm?.roadRouteText,
    alarm?.weatherPlace,
    alarm?.senderName,
    alarm?.realName,
    alarm?.lineName,
  ].filter(Boolean).join(' ');
  const mode = normalizeCommuteMode(profile?.commuteMode || alarm?.commuteMode || inferCommuteMode(sourceText));

  if (mode === 'road') {
    const roadRouteText = String(profile?.roadRouteText || profile?.commuteRouteText || alarm?.roadRouteText || '').trim();
    const routeLabel = roadRouteText || String(alarm?.commuteRouteLabel || '').trim() || inferCommuteRouteLabel(sourceText);
    return {
      mode: 'road',
      routeLabel,
      roadRouteText,
      lines: [],
      roadTrafficLinks: buildRoadTrafficLinks(routeLabel || roadRouteText),
    };
  }

  if (mode === 'walk' || mode === 'remote') {
    const routeLabel = String(profile?.commuteRouteText || alarm?.commuteRouteLabel || '').trim() || inferCommuteRouteLabel(sourceText);
    return { mode, routeLabel, lines: [] };
  }

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
  const lines = storedLines.length ? storedLines : inferredLines;
  const resolvedRouteLabel = storedRouteLabel || routeLabel || (lines.length ? '東橋バス停 → 新江古田 → 東中野 → 水道橋' : '');
  return { mode: 'train', routeLabel: resolvedRouteLabel, lines };
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
  if (commute?.mode === 'road') return formatRoadTrafficBriefing(commute);
  if (commute?.mode === 'walk') return formatWalkCommuteBriefing(commute);
  if (commute?.mode === 'remote') return formatRemoteCommuteBriefing(commute);
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

function formatRoadTrafficBriefing(commute) {
  const lines = ['そのあと、通勤まわりは電車じゃなく道路側で見る設定にしてるよ。'];
  if (commute?.routeLabel) {
    lines.push(`いつもの筋は ${commute.routeLabel} として見てる。`);
  } else {
    lines.push('道路ルートがまだ薄いから、出発地・目的地・よく使う通りを入れるともっと寄せられるよ。');
  }
  const links = Array.isArray(commute?.roadTrafficLinks) ? commute.roadTrafficLinks : buildRoadTrafficLinks(commute?.routeLabel || '');
  lines.push('渋滞や事故は、出る前にこの2つで確認するのが安心。');
  links.forEach(link => lines.push(`・${link.label}: ${link.url}`));
  return lines.join('\n');
}

function formatWalkCommuteBriefing(commute) {
  const lines = ['通勤まわりは徒歩・自転車寄りで見てるよ。'];
  if (commute?.routeLabel) lines.push(`いつもの筋は ${commute.routeLabel}。`);
  lines.push('電車遅延より、雨・風・暑さ寒さを優先して見るね。');
  return lines.join('\n');
}

function formatRemoteCommuteBriefing(commute) {
  const lines = ['今日は在宅多めの前提で見てるよ。'];
  if (commute?.routeLabel) lines.push(`出社する日は ${commute.routeLabel} を見るね。`);
  lines.push('電車遅延は必要な時だけ、朝の天気とニュースを先に持っていくね。');
  return lines.join('\n');
}

function buildRoadTrafficLinks(routeText = '') {
  const query = String(routeText || '').trim();
  const links = [
    { label: 'JARTIC道路交通情報', url: JARTIC_TRAFFIC_URL },
    { label: 'Yahoo!道路交通情報', url: YAHOO_ROAD_TRAFFIC_URL },
  ];
  if (query) {
    links.push({
      label: 'Googleマップで道路状況',
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${query} 渋滞`)}`,
    });
  }
  return links;
}

function inferCommuteMode(text) {
  const value = String(text || '');
  if (/(車通勤|クルマ通勤|自動車通勤|車で|車移動|マイカー|バイク通勤|オートバイ|原付|道路|通り)/.test(value)) return 'road';
  if (/(徒歩通勤|自転車通勤|徒歩|自転車|チャリ)/.test(value)) return 'walk';
  if (/(在宅勤務|リモート勤務|在宅|リモート)/.test(value)) return 'remote';
  if (/(駅|線|JR|都営|メトロ|地下鉄|総武|大江戸)/i.test(value)) return 'train';
  return 'train';
}

function normalizeCommuteMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'road' || mode === 'car' || mode === 'bike') return 'road';
  if (mode === 'walk' || mode === 'bike-lite' || mode === 'bicycle') return 'walk';
  if (mode === 'remote') return 'remote';
  return 'train';
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
