'use strict';

const GITHUB_OWNER = process.env.GITHUB_OWNER || 'naotaxy';
const GITHUB_REPO = process.env.GITHUB_REPO || 'winning-roulette';
const SCHEDULER_WORKFLOW = process.env.GITHUB_SCHEDULER_WORKFLOW || 'daily-diary.yml';
const SCHEDULER_REF = process.env.GITHUB_SCHEDULER_REF || 'main';
const DISPATCH_INTERVAL_MS = 5 * 60 * 1000;

let lastDispatchAt = 0;
let inflight = false;

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

async function dispatchSchedulerWorkflow(task = 'scheduler') {
  const token = getGithubActionsDispatchToken();
  if (!token) return false;

  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(GITHUB_OWNER)}/${encodeURIComponent(GITHUB_REPO)}/actions/workflows/${encodeURIComponent(SCHEDULER_WORKFLOW)}/dispatches`,
    {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'winning-roulette-linebot',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({
        ref: SCHEDULER_REF,
        inputs: { task },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`workflow dispatch failed: ${res.status} ${body.slice(0, 300)}`);
  }
  return true;
}

async function maybeDispatchSchedulerWorkflow(now = Date.now()) {
  if (!hasGithubActionsDispatchToken() || inflight) return false;
  if (lastDispatchAt && now - lastDispatchAt < DISPATCH_INTERVAL_MS - 15 * 1000) return false;

  inflight = true;
  try {
    const ok = await dispatchSchedulerWorkflow('scheduler');
    if (ok) lastDispatchAt = now;
    return ok;
  } finally {
    inflight = false;
  }
}

module.exports = {
  hasGithubActionsDispatchToken,
  maybeDispatchSchedulerWorkflow,
};
