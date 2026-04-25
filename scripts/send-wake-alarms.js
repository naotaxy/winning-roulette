'use strict';

const admin = require('firebase-admin');
const {
  computeNextRecurringDueAt,
  formatWakeAlarmPushText,
} = require('../linebot/src/wake-alarm');
const {
  fetchWakeWeather,
  formatWakeWeatherSummary,
} = require('../linebot/src/weather');

const WAKE_ALARM_ROOT = 'wakeAlarms';
const LOOKBACK_MS = 15 * 60 * 1000;

let _db = null;

function getDb() {
  if (_db) return _db;
  if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    admin.initializeApp({
      credential: admin.credential.cert(sa),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }
  _db = admin.database();
  return _db;
}

async function pushLineText(to, text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is missing');

  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to,
      messages: [{ type: 'text', text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LINE push failed: ${res.status} ${body.slice(0, 300)}`);
  }
}

async function processWakeAlarm(sourceId, alarm, now) {
  const dueAt = Number(alarm?.dueAt);
  if (!sourceId || !alarm || alarm.status !== 'active' || !Number.isFinite(dueAt)) return false;
  if (dueAt > now || dueAt < now - LOOKBACK_MS) return false;

  const weatherLatitude = parseStoredNumber(alarm.weatherLatitude);
  const weatherLongitude = parseStoredNumber(alarm.weatherLongitude);
  const weather = await fetchWakeWeather(
    alarm.weatherPlace || '',
    weatherLatitude,
    weatherLongitude,
  ).catch(() => null);
  const weatherLine = formatWakeWeatherSummary(weather);
  const text = [formatWakeAlarmPushText(alarm), weatherLine].filter(Boolean).join('\n');
  await pushLineText(sourceId, text);

  const ref = getDb().ref(`${WAKE_ALARM_ROOT}/${sourceId}`);
  const update = {
    lastSentAt: now,
    lastSentAtIso: new Date(now).toISOString(),
    lastError: null,
  };

  if (alarm.recurring) {
    update.dueAt = computeNextRecurringDueAt(alarm, new Date(now + 60 * 1000));
    update.status = 'active';
  } else {
    update.status = 'sent';
    update.sentAt = now;
    update.sentAtIso = new Date(now).toISOString();
  }

  await ref.update(update);
  return true;
}

function parseStoredNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function main() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT || !process.env.FIREBASE_DATABASE_URL) {
    console.log('[wake] Firebase secrets are missing; skip');
    return;
  }
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    console.log('[wake] LINE token is missing; skip');
    return;
  }

  const now = Date.now();
  const snap = await getDb().ref(WAKE_ALARM_ROOT).once('value');
  const alarms = snap.val() || {};

  let sent = 0;
  let failed = 0;
  for (const [sourceId, alarm] of Object.entries(alarms)) {
    try {
      if (await processWakeAlarm(sourceId, alarm, now)) sent += 1;
    } catch (err) {
      failed += 1;
      console.error('[wake] failed', sourceId, err?.message || err);
      await getDb().ref(`${WAKE_ALARM_ROOT}/${sourceId}`).update({
        lastError: String(err?.message || err).slice(0, 300),
        lastAttemptAt: now,
        lastAttemptAtIso: new Date(now).toISOString(),
      }).catch(() => {});
    }
  }

  console.log(`[wake] sent=${sent} failed=${failed}`);
}

main().catch(err => {
  console.error('[wake] fatal', err);
  process.exitCode = 1;
});
