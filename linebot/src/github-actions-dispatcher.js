'use strict';

const GITHUB_OWNER = process.env.GITHUB_OWNER || 'naotaxy';
const GITHUB_REPO = process.env.GITHUB_REPO || 'winning-roulette';
const DEFAULT_SCHEDULER_WORKFLOWS = ['event-reminder.yml', 'wake-alarm.yml'];
const SCHEDULER_REF = process.env.GITHUB_SCHEDULER_REF || 'main';
const DISPATCH_INTERVAL_MS = 5 * 60 * 1000;
const DISABLED_COOLDOWN_MS = readNonNegativeIntEnv('GITHUB_ACTIONS_DISABLED_COOLDOWN_MS', 30 * 60 * 1000);

let lastDispatchAt = 0;
let inflight = false;
let disabledUntil = 0;
let disabledReason = '';
let lastDispatchStatus = {
  attemptedAt: null,
  attemptedAtIso: '',
  ok: null,
  workflows: [],
  results: [],
};

function getGithubActionsDispatchToken() {
  return String(
    process.env.GITHUB_ACTIONS_DISPATCH_TOKEN
    || process.env.GITHUB_TOKEN
    || process.env.GH_TOKEN
    || '',
  ).trim();
}

function hasGithubActionsDispatchToken() {
  return !!getGithubActionsDispatchToken();
}

function getSchedulerWorkflows() {
  const raw = process.env.GITHUB_SCHEDULER_WORKFLOWS || process.env.GITHUB_SCHEDULER_WORKFLOW || '';
  const workflows = raw
    ? raw.split(',').map(item => item.trim()).filter(Boolean)
    : DEFAULT_SCHEDULER_WORKFLOWS;
  return [...new Set(workflows)];
}

function buildDispatchBody(workflow, task) {
  const body = { ref: SCHEDULER_REF };
  if (/daily-diary\.ya?ml$/i.test(workflow)) {
    body.inputs = { task };
  }
  return body;
}

async function dispatchWorkflow(workflow, task = 'scheduler') {
  const token = getGithubActionsDispatchToken();
  if (!token) return false;

  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(GITHUB_OWNER)}/${encodeURIComponent(GITHUB_REPO)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'winning-roulette-linebot',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify(buildDispatchBody(workflow, task)),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`workflow dispatch failed ${workflow}: ${res.status} ${body.slice(0, 300)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return true;
}

async function dispatchSchedulerWorkflow(task = 'scheduler') {
  const workflows = getSchedulerWorkflows();
  if (!workflows.length) return false;

  const attemptedAt = Date.now();
  const results = await Promise.allSettled(workflows.map(workflow => dispatchWorkflow(workflow, task)));
  let ok = false;
  const normalizedResults = [];
  results.forEach((result, index) => {
    const workflow = workflows[index];
    if (result.status === 'fulfilled' && result.value) {
      ok = true;
      normalizedResults.push({ workflow, ok: true });
      console.log(`[github-actions-dispatch] dispatched ${workflow}`);
    } else if (result.status === 'rejected') {
      normalizedResults.push({
        workflow,
        ok: false,
        error: String(result.reason?.message || result.reason || '').slice(0, 220),
      });
      console.error('[github-actions-dispatch]', result.reason?.message || result.reason);
    } else {
      normalizedResults.push({ workflow, ok: false, error: 'dispatch returned false' });
    }
  });
  lastDispatchStatus = {
    attemptedAt,
    attemptedAtIso: new Date(attemptedAt).toISOString(),
    ok,
    workflows,
    results: normalizedResults,
  };
  const disabledHit = normalizedResults.find(result => isActionsDisabledError(result.error));
  if (disabledHit) {
    disabledUntil = Date.now() + DISABLED_COOLDOWN_MS;
    disabledReason = 'GitHub Actions is disabled for this user';
    console.warn(`[github-actions-dispatch] paused until ${new Date(disabledUntil).toISOString()}: ${disabledReason}`);
  }
  return ok;
}

async function maybeDispatchSchedulerWorkflow(now = Date.now()) {
  if (!hasGithubActionsDispatchToken() || inflight) return false;
  if (disabledUntil && now < disabledUntil) return false;
  if (disabledUntil && now >= disabledUntil) {
    disabledUntil = 0;
    disabledReason = '';
  }
  if (lastDispatchAt && now - lastDispatchAt < DISPATCH_INTERVAL_MS - 15 * 1000) return false;

  inflight = true;
  try {
    const ok = await dispatchSchedulerWorkflow('scheduler');
    if (ok) lastDispatchAt = now;
    if (!ok) lastDispatchAt = now;
    return ok;
  } finally {
    inflight = false;
  }
}

function getGithubActionsDispatchStatus() {
  return {
    enabled: hasGithubActionsDispatchToken(),
    workflows: getSchedulerWorkflows(),
    inflight,
    paused: !!disabledUntil && Date.now() < disabledUntil,
    disabledUntil,
    disabledUntilIso: disabledUntil ? new Date(disabledUntil).toISOString() : '',
    disabledReason,
    lastDispatchAt,
    lastDispatchAtIso: lastDispatchAt ? new Date(lastDispatchAt).toISOString() : '',
    lastDispatchStatus,
  };
}

function isActionsDisabledError(error) {
  return /actions has been disabled for this user/i.test(String(error || ''));
}

function readNonNegativeIntEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

module.exports = {
  hasGithubActionsDispatchToken,
  maybeDispatchSchedulerWorkflow,
  getSchedulerWorkflows,
  getGithubActionsDispatchStatus,
};
