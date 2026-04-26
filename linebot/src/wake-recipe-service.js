'use strict';

const { getWakeRecipeHistory, saveWakeRecipeHistoryEntry } = require('./firebase-admin');
const {
  getNearbyFlyerSnapshot,
  buildRecipeFromFlyerSnapshot,
  formatFlyerRecipeReply,
} = require('./flyer-stock-service');

async function buildWakeRecipeMessage(alarm = {}) {
  const sourceId = String(alarm.sourceId || alarm.userId || '').trim();
  if (!sourceId) return null;

  const weekKey = getTokyoWeekKey(new Date());
  const history = await getWakeRecipeHistory(sourceId, weekKey).catch(() => []);
  const usedTitles = history
    .map(entry => normalize(entry?.title))
    .filter(Boolean);

  const latitude = Number(alarm.weatherLatitude);
  const longitude = Number(alarm.weatherLongitude);
  const snapshot = await getNearbyFlyerSnapshot({
    sourceId,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    locationLabel: alarm.weatherPlace || '',
  }).catch(() => null);
  const recipe = await buildRecipeFromFlyerSnapshot(snapshot, { excludedTitles: usedTitles }).catch(() => null);
  if (!recipe) return null;

  await saveWakeRecipeHistoryEntry(sourceId, weekKey, {
    title: recipe.title,
    source: recipe.source,
    summary: recipe.summary,
    priceHint: recipe.estimatedTotalPrice || '',
    storeName: snapshot?.store?.name || '',
  }).catch(() => {});

  return {
    type: 'text',
    text: formatFlyerRecipeReply(snapshot, recipe),
  };
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
