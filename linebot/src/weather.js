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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ja&format=json`,
      { signal: controller.signal },
    );
    const geoData = await geoRes.json();
    const loc = geoData?.results?.[0];
    if (!loc) return null;

    const wRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=3`,
      { signal: controller.signal },
    );
    const wData = await wRes.json();
    return { location: loc, forecast: wData.daily };
  } catch (err) {
    if (err?.name !== 'AbortError') console.error('[weather] fetch failed', err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
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

module.exports = { isWeatherRequest, extractWeatherCity, fetchWeatherForCity, formatWeatherReply };
