'use strict';

const WEATHER_CODES = {
  0: '快晴', 1: '晴れ', 2: '一部曇り', 3: '曇り',
  45: '霧', 48: '霧氷',
  51: '小雨', 53: '雨', 55: '大雨',
  61: '小雨', 63: '雨', 65: '大雨',
  71: '小雪', 73: '雪', 75: '大雪',
  80: 'にわか雨', 81: 'にわか雨', 82: '激しいにわか雨',
  95: '雷雨', 96: '雷雨+ひょう', 99: '激しい雷雨',
};
const WEATHER_EMOJI = {
  0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️',
  45: '🌫', 48: '🌫',
  51: '🌦', 53: '🌧', 55: '🌧',
  61: '🌦', 63: '🌧', 65: '🌧',
  71: '🌨', 73: '❄️', 75: '❄️',
  80: '🌦', 81: '🌧', 82: '⛈',
  95: '⛈', 96: '⛈', 99: '⛈',
};
const DAY_LABELS = ['今日', '明日', '明後日'];
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

function isWeatherRequest(text) {
  return /(天気|気温|雨|晴れ|曇り|予報|降水|台風|雷|気候|暑|寒|雪)/.test(String(text || ''));
}

function extractWeatherCity(text) {
  const t = String(text || '');
  const m = t.match(/([\u4e00-\u9fa5ぁ-んァ-ン\w]{2,8})[のでは\s]*(天気|気温|予報|気候)/);
  if (m && !/(明日|今日|明後日|週間|最高|最低)/.test(m[1])) return m[1];
  return null;
}

async function fetchWeatherForCity(cityName) {
  const location = await geocodePlace(cityName);
  if (!location) return null;
  const weather = await fetchWeatherByCoords(location.latitude, location.longitude);
  if (!weather) return null;
  return { location, forecast: weather.forecast };
}

