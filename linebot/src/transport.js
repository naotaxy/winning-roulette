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

// ── 経路検索Flex（APIなし・ディープリンク方式） ──────────────────────────────
function buildRouteFlex(from, to) {
  const subtitle = from && to ? `${from} → ${to}` : '経路検索';
  const yahooUrl = `https://transit.yahoo.co.jp/search/print?from=${encodeURIComponent(from || '')}&to=${encodeURIComponent(to || '')}&by=train&kind=1`;
  const googleUrl = `https://www.google.com/maps/dir/${encodeURIComponent(from || '')}/${encodeURIComponent(to || '')}`;
  const navitimeUrl = `https://transfer.navitime.biz/5931bus/pc/transfer/TransferTop?start=${encodeURIComponent(from || '')}&goal=${encodeURIComponent(to || '')}`;

  return {
    type: 'flex',
    altText: `${subtitle} の経路を調べてみて。`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#1e3a5f',
        contents: [
          { type: 'text', text: '🚃 経路検索', color: '#ffffff', size: 'sm', weight: 'bold' },
          { type: 'text', text: subtitle, color: '#aaaaaa', size: 'xs', margin: 'xs' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: 'md',
        contents: [
          { type: 'text', text: '以下のアプリで出発地・目的地が入力済みで開くよ。', size: 'sm', wrap: true, color: '#444444' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: 'sm',
        contents: [
          {
            type: 'button',
            action: { type: 'uri', label: 'Yahoo!乗換案内で検索', uri: yahooUrl },
            style: 'primary', height: 'sm',
          },
          {
            type: 'button',
            action: { type: 'uri', label: 'Googleマップで検索', uri: googleUrl },
            style: 'secondary', height: 'sm', margin: 'sm',
          },
          {
            type: 'button',
            action: { type: 'uri', label: 'NAVITIME で検索', uri: navitimeUrl },
            style: 'link', height: 'sm', margin: 'sm',
          },
        ],
      },
    },
  };
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
  extractRouteParams, buildRouteFlex,
  buildTaxiFlex, buildFlightFlex,
};
