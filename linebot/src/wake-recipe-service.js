'use strict';

const { getWakeRecipeHistory, saveWakeRecipeHistoryEntry, getLatestLocation } = require('./firebase-admin');
const {
  getNearbyFlyerSnapshot,
  buildRecipeFromFlyerSnapshot,
  buildFallbackRecipe,
  formatFlyerRecipeReply,
  buildIngredientPriceFlex,
} = require('./flyer-stock-service');

async function buildWakeRecipeMessage(alarm = {}) {
  const sourceId = String(alarm.sourceId || alarm.userId || '').trim();
  if (!sourceId) return null;

  const weekKey = getTokyoWeekKey(new Date());
  const history = await getWakeRecipeHistory(sourceId, weekKey).catch(() => []);
  const usedTitles = history
    .map(entry => normalize(entry?.title))
    .filter(Boolean);

  // アラームに座標がなければ Firebase の最終保存位置を fallback にする
  let latitude = Number(alarm.weatherLatitude);
  let longitude = Number(alarm.weatherLongitude);
  let locationLabel = alarm.weatherPlace || '';
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    const saved = await getLatestLocation(sourceId, alarm.userId).catch(() => null);
    if (Number.isFinite(Number(saved?.latitude)) && Number.isFinite(Number(saved?.longitude))) {
      latitude = Number(saved.latitude);
      longitude = Number(saved.longitude);
      locationLabel = saved.label || saved.address || locationLabel;
    }
  }

  const snapshot = await getNearbyFlyerSnapshot({
    sourceId,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    locationLabel,
  }).catch(() => null);
  const recipe = (await buildRecipeFromFlyerSnapshot(snapshot, { excludedTitles: usedTitles }).catch(() => null))
    || buildFallbackRecipe(snapshot, usedTitles);
  if (!recipe) return null;

  await saveWakeRecipeHistoryEntry(sourceId, weekKey, {
    title: recipe.title,
    source: recipe.source,
    summary: recipe.summary,
    priceHint: recipe.estimatedTotalPrice || '',
    storeName: snapshot?.store?.name || '',
  }).catch(() => {});

  const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
  const message = {
    type: 'text',
    text: formatFlyerRecipeReply(snapshot, recipe),
  };
  if (!hasLocation) {
    message.quickReply = {
      items: [{
        type: 'action',
        action: { type: 'location', label: '位置情報を送って近くのお店を使う' },
      }],
    };
  }
  const messages = [message];
  const priceFlex = buildIngredientPriceFlex(snapshot, recipe);
  if (priceFlex) messages.push(priceFlex);
  return messages;
}

function getTokyoWeekKey(date = new Date()) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const weekday = jst.getUTCDay() || 7;
  const monday = new Date(jst);
  monday.setUTCDate(jst.getUTCDate() - (weekday - 1));
  const year = monday.getUTCFullYear();
  const month = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const day = String(monday.getUTCDate()).padStart(2, '0');
  return `${year}-W-${month}${day}`;
}

function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

module.exports = {
  buildWakeRecipeMessage,
};
