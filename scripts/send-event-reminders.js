'use strict';

const admin = require('firebase-admin');
const { formatReminderPushText } = require('../linebot/src/event-reminder');

const EVENT_REMINDER_ROOT = 'eventReminders';
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

async function processReminder(sourceId, reminderId, reminder, now) {
  const dueAt = Number(reminder?.reminderAt || reminder?.dueAt);
  if (!sourceId || !reminder || reminder.status !== 'active') return false;
  if (!Number.isFinite(dueAt)) return false;
  if (dueAt > now || dueAt < now - LOOKBACK_MS) return false;

  const text = formatReminderPushText(reminder);
  await pushLineMessages(sourceId, [{ type: 'text', text }]);

  await getDb().ref(`${EVENT_REMINDER_ROOT}/${sourceId}/${reminderId}`).update({
    status: 'sent',
    sentAt: now,
    sentAtIso: new Date(now).toISOString(),
  });
  return true;
}

async function main() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT || !process.env.FIREBASE_DATABASE_URL) {
    console.log('[reminder] Firebase secrets missing; skip');
    return;
  }
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    console.log('[reminder] LINE token missing; skip');
    return;
  }

  const now = Date.now();
  const snap = await getDb().ref(EVENT_REMINDER_ROOT).once('value');
  const sources = snap.val() || {};

  let sent = 0;
  let failed = 0;
  for (const [sourceId, rems] of Object.entries(sources)) {
    if (!rems || typeof rems !== 'object') continue;
    for (const [remId, rem] of Object.entries(rems)) {
      try {
        if (await processReminder(sourceId, remId, rem, now)) sent += 1;
      } catch (err) {
        failed += 1;
        console.error('[reminder] failed', sourceId, remId, err?.message || err);
        await getDb().ref(`${EVENT_REMINDER_ROOT}/${sourceId}/${remId}`).update({
          lastError: String(err?.message || err).slice(0, 300),
        }).catch(() => {});
      }
    }
  }

  console.log(`[reminder] sent=${sent} failed=${failed}`);
}

main()
  .catch(err => {
    console.error('[reminder] fatal', err);
    process.exitCode = 1;
  })
  .finally(() => {
    admin.app().delete().catch(() => {});
  });
