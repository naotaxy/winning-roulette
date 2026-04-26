'use strict';
require('dotenv').config();

const express = require('express');
const { middleware, Client } = require('@line/bot-sdk');
const webhook = require('./src/webhook');
const { runEventReminderSweep, hasReminderWorkerSecrets } = require('./src/event-reminder-worker');
const { runWakeAlarmSweep, hasWakeWorkerSecrets } = require('./src/wake-alarm-worker');
const { hasGithubActionsDispatchToken, maybeDispatchSchedulerWorkflow } = require('./src/github-actions-dispatcher');

const config = {
  channelSecret:     process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

process.on('uncaughtException',    err => console.error('[uncaught]', err));
process.on('unhandledRejection',   err => console.error('[unhandledRejection]', err));

const app  = express();
const port = process.env.PORT || 3000;
const BACKGROUND_DELIVERY_POLL_MS = 60 * 1000;

/* ── ヘルスチェック（UptimeRobot用） ── */
app.get('/health', (_req, res) => res.json({
  ok: true,
  ts: new Date().toISOString(),
  commit: process.env.RENDER_GIT_COMMIT ? process.env.RENDER_GIT_COMMIT.slice(0, 7) : null,
  line: {
    channelSecret: !!process.env.LINE_CHANNEL_SECRET,
    channelAccessToken: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
  },
  workers: {
    eventReminders: hasReminderWorkerSecrets(),
    wakeAlarms: hasWakeWorkerSecrets(),
  },
  githubActions: {
    dispatchEnabled: hasGithubActionsDispatchToken(),
  },
}));

/* ── LINE Webhook ── */
app.post('/webhook', middleware(config), (req, res) => {
  res.json({ ok: true });  // LINEには必ず200を即返す（再試行ループ防止）
  const client = new Client(config);
  req.body.events.forEach(event => {
    webhook.handle(event, client).catch(err => console.error('[webhook error]', err));
  });
});

app.use((err, req, res, next) => {
  if (req.path === '/webhook') {
    console.error('[line middleware error]', err?.message || err);
    return res.status(401).json({ ok: false, error: 'line webhook rejected' });
  }
  return next(err);
});

function startBackgroundSweep(name, task, intervalMs) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await task();
    } catch (err) {
      console.error(`[background:${name}]`, err?.message || err);
    } finally {
      running = false;
    }
  };

  setTimeout(tick, 15 * 1000);
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
}

if (hasReminderWorkerSecrets()) {
  startBackgroundSweep('event-reminders', runEventReminderSweep, BACKGROUND_DELIVERY_POLL_MS);
}

if (hasWakeWorkerSecrets()) {
  startBackgroundSweep('wake-alarms', runWakeAlarmSweep, BACKGROUND_DELIVERY_POLL_MS);
}

if (hasGithubActionsDispatchToken()) {
  startBackgroundSweep('github-actions-dispatch', maybeDispatchSchedulerWorkflow, 5 * 60 * 1000);
}

app.listen(port, () => console.log(`[server] listening on port ${port}`));
