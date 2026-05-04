'use strict';
require('dotenv').config();

const express = require('express');
const { middleware, Client } = require('@line/bot-sdk');
const webhook = require('./src/webhook');
const { runEventReminderSweep, hasReminderWorkerSecrets } = require('./src/event-reminder-worker');
const { runWakeAlarmSweep, hasWakeWorkerSecrets } = require('./src/wake-alarm-worker');
const { runDiaryCron, getDiaryCronStatus } = require('./src/diary-cron');
const {
  hasGithubActionsDispatchToken,
  maybeDispatchSchedulerWorkflow,
  getSchedulerWorkflows,
  getGithubActionsDispatchStatus,
} = require('./src/github-actions-dispatcher');

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
const REMINDER_CRON_SECRET = String(process.env.REMINDER_CRON_SECRET || '').trim();
const DIARY_CRON_SECRET = String(process.env.DIARY_CRON_SECRET || process.env.REMINDER_CRON_SECRET || '').trim();
const backgroundSweepTriggers = [];
let lastWebhookRecoveryAt = 0;
let webhookRecoveryTimer = null;

/* ── ヘルスチェック（UptimeRobot用） ── */
app.get('/health', (_req, res) => {
  triggerBackgroundSweeps({ reason: 'health' }).catch(() => {});
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
      workflows: getSchedulerWorkflows(),
      dispatchStatus: getGithubActionsDispatchStatus(),
    },
    externalRecovery: {
      reminderCron: '/cron/reminders',
      reminderCronProtected: !!REMINDER_CRON_SECRET,
      diaryCron: '/cron/diary',
      diaryCronProtected: !!DIARY_CRON_SECRET,
      diary: getDiaryCronStatus(),
    },
  });
});

/* ── 外部Ping復帰（UptimeRobot等） ── */
app.get('/cron/reminders', async (req, res) => {
  if (!isReminderCronAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const results = await triggerBackgroundSweeps({
    reason: 'cron-reminders',
    includeDispatch: false,
    wait: true,
  });

  return res.json({
    ok: true,
    ts: new Date().toISOString(),
    commit: process.env.RENDER_GIT_COMMIT ? process.env.RENDER_GIT_COMMIT.slice(0, 7) : null,
    recovery: {
      type: 'local-reminder-sweep',
      protected: !!REMINDER_CRON_SECRET,
      results,
    },
  });
});

app.get('/cron/diary', async (req, res) => {
  if (!isCronAuthorized(req, DIARY_CRON_SECRET)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const result = runDiaryCron({
    force: /^(1|true|yes|on)$/i.test(String(req.query?.force || '')),
    date: String(req.query?.date || ''),
  });

  return res.json({
    ok: result.ok !== false,
    ts: new Date().toISOString(),
    commit: process.env.RENDER_GIT_COMMIT ? process.env.RENDER_GIT_COMMIT.slice(0, 7) : null,
    diary: {
      protected: !!DIARY_CRON_SECRET,
      result,
      status: getDiaryCronStatus(),
    },
  });
});

app.get('/cron/diary/status', (req, res) => {
  if (!isCronAuthorized(req, DIARY_CRON_SECRET)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  return res.json({
    ok: true,
    ts: new Date().toISOString(),
    commit: process.env.RENDER_GIT_COMMIT ? process.env.RENDER_GIT_COMMIT.slice(0, 7) : null,
    diary: {
      protected: !!DIARY_CRON_SECRET,
      status: getDiaryCronStatus(),
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
    if (running) return { skipped: true, reason: 'already-running' };
    running = true;
    try {
      return await task();
    } catch (err) {
      console.error(`[background:${name}]`, err?.message || err);
      throw err;
    } finally {
      running = false;
    }
  };

  setTimeout(tick, BACKGROUND_START_DELAY_MS);
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  backgroundSweepTriggers.push({ name, trigger: tick });
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
    triggerBackgroundSweeps({ reason: 'webhook-recovery' }).catch(() => {});
  }, WEBHOOK_RECOVERY_DELAY_MS);
  if (typeof webhookRecoveryTimer.unref === 'function') webhookRecoveryTimer.unref();
}

async function triggerBackgroundSweeps({ reason, includeDispatch = true, wait = false } = {}) {
  const targets = backgroundSweepTriggers.filter(entry => (
    includeDispatch || entry.name !== 'github-actions-dispatch'
  ));
  const jobs = targets.map(({ name, trigger }) => runOneBackgroundSweep(name, trigger, reason));
  if (!wait) {
    jobs.forEach(job => job.catch(() => {}));
    return [];
  }
  return Promise.all(jobs);
}

async function runOneBackgroundSweep(name, trigger, reason = 'manual') {
  const startedAt = Date.now();
  try {
    const result = await trigger();
    return {
      name,
      ok: true,
      reason,
      latencyMs: Date.now() - startedAt,
      result: result || null,
    };
  } catch (err) {
    console.error(`[background:${reason}:${name}]`, err?.message || err);
    return {
      name,
      ok: false,
      reason,
      latencyMs: Date.now() - startedAt,
      error: String(err?.message || err || '').slice(0, 240),
    };
  }
}

function isReminderCronAuthorized(req) {
  return isCronAuthorized(req, REMINDER_CRON_SECRET);
}

function isCronAuthorized(req, secret) {
  if (!secret) return true;
  const querySecret = String(req.query?.secret || '').trim();
  const headerSecret = String(req.get('x-cron-secret') || '').trim();
  const authHeader = String(req.get('authorization') || '');
  const bearerSecret = authHeader.replace(/^Bearer\s+/i, '').trim();
  return [querySecret, headerSecret, bearerSecret].includes(secret);
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
