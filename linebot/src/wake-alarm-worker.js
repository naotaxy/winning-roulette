'use strict';

const admin = require('firebase-admin');
const {
  computeNextRecurringDueAt,
  formatWakeAlarmPushText,
} = require('./wake-alarm');
const {
  fetchWakeWeather,
  formatWakeWeatherSummary,
} = require('./weather');
const {
  isMorningAlarm,
  buildMorningBriefingMessages,
} = require('./morning-briefing');

const WAKE_ALARM_ROOT = 'wakeAlarms';
const LOOKBACK_MS = 25 * 60 * 1000;
const CLAIM_STALE_MS = 10 * 60 * 1000;

let _db = null;

function hasWakeWorkerSecrets() {
  return !!(
    process.env.FIREBASE_SERVICE_ACCOUNT
    && process.env.FIREBASE_DATABASE_URL
    && process.env.LINE_CHANNEL_ACCESS_TOKEN
  );
}

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

async function pushLineMessages(to, messages) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is missing');

  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ to, messages }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LINE push failed: ${res.status} ${body.slice(0, 300)}`);
  }
}

async function claimWakeAlarm(sourceId, now) {
  const ref = getDb().ref(`${WAKE_ALARM_ROOT}/${sourceId}`);
  const claimToken = `wake-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const claimAtIso = new Date(now).toISOString();

  const result = await ref.transaction(current => {
    if (!current || typeof current !== 'object') return current;

    const dueAt = Number(current.dueAt);
    const claimAt = Number(current.claimAt || 0);
    const isActive = current.status === 'active';
    const isStaleSending = current.status === 'sending' && claimAt > 0 && claimAt < now - CLAIM_STALE_MS;

    if ((!isActive && !isStaleSending) || !Number.isFinite(dueAt)) return current;
    if (dueAt > now || dueAt < now - LOOKBACK_MS) return current;

    return {
      ...current,
      status: 'sending',
      claimAt: now,
      claimAtIso,
      claimToken,
      lastError: null,
    };
  });

  const claimed = result?.snapshot?.val();
  if (!result?.committed || !claimed || claimed.claimToken !== claimToken || claimed.status !== 'sending') {
    return null;
  }

  return { alarm: claimed, claimToken };
}

async function completeWakeAlarm(sourceId, alarm, claimToken, now) {
  const ref = getDb().ref(`${WAKE_ALARM_ROOT}/${sourceId}`);
  await ref.transaction(current => {
    if (!current || current.claimToken !== claimToken) return current;

    const update = {
      ...current,
      lastSentAt: now,
      lastSentAtIso: new Date(now).toISOString(),
      lastError: null,
      claimAt: null,
      claimAtIso: null,
      claimToken: null,
    };

    if (current.recurring) {
      update.dueAt = computeNextRecurringDueAt(current, new Date(now + 60 * 1000));
      update.status = 'active';
      update.sentAt = null;
      update.sentAtIso = null;
    } else {
      update.status = 'sent';
      update.sentAt = now;
      update.sentAtIso = new Date(now).toISOString();
    }

    return update;
  });
}

async function releaseWakeClaim(sourceId, claimToken, err, now) {
  const ref = getDb().ref(`${WAKE_ALARM_ROOT}/${sourceId}`);
  await ref.transaction(current => {
    if (!current || current.claimToken !== claimToken) return current;
    return {
      ...current,
      status: 'active',
      claimAt: null,
      claimAtIso: null,
      claimToken: null,
      lastAttemptAt: now,
      lastAttemptAtIso: new Date(now).toISOString(),
      lastError: String(err?.message || err || 'unknown').slice(0, 300),
    };
  }).catch(() => {});
}

function parseStoredNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function buildWakeMessages(alarm) {
  const weatherLatitude = parseStoredNumber(alarm.weatherLatitude);
  const weatherLongitude = parseStoredNumber(alarm.weatherLongitude);
  const weather = await fetchWakeWeather(
    alarm.weatherPlace || '',
    weatherLatitude,
    weatherLongitude,
  ).catch(() => null);
  const weatherLine = formatWakeWeatherSummary(weather);
  const messages = [{ type: 'text', text: formatWakeAlarmPushText(alarm) }];

  if (weatherLine) {
    messages.push({
      type: 'text',
      text: `まず外まわりだけ。\n${weatherLine}`,
    });
  }
  if (isMorningAlarm(alarm)) {
    const briefingMessages = await buildMorningBriefingMessages(alarm).catch(() => []);
    messages.push(...briefingMessages);
  }
  return messages.filter(item => item?.text).slice(0, 5);
}

async function runWakeAlarmSweep() {
  if (!hasWakeWorkerSecrets()) {
    console.log('[wake] required secrets missing; skip');
    return { sent: 0, failed: 0, claimed: 0 };
  }

  const now = Date.now();
  const snap = await getDb().ref(WAKE_ALARM_ROOT).once('value');
  const alarms = snap.val() || {};

  let sent = 0;
  let failed = 0;
  let claimedCount = 0;

  for (const sourceId of Object.keys(alarms)) {
    const claimed = await claimWakeAlarm(sourceId, now);
    if (!claimed) continue;

    claimedCount += 1;
    try {
      const messages = await buildWakeMessages(claimed.alarm);
      await pushLineMessages(sourceId, messages);
      await completeWakeAlarm(sourceId, claimed.alarm, claimed.claimToken, now);
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error('[wake] failed', sourceId, err?.message || err);
      await releaseWakeClaim(sourceId, claimed.claimToken, err, now);
    }
  }

  console.log(`[wake] sent=${sent} failed=${failed} claimed=${claimedCount}`);
  return { sent, failed, claimed: claimedCount };
}

module.exports = {
  runWakeAlarmSweep,
  hasWakeWorkerSecrets,
};
