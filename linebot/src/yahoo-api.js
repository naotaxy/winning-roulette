'use strict';

const YAHOO_APPID = process.env.YAHOO_APPID;
const YAHOO_WEATHER_URL = 'https://map.yahooapis.jp/weather/V1/place';
const YAHOO_LOCAL_URL = 'https://map.yahooapis.jp/search/local/V1/localSearch';

// ── 天気予報 (YOLP Weather) ────────────────────────────────────────────
// coordinates: lon,lat 順（Yahoo API 仕様）
// interval=10 → 10分刻みの雨量を返す
async function fetchYahooWeather(lat, lon) {
  if (!YAHOO_APPID || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  try {
    const url = `${YAHOO_WEATHER_URL}?coordinates=${lon},${lat}&appid=${YAHOO_APPID}&output=json&interval=10`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      console.warn(`[yahoo-weather] HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    return parseWeatherResult(data);
  } catch (e) {
    console.warn('[yahoo-weather] error:', e.message);
    return null;
  }
}

function parseWeatherResult(data) {
  const forecasts = data?.Feature?.[0]?.Property?.WeatherList?.Weather;
  if (!Array.isArray(forecasts) || !forecasts.length) return null;

  const observations = forecasts.filter(f => f.Type === 'observation');
  const future = forecasts.filter(f => f.Type === 'forecast').slice(0, 6); // 直近60分

  const currentRain = observations.length
    ? Math.max(...observations.map(f => Number(f.Rainfall) || 0))
    : 0;
  const maxFutureRain = future.length
    ? Math.max(...future.map(f => Number(f.Rainfall) || 0))
    : 0;

  return {
    currentRain,
    maxFutureRain,
    isRaining: currentRain > 0,
    willRain: maxFutureRain > 0,
  };
}

// ── ローカルサーチ (YOLP Local Search) ────────────────────────────────
// lat/lon 指定時は距離順、なければキーワードのみで検索
async function searchYahooLocalSpots(query, lat = null, lon = null) {
  if (!YAHOO_APPID || !query) return [];
  try {
    const params = new URLSearchParams({
      query,
      appid: YAHOO_APPID,
      output: 'json',
      results: '3',
    });
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      params.set('lat', lat);
      params.set('lon', lon);
      params.set('sort', 'dist');
    }
    const res = await fetch(`${YAHOO_LOCAL_URL}?${params}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      console.warn(`[yahoo-local] HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    return parseLocalSearchResult(data);
  } catch (e) {
    console.warn('[yahoo-local] error:', e.message);
    return [];
  }
}

function parseLocalSearchResult(data) {
  const features = data?.Feature;
  if (!Array.isArray(features)) return [];
  return features.map(f => ({
    name: String(f.Name || '').trim(),
    category: String(f.Property?.Genre?.[0]?.Name || '').trim(),
    address: String(f.Property?.Address || '').trim(),
    distance: f.Distance != null ? Number(f.Distance) : null,
  })).filter(s => s.name);
}

// ── Noblesse スタイル出力 ──────────────────────────────────────────────
function buildWeatherLine(weather) {
  if (!weather) return null;
  if (weather.isRaining && weather.currentRain > 0) {
    return `気象情報照会完了。現在、降雨を確認（${weather.currentRain.toFixed(1)} mm/h）。\n屋内優先ルートに切り替えます。`;
  }
  if (weather.willRain && weather.maxFutureRain > 0) {
    return `気象情報照会完了。今後60分以内に降雨の可能性を確認（最大 ${weather.maxFutureRain.toFixed(1)} mm/h）。\n念のため屋根付きルートを前に出します。`;
  }
  return `気象情報照会完了。現在・直近60分、降雨の反応なし。\n予定通りのルートで動けます。`;
}

module.exports = { fetchYahooWeather, searchYahooLocalSpots, buildWeatherLine };
