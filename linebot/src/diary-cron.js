'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { redactSensitiveText } = require('./security-utils');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LINEBOT_ROOT = path.resolve(__dirname, '..');
const DIARY_SCRIPT = path.join(REPO_ROOT, 'scripts', 'generate-diary.js');
const DIARY_RUN_AFTER_HOUR_JST = readNonNegativeIntEnv('DIARY_CRON_HOUR_JST', 7);
const DIARY_RUN_TIMEOUT_MS = readNonNegativeIntEnv('DIARY_CRON_TIMEOUT_MS', 9 * 60 * 1000);
const OUTPUT_LIMIT = 5000;

let running = false;
let lastStatus = {
  state: 'idle',
  startedAt: null,
  startedAtIso: '',
  finishedAt: null,
  finishedAtIso: '',
  ok: null,
  skipped: false,
  reason: '',
  date: '',
  exitCode: null,
  signal: '',
  output: '',
};

function hasDiaryCronMinimumSecrets() {
  const missing = getMissingDiaryEnv();
  return missing.length === 0;
}

function getMissingDiaryEnv() {
  return [
    'HATENA_ID',
    'HATENA_BLOG_ID',
    'HATENA_API_KEY',
    'FIREBASE_SERVICE_ACCOUNT',
    'FIREBASE_DATABASE_URL',
  ].filter(name => !String(process.env[name] || '').trim());
}

function getDiaryCronStatus() {
  return {
    ...lastStatus,
    running,
    scriptExists: fs.existsSync(DIARY_SCRIPT),
    runAfterHourJst: DIARY_RUN_AFTER_HOUR_JST,
    missingEnv: getMissingDiaryEnv(),
  };
}

function runDiaryCron({ force = false, date = '' } = {}) {
  const targetDate = normalizeDiaryDate(date) || getJstDate();
  const nowParts = getJstParts();

  if (running) {
    return updateSkippedStatus('already-running', targetDate);
  }
  if (!fs.existsSync(DIARY_SCRIPT)) {
    return updateSkippedStatus(`script not found: ${DIARY_SCRIPT}`, targetDate, false);
  }

  const missingEnv = getMissingDiaryEnv();
  if (missingEnv.length) {
    return updateSkippedStatus(`missing env: ${missingEnv.join(', ')}`, targetDate, false);
  }

  if (!force && nowParts.hour < DIARY_RUN_AFTER_HOUR_JST) {
    return updateSkippedStatus(`before ${DIARY_RUN_AFTER_HOUR_JST}:00 JST`, targetDate);
  }

  const startedAt = Date.now();
  running = true;
  lastStatus = {
    state: 'running',
    startedAt,
    startedAtIso: new Date(startedAt).toISOString(),
    finishedAt: null,
    finishedAtIso: '',
    ok: null,
    skipped: false,
    reason: force ? 'force' : 'scheduled',
    date: targetDate,
    exitCode: null,
    signal: '',
    output: '',
  };

  const env = {
    ...process.env,
    NODE_PATH: buildNodePath(),
    DIARY_DATE: targetDate,
    DIARY_REQUIRE_HATENA: 'true',
    DIARY_FORCE: force ? 'true' : '',
  };

  const child = spawn(process.execPath, [DIARY_SCRIPT], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const timer = setTimeout(() => {
    lastStatus.output = appendOutput(lastStatus.output, `\n[diary-cron] timeout after ${DIARY_RUN_TIMEOUT_MS}ms`);
    child.kill('SIGTERM');
  }, DIARY_RUN_TIMEOUT_MS);
  if (typeof timer.unref === 'function') timer.unref();

  child.stdout.on('data', chunk => {
    lastStatus.output = appendOutput(lastStatus.output, chunk.toString('utf8'));
  });
  child.stderr.on('data', chunk => {
    lastStatus.output = appendOutput(lastStatus.output, chunk.toString('utf8'));
  });
  child.on('error', err => {
    finishRun({ ok: false, error: err.message });
  });
  child.on('close', (code, signal) => {
    clearTimeout(timer);
    finishRun({ ok: code === 0, code, signal });
  });

  return {
    ok: true,
    started: true,
    running: true,
    date: targetDate,
    reason: lastStatus.reason,
  };
}

function finishRun({ ok, code = null, signal = '', error = '' }) {
  const finishedAt = Date.now();
  running = false;
  lastStatus = {
    ...lastStatus,
    state: ok ? 'completed' : 'failed',
    finishedAt,
    finishedAtIso: new Date(finishedAt).toISOString(),
    ok,
    exitCode: code,
    signal: signal || '',
    reason: error || lastStatus.reason,
  };
}

function updateSkippedStatus(reason, date, ok = true) {
  const now = Date.now();
  lastStatus = {
    ...lastStatus,
    state: 'skipped',
    startedAt: now,
    startedAtIso: new Date(now).toISOString(),
    finishedAt: now,
    finishedAtIso: new Date(now).toISOString(),
    ok,
    skipped: true,
    reason,
    date,
    exitCode: null,
    signal: '',
  };
  return { ok, skipped: true, running: false, date, reason };
}

function buildNodePath() {
  const paths = [
    path.join(LINEBOT_ROOT, 'node_modules'),
    process.env.NODE_PATH || '',
  ].filter(Boolean);
  return paths.join(path.delimiter);
}

function appendOutput(current, addition) {
  const merged = redactSensitiveText(`${current || ''}${addition || ''}`, { redactPersonal: true });
  return merged.length > OUTPUT_LIMIT ? merged.slice(-OUTPUT_LIMIT) : merged;
}

function normalizeDiaryDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) return '';
  return raw;
}

function getJstDate() {
  const parts = getJstParts();
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function getJstParts(now = Date.now()) {
  const date = new Date(now + 9 * 60 * 60 * 1000);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

function readNonNegativeIntEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

module.exports = {
  runDiaryCron,
  getDiaryCronStatus,
  hasDiaryCronMinimumSecrets,
};