function formatWeatherReply(result, cityName) {
  if (!result) {
    return `${cityName || ''}の天気情報を取得できなかったよ。しばらくして試してみて。`;
  }
  const name = result.location?.name || cityName || '';
  const { forecast } = result;
  const days = Math.min(forecast.time?.length || 0, 3);
  const lines = [`${name}の天気予報だよ。`, ''];
  for (let i = 0; i < days; i++) {
    const code = forecast.weathercode[i];
    const emoji = WEATHER_EMOJI[code] ?? '🌡';
    const desc = WEATHER_CODES[code] ?? '不明';
    const max = forecast.temperature_2m_max[i] ?? '--';
    const min = forecast.temperature_2m_min[i] ?? '--';
    const rain = forecast.precipitation_probability_max[i] ?? '--';
    lines.push(`${DAY_LABELS[i] ?? forecast.time[i]}  ${emoji} ${desc}`);
    lines.push(`　最高${max}℃ / 最低${min}℃  降水確率${rain}%`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

async function geocodePlace(placeQuery) {
  const candidates = buildPlaceCandidates(placeQuery);
  for (const candidate of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(candidate)}&count=1&language=ja&format=json`,
        { signal: controller.signal },
      );
      const geoData = await geoRes.json();
      const location = geoData?.results?.[0] || null;
      if (location) return location;
    } catch (err) {
      if (err?.name !== 'AbortError') console.error('[weather] geocode failed', err?.message || err);
    } finally {
      clearTimeout(timer);
    }
  }
  for (const candidate of candidates) {
    const fallback = await geocodePlaceWithNominatim(candidate);
    if (fallback) return fallback;
  }
  return null;
}

async function fetchWeatherByCoords(latitude, longitude) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      daily: 'weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      hourly: 'weathercode,temperature_2m,precipitation_probability',
      current: 'weathercode,temperature_2m',
      timezone: 'Asia/Tokyo',
      forecast_days: '3',
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: controller.signal });
    const data = await res.json();
    if (!data?.daily) return null;
    return {
      current: data.current || null,
      forecast: data.daily,
      hourly: data.hourly || null,
    };
  } catch (err) {
    if (err?.name !== 'AbortError') console.error('[weather] forecast failed', err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWakeWeather(placeQuery = '', latitude = null, longitude = null) {
  let location = null;
  let weather = null;

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    weather = await fetchWeatherByCoords(latitude, longitude);
    location = {
      name: placeQuery || 'このあたり',
      latitude,
      longitude,
    };
  } else if (placeQuery) {
    location = await geocodePlace(placeQuery);
    if (location) weather = await fetchWeatherByCoords(location.latitude, location.longitude);
  }

  if (!weather || !location) return null;
  return { location, ...weather };
}

function formatWakeWeatherSummary(result) {
  if (!result?.forecast) return '';
  const daily = result.forecast;
  const current = result.current || {};
  const hourly = result.hourly || {};
  const todayIndex = Math.min(1, Math.max((daily.time?.length || 0) - 2, 0));
  const yesterdayIndex = todayIndex > 0 ? todayIndex - 1 : todayIndex;

  const todayCode = daily.weathercode?.[todayIndex];
  const todayMax = daily.temperature_2m_max?.[todayIndex];
  const todayMin = daily.temperature_2m_min?.[todayIndex];
  const todayRain = daily.precipitation_probability_max?.[todayIndex];
  const yesterdayMax = daily.temperature_2m_max?.[yesterdayIndex];
  const yesterdayMin = daily.temperature_2m_min?.[yesterdayIndex];

  const tempDiff = Number.isFinite(todayMax) && Number.isFinite(yesterdayMax)
    ? todayMax - yesterdayMax
    : null;
  const minDiff = Number.isFinite(todayMin) && Number.isFinite(yesterdayMin)
    ? todayMin - yesterdayMin
    : null;

  const rainTrend = summarizeRainTrend(current, hourly, todayRain);
  const tempTrend = summarizeTemperatureTrend(tempDiff, minDiff);
  const desc = WEATHER_CODES[todayCode] || '天気不明';
  const emoji = WEATHER_EMOJI[todayCode] || '🌡';
  const place = result.location?.name || 'このあたり';

  return [
    `${place}は ${emoji} ${desc} 寄り。`,
    Number.isFinite(todayMax) && Number.isFinite(todayMin) ? `最高${todayMax}℃ / 最低${todayMin}℃。` : '',
    tempTrend,
    todayRain != null ? `降水確率は高いところで ${todayRain}% くらい。` : '',
    rainTrend,
  ].filter(Boolean).join(' ');
}

function summarizeTemperatureTrend(tempDiff, minDiff) {
  if (Number.isFinite(minDiff) && minDiff <= -2) return '朝は昨日より少し冷えそう。';
  if (Number.isFinite(tempDiff) && tempDiff <= -2) return '昨日よりひんやり寄りだよ。';
  if (Number.isFinite(tempDiff) && tempDiff >= 2) return '昨日より少し暖かめになりそう。';
  return '';
}

function summarizeRainTrend(current, hourly, todayRain) {
  const precipitation = Array.isArray(hourly?.precipitation_probability)
    ? hourly.precipitation_probability
    : [];
  const times = Array.isArray(hourly?.time) ? hourly.time : [];
  if (!precipitation.length || !times.length) return '';

  const nowHour = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    hour12: false,
  }).format(new Date());
  const currentIndex = times.findIndex(time => time.endsWith(`${nowHour}:00`));
  const start = currentIndex >= 0 ? currentIndex : 0;
  const window = precipitation.slice(start, start + 6).map(Number).filter(Number.isFinite);
  if (!window.length) return '';
  if (Number.isFinite(todayRain) && todayRain <= 20) return '今日はかなり乾いた空気で動けそう。';

  const currentRain = Number(current?.precipitation_probability);
  const peak = Math.max(...window);
  if (peak >= 55 && !(Number.isFinite(currentRain) && currentRain >= 45)) return 'このあと雨が近づきそうだから、折りたたみがあると安心。';
  if (peak <= 25 && window[0] >= 45) return '今ふってても、時間が進めば止みそう。';
  if (peak <= 25) return '少なくとも出かける時点では雨の心配は薄め。';
  return '';
}

function buildPlaceCandidates(placeQuery) {
  const raw = String(placeQuery || '').trim();
  if (!raw) return [];
  const stripped = raw
    .replace(/付近|近く|周辺|あたり|辺り/g, ' ')
    .replace(/バス停/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = stripped.split(/\s+/).filter(Boolean);
  return [...new Set([
    raw,
    stripped,
    parts.slice(0, 2).join(' '),
    parts[0],
  ].filter(Boolean))];
}

async function geocodePlaceWithNominatim(candidate) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const params = new URLSearchParams({
      q: candidate,
      format: 'jsonv2',
      limit: '1',
      'accept-language': 'ja',
    });
    const res = await fetch(`${NOMINATIM_SEARCH_URL}?${params}`, {
      headers: { 'User-Agent': 'traperuko-linebot/1.0 (+https://qiita.com/meisaitokei/items/5857bbb2b5a96b52341c)' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const first = Array.isArray(data) ? data[0] : null;
    if (!first?.lat || !first?.lon) return null;
    return {
      name: first.display_name?.split(',')[0] || candidate,
      latitude: Number(first.lat),
      longitude: Number(first.lon),
    };
  } catch (err) {
    if (err?.name !== 'AbortError') console.error('[weather] nominatim geocode failed', err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  isWeatherRequest,
  extractWeatherCity,
  fetchWeatherForCity,
  formatWeatherReply,
  geocodePlace,
  fetchWeatherByCoords,
  fetchWakeWeather,
  formatWakeWeatherSummary,
};
