'use strict';

const admin = require('firebase-admin');
const { formatReminderPushText } = require('./event-reminder');

const EVENT_REMINDER_ROOT = 'eventReminders';
const LOOKBACK_MS = 25 * 60 * 1000;
const CLAIM_STALE_MS = 10 * 60 * 1000;

let _db = null;

function hasReminderWorkerSecrets() {
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

async function claimReminder(sourceId, reminderId, now) {
  const ref = getDb().ref(`${EVENT_REMINDER_ROOT}/${sourceId}/${reminderId}`);
  const claimToken = `evt-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const claimAtIso = new Date(now).toISOString();

  const result = await ref.transaction(current => {
    if (!current || typeof current !== 'object') return current;

    const dueAt = Number(current.reminderAt || current.dueAt);
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

  return { reminder: claimed, claimToken };
}

async function markReminderSent(sourceId, reminderId, claimToken, now) {
  const ref = getDb().ref(`${EVENT_REMINDER_ROOT}/${sourceId}/${reminderId}`);
  const sentAtIso = new Date(now).toISOString();
  await ref.transaction(current => {
    if (!current || current.claimToken !== claimToken) return current;
    return {
      ...current,
      status: 'sent',
      sentAt: now,
      sentAtIso,
      claimAt: null,
      claimAtIso: null,
      claimToken: null,
      lastError: null,
    };
  });
}

async function releaseReminderClaim(sourceId, reminderId, claimToken, err, now) {
  const ref = getDb().ref(`${EVENT_REMINDER_ROOT}/${sourceId}/${reminderId}`);
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

async function runEventReminderSweep() {
  if (!hasReminderWorkerSecrets()) {
    console.log('[reminder] required secrets missing; skip');
    return { sent: 0, failed: 0, claimed: 0 };
  }

  const now = Date.now();
  const snap = await getDb().ref(EVENT_REMINDER_ROOT).once('value');
  const sources = snap.val() || {};

  let sent = 0;
  let failed = 0;
  let claimedCount = 0;

  for (const [sourceId, rems] of Object.entries(sources)) {
    if (!rems || typeof rems !== 'object') continue;
    for (const [reminderId] of Object.entries(rems)) {
      const claimed = await claimReminder(sourceId, reminderId, now);
      if (!claimed) continue;

      claimedCount += 1;
      try {
        await pushLineMessages(sourceId, [{
          type: 'text',
          text: formatReminderPushText(claimed.reminder),
        }]);
        await markReminderSent(sourceId, reminderId, claimed.claimToken, now);
        sent += 1;
      } catch (err) {
        failed += 1;
        console.error('[reminder] failed', sourceId, reminderId, err?.message || err);
        await releaseReminderClaim(sourceId, reminderId, claimed.claimToken, err, now);
      }
    }
  }

  console.log(`[reminder] sent=${sent} failed=${failed} claimed=${claimedCount}`);
  return { sent, failed, claimed: claimedCount };
}

module.exports = {
  runEventReminderSweep,
  hasReminderWorkerSecrets,
};
