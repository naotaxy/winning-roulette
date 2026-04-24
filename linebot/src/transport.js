'use strict';

// ── リクエスト判定 ────────────────────────────────────────────────────────────
function isTransportRequest(text) {
  return /(電車|新幹線|バス|タクシー|乗換|乗り換え|行き方|経路|ルート|交通|移動|飛行機|列車|鉄道|配車|空港)/.test(String(text || ''));
}

function isTaxiRequest(text) {
  return /(タクシー|配車|タクシー呼|タクシー頼)/.test(String(text || ''));
}

function isFlightRequest(text) {
  return /(飛行機|航空|フライト|空路|ANA|JAL|LCC|空港便)/.test(String(text || ''));
}

// ── テキストからパラメータ抽出 ───────────────────────────────────────────────
function extractRouteParams(text) {
  const t = String(text || '');
  const m = t.match(/(.{1,10}?)(?:から|より)(?:.{0,3}?)(.{1,10}?)(?:まで|へ|に行|の行き方|経路|ルート|$)/);
  const from = m ? m[1].replace(/[今現在\s]/g, '').trim() : null;
  const to   = m ? m[2].replace(/[のへまで\s]/g, '').trim() : null;
  const tomorrow = /明日|あした|あす/.test(t);
  const timeMatch = t.match(/(\d{1,2})[時:](\d{0,2})/);
  return {
    from,
    to,
    tomorrow,
    hour:   timeMatch ? Number(timeMatch[1]) : null,
    minute: timeMatch ? Number(timeMatch[2] || 0) : null,
  };
}

function buildSearchDatetime(tomorrow, hour, minute) {
  const now = new Date(new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }));
  if (tomorrow) now.setDate(now.getDate() + 1);
  if (hour !== null) now.setHours(hour, minute || 0, 0, 0);
  const p = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}`;
}

// ── Yahoo!乗換案内 API ────────────────────────────────────────────────────────
async function searchRoute({ from, to, tomorrow = false, hour = null, minute = null, count = 3 }) {
  const appId = process.env.YAHOO_APP_ID;
  if (!appId || !from || !to) return null;

  const params = new URLSearchParams({
    appid:    appId,
    from,
    to,
    output:   'json',
    counts:   String(Math.min(count, 5)),
    datetime: buildSearchDatetime(tomorrow, hour, minute),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`https://map.yahooapis.jp/transit/V1/search?${params}`, { signal: controller.signal });
    if (!res.ok) { console.error('[transport] yahoo API error', res.status); return null; }
    const data = await res.json();
    return (data?.Feature || []).map(f => f?.Property?.Route).filter(Boolean);
  } catch (err) {
    if (err?.name !== 'AbortError') console.error('[transport] route search failed', err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── ルート返答テキスト ────────────────────────────────────────────────────────
function formatRouteReply(routes, from, to) {
  if (!routes?.length) {
    return `${from || '出発地'}から${to || '目的地'}のルートを取得できなかったよ。\n出発地・目的地をもう少し具体的に教えて。`;
  }
  const lines = [`${from} → ${to} の経路だよ。`, ''];
  routes.slice(0, 3).forEach((route, i) => {
    const mv = route?.Summary?.Move || {};
    const time      = mv.Time      ? `${mv.Time}分`                         : '--';
    const transfers = mv.TransferCount ? `乗換${mv.TransferCount}回`        : '乗換なし';
    const fare      = mv.Fare      ? `${Number(mv.Fare).toLocaleString()}円` : '--';
    lines.push(`ルート${i + 1}  ${time} / ${transfers} / ${fare}`);
    const trains = (route?.Section || [])
      .filter(s => s?.Type === 'move' && s?.Transport?.Name)
      .map(s => s.Transport.Name)
      .slice(0, 3);
    if (trains.length) lines.push(`  ${trains.join(' → ')}`);
    lines.push('');
  });
  return lines.join('\n').trim();
}

// ── タクシーFlex ──────────────────────────────────────────────────────────────
function buildTaxiFlex(from, to) {
  const subtitle = from && to ? `${from} → ${to}` : '現在地から手配';
  return {
    type: 'flex',
    altText: 'タクシー配車アプリへのリンクだよ。',
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#1a1a2e',
        contents: [
          { type: 'text', text: '🚕 タクシー配車', color: '#ffffff', size: 'sm', weight: 'bold' },
          { type: 'text', text: subtitle, color: '#aaaaaa', size: 'xs', margin: 'xs' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: 'md',
        contents: [
          { type: 'text', text: '配車は以下のアプリから直接できるよ。目的地を入力して呼んでね。', size: 'sm', wrap: true, color: '#444444' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: 'sm',
        contents: [
          {
            type: 'button',
            action: { type: 'uri', label: 'GO で配車する', uri: 'https://go.goinc.jp/' },
            style: 'primary', height: 'sm',
          },
          {
            type: 'button',
            action: { type: 'uri', label: 'Uber で配車する', uri: 'https://m.uber.com/looking' },
            style: 'secondary', height: 'sm', margin: 'sm',
          },
        ],
      },
    },
  };
}

// ── 飛行機Flex ────────────────────────────────────────────────────────────────
function buildFlightFlex(from, to) {
  const subtitle = from && to ? `${from} → ${to}` : '国内フライト';
  return {
    type: 'flex',
    altText: '国内フライトの検索リンクだよ。',
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#0a3d62',
        contents: [
          { type: 'text', text: '✈️ フライト検索', color: '#ffffff', size: 'sm', weight: 'bold' },
          { type: 'text', text: subtitle, color: '#aaaaaa', size: 'xs', margin: 'xs' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: 'md',
        contents: [
          { type: 'text', text: '以下のサイトで空席・料金を確認してね。', size: 'sm', wrap: true, color: '#444444' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: 'sm',
        contents: [
          {
            type: 'button',
            action: { type: 'uri', label: 'ANA で検索', uri: 'https://www.ana.co.jp/ja/jp/domtop/' },
            style: 'primary', height: 'sm',
          },
          {
            type: 'button',
            action: { type: 'uri', label: 'JAL で検索', uri: 'https://www.jal.co.jp/jp/ja/domtop/' },
            style: 'secondary', height: 'sm', margin: 'sm',
          },
          {
            type: 'button',
            action: { type: 'uri', label: 'スカイスキャナー', uri: 'https://www.skyscanner.co.jp/' },
            style: 'link', height: 'sm', margin: 'sm',
          },
        ],
      },
    },
  };
}

module.exports = {
  isTransportRequest, isTaxiRequest, isFlightRequest,
  extractRouteParams, searchRoute, formatRouteReply,
  buildTaxiFlex, buildFlightFlex,
};
