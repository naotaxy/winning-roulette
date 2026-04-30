'use strict';

const admin = require('firebase-admin');
const {
  computeNextRecurringDueAt,
  formatWakeAlarmPushText,
  normalizeWakeRecipeMode,
} = require('./wake-alarm');
const {
  fetchWakeWeather,
  formatWakeWeatherSummary,
} = require('./weather');
const {
  isMorningAlarm,
  buildMorningBriefingMessages,
} = require('./morning-briefing');
const { buildWakeRecipeMessage } = require('./wake-recipe-service');

const WAKE_ALARM_ROOT = 'wakeAlarms';
const LOOKBACK_MS = 3 * 60 * 60 * 1000;
const CLAIM_STALE_MS = 10 * 60 * 1000;
const DEFAULT_MAX_LATE_PUSH_MS = 10 * 60 * 1000;

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

function getMaxLatePushMs() {
  const raw = process.env.WAKE_ALARM_MAX_LATE_PUSH_MS;
  if (raw == null || raw === '') return DEFAULT_MAX_LATE_PUSH_MS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_MAX_LATE_PUSH_MS;
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
  if (shouldIncludeWakeBriefing(alarm)) {
    if (!isMorningAlarm(alarm) && alarm?.testBriefing) {
      messages.push({
        type: 'text',
        text: 'これは確認しやすいように、朝じゃない時間でも朝のブリーフィングを一緒に流してるよ。',
      });
    }
    const briefingMessages = await buildMorningBriefingMessages(alarm).catch(() => []);
    messages.push(...briefingMessages);
  }
  if (normalizeWakeRecipeMode(alarm?.recipeMode || 'flyer') !== 'none') {
    const recipeMessages = await buildWakeRecipeMessage(alarm).catch(() => null);
    if (Array.isArray(recipeMessages)) messages.push(...recipeMessages.filter(Boolean));
    else if (recipeMessages) messages.push(recipeMessages);
  }
  return trimWakeMessages(messages);
}

function shouldIncludeWakeBriefing(alarm) {
  return isMorningAlarm(alarm) || alarm?.testBriefing === true;
}

function trimWakeMessages(messages) {
  const filtered = messages.filter(item => item && (item.type === 'flex' || item.text));
  while (filtered.length > 5) {
    const ingredientFlexIndex = filtered.findIndex(item => item?.type === 'flex' && /材料価格|材料の値段|レシピ/.test(item.altText || ''));
    if (ingredientFlexIndex >= 0) {
      filtered.splice(ingredientFlexIndex, 1);
      continue;
    }
    const testNoteIndex = filtered.findIndex(item => /^これは確認しやすいように/.test(item.text || ''));
    if (testNoteIndex >= 0) {
      filtered.splice(testNoteIndex, 1);
      continue;
    }
    const majorNewsIndex = filtered.findIndex(item => /^世の中の大きめニュースも/.test(item.text || ''));
    if (majorNewsIndex >= 0) {
      filtered.splice(majorNewsIndex, 1);
      continue;
    }
    filtered.pop();
  }
  return filtered;
}

// 繰り返しアラームが LOOKBACK_MS を超えてスキップされ続けると dueAt が永久に更新されない。
// 送信せずに次回予定日時へ前進させる。
async function advanceMissedRecurringAlarms(alarms, now) {
  let advanced = 0;
  for (const [sourceId, alarm] of Object.entries(alarms)) {
    const dueAt = Number(alarm?.dueAt);
    if (alarm?.status !== 'active' || !alarm?.recurring || !Number.isFinite(dueAt)) continue;
    if (dueAt >= now - LOOKBACK_MS) continue; // まだウィンドウ内か未来 → 対象外

    const nextDueAt = computeNextRecurringDueAt(alarm, new Date(now));
    if (!nextDueAt || nextDueAt <= now) continue; // 次回予定が過去 or 取得失敗 → スキップ

    const ref = getDb().ref(`${WAKE_ALARM_ROOT}/${sourceId}`);
    const result = await ref.transaction(current => {
      if (!current || current.status !== 'active' || Number(current.dueAt) !== dueAt) return current;
      return {
        ...current,
        dueAt: nextDueAt,
        lastMissedAt: now,
        lastMissedAtIso: new Date(now).toISOString(),
      };
    }).catch(() => null);

    if (result?.committed) {
      advanced++;
      console.log(`[wake] missed alarm advanced sourceId=${sourceId} from=${new Date(dueAt).toISOString()} to=${new Date(nextDueAt).toISOString()}`);
    }
  }
  return advanced;
}

// Render のスリープや GitHub Actions 停滞で大きく遅れた起床通知は、
// 次のユーザーメッセージで突然送ると「ヘルプ/システムが起床通知に化けた」ように見える。
// 許容遅延を超えたものは送らず、単発は missed、繰り返しは次回へ進める。
async function markLateWakeAlarmsMissed(alarms, now) {
  const maxLateMs = getMaxLatePushMs();
  if (maxLateMs <= 0) return 0;

  let missed = 0;
  for (const [sourceId, alarm] of Object.entries(alarms)) {
    if (!alarm || typeof alarm !== 'object') continue;

    const dueAt = Number(alarm.dueAt);
    const claimAt = Number(alarm.claimAt || 0);
    const isActive = alarm.status === 'active';
    const isStaleSending = alarm.status === 'sending' && claimAt > 0 && claimAt < now - CLAIM_STALE_MS;
    if ((!isActive && !isStaleSending) || !Number.isFinite(dueAt)) continue;
    if (dueAt > now - maxLateMs) continue;

    const ref = getDb().ref(`${WAKE_ALARM_ROOT}/${sourceId}`);
    const missedAtIso = new Date(now).toISOString();
    const result = await ref.transaction(current => {
      if (!current || typeof current !== 'object') return current;
      const currentDueAt = Number(current.dueAt);
      const currentClaimAt = Number(current.claimAt || 0);
      const currentIsActive = current.status === 'active';
      const currentIsStaleSending = current.status === 'sending' && currentClaimAt > 0 && currentClaimAt < now - CLAIM_STALE_MS;
      if ((!currentIsActive && !currentIsStaleSending) || currentDueAt !== dueAt) return current;
      if (currentDueAt > now - maxLateMs) return current;

      const update = {
        ...current,
        lastMissedAt: now,
        lastMissedAtIso: missedAtIso,
        lastMissedReason: `wake alarm was more than ${Math.round(maxLateMs / 60000)} minutes late`,
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
        update.status = 'missed';
        update.missedAt = now;
        update.missedAtIso = missedAtIso;
      }

      return update;
    }).catch(() => null);

    if (result?.committed) {
      missed += 1;
      console.warn(`[wake] late alarm skipped sourceId=${sourceId} lateMs=${now - dueAt}`);
    }
  }
  return missed;
}

async function runWakeAlarmSweep() {
  if (!hasWakeWorkerSecrets()) {
    console.log('[wake] required secrets missing; skip');
    return { sent: 0, failed: 0, claimed: 0 };
  }

  const now = Date.now();
  const snap = await getDb().ref(WAKE_ALARM_ROOT).once('value');
  const alarms = snap.val() || {};
  const missed = await markLateWakeAlarmsMissed(alarms, now).catch(() => 0);

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

  const advanced = await advanceMissedRecurringAlarms(alarms, now).catch(() => 0);
  console.log(`[wake] sent=${sent} failed=${failed} claimed=${claimedCount} missed=${missed} advanced=${advanced}`);
  return { sent, failed, claimed: claimedCount, missed, advanced };
}

module.exports = {
  runWakeAlarmSweep,
  hasWakeWorkerSecrets,
};
