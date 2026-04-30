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
const BACKGROUND_DELIVERY_POLL_MS = 30 * 1000;
const BACKGROUND_START_DELAY_MS = readNonNegativeIntEnv('BACKGROUND_START_DELAY_MS', 45 * 1000);
const WEBHOOK_RECOVERY_DELAY_MS = readNonNegativeIntEnv('WEBHOOK_RECOVERY_DELAY_MS', 2500);
const WEBHOOK_RECOVERY_COOLDOWN_MS = readNonNegativeIntEnv('WEBHOOK_RECOVERY_COOLDOWN_MS', 60 * 1000);
const backgroundSweepTriggers = [];
let lastWebhookRecoveryAt = 0;
let webhookRecoveryTimer = null;

/* ── ヘルスチェック（UptimeRobot用） ── */
app.get('/health', (_req, res) => {
  for (const trigger of backgroundSweepTriggers) {
    Promise.resolve(trigger()).catch(() => {});
  }
  res.json({
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
  });
});

/* ── LINE Webhook ── */
app.post('/webhook', middleware(config), (req, res) => {
  res.json({ ok: true });  // LINEには必ず200を即返す（再試行ループ防止）
  const client = new Client(config);
  req.body.events.forEach(event => {
    webhook.handle(event, client)
      .catch(err => console.error('[webhook error]', err))
      .finally(() => scheduleWebhookRecoverySweep());
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

  setTimeout(tick, BACKGROUND_START_DELAY_MS);
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  backgroundSweepTriggers.push(tick);
  return tick;
}

function scheduleWebhookRecoverySweep() {
  if (!backgroundSweepTriggers.length) return;
  const now = Date.now();
  if (lastWebhookRecoveryAt && now - lastWebhookRecoveryAt < WEBHOOK_RECOVERY_COOLDOWN_MS) return;
  if (webhookRecoveryTimer) return;

  webhookRecoveryTimer = setTimeout(() => {
    webhookRecoveryTimer = null;
    lastWebhookRecoveryAt = Date.now();
    backgroundSweepTriggers.forEach(trigger => {
      Promise.resolve(trigger()).catch(err => console.error('[webhook-recovery]', err?.message || err));
    });
  }, WEBHOOK_RECOVERY_DELAY_MS);
  if (typeof webhookRecoveryTimer.unref === 'function') webhookRecoveryTimer.unref();
}

function readNonNegativeIntEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
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
