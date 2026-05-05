'use strict';

const {
  createNoblesseExecution,
  updateNoblesseExecution,
} = require('./firebase-admin');

const EXECUTION_LEVEL = {
  line_send: 2,
  booking_handoff: 3,
  mail_send: 4,
  booking_finalize: 5,
  purchase_attempt: 6,
};

const DEFAULT_POLICY = Object.freeze({
  maxLevel: 3,
  finalReservationAllowed: false,
  finalPurchaseAllowed: false,
});

function getExecutionPolicy(caseData) {
  const source = caseData?.executionPolicy || {};
  return {
    maxLevel: toPositiveInteger(source.maxLevel, DEFAULT_POLICY.maxLevel),
    finalReservationAllowed: source.finalReservationAllowed === true,
    finalPurchaseAllowed: source.finalPurchaseAllowed === true,
  };
}

async function planNoblesseExecution({ caseId, caseData, sourceId, actorName, type, provider, payload = {} }) {
  const policy = getExecutionPolicy(caseData);
  const level = EXECUTION_LEVEL[type] || 99;
  const blockedReason = getBlockedReason(type, level, policy);
  const record = {
    caseId: caseId || '',
    sourceId: sourceId || '',
    actorName: String(actorName || '').slice(0, 50),
    type: String(type || '').slice(0, 40),
    provider: String(provider || '').slice(0, 40),
    level,
    status: blockedReason ? 'blocked' : 'planned',
    blockedReason: blockedReason || '',
    policySnapshot: policy,
    payload: sanitizeValue(payload),
  };
  const executionId = await createNoblesseExecution(caseId, record);
  return {
    allowed: !blockedReason,
    executionId,
    caseId,
    type,
    provider,
    level,
    blockedReason,
    policy,
  };
}

async function markExecutionRunning(plan, patch = {}) {
  if (!plan?.executionId || !plan?.caseId || !plan.allowed) return;
  await updateNoblesseExecution(plan.caseId, plan.executionId, {
    status: 'running',
    startedAt: Date.now(),
    ...sanitizeValue(patch),
  });
}

async function completeNoblesseExecution(plan, result = {}) {
  if (!plan?.executionId || !plan?.caseId || !plan.allowed) return;
  await updateNoblesseExecution(plan.caseId, plan.executionId, {
    status: 'done',
    finishedAt: Date.now(),
    result: sanitizeValue(result),
  });
}

async function failNoblesseExecution(plan, error, result = {}) {
  if (!plan?.executionId || !plan?.caseId) return;
  await updateNoblesseExecution(plan.caseId, plan.executionId, {
    status: 'failed',
    finishedAt: Date.now(),
    result: sanitizeValue({
      ...result,
      error: previewText(error?.message || error || 'unknown error', 200),
    }),
  });
}

function formatExecutionBlockedReply(plan) {
  if (!plan?.blockedReason) {
    return 'その実行はまだ通せないみたい。条件を見直して、もう一度だけ教えて。';
  }
  switch (plan.blockedReason) {
    case 'policy_max_level':
      return `その実行は今のノブレス設定だとまだ重すぎるの。今はレベル${plan.policy?.maxLevel || DEFAULT_POLICY.maxLevel}までにしてあるよ。`;
    case 'reservation_final_confirmation_required':
      return '最終予約の確定までは、まだ人の確認を残してるの。予約ページを開くところまでなら私がやるよ。';
    case 'purchase_final_confirmation_required':
      return '購入確定はまだ自動では通さないよ。誤課金が怖いから、そこだけは別系統で扱うね。';
    default:
      return 'その実行は今はまだ許可していないの。ひとつ手前の段取りまでなら進められるよ。';
  }
}

function getBlockedReason(type, level, policy) {
  if (level > policy.maxLevel) return 'policy_max_level';
  if (type === 'booking_finalize' && !policy.finalReservationAllowed) {
    return 'reservation_final_confirmation_required';
  }
  if (type === 'purchase_attempt' && !policy.finalPurchaseAllowed) {
    return 'purchase_final_confirmation_required';
  }
  return '';
}

function toPositiveInteger(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.floor(num);
}

function sanitizeValue(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 10).map(sanitizeValue);
  if (typeof value === 'object') {
    const entries = Object.entries(value).slice(0, 20);
    return Object.fromEntries(entries.map(([key, val]) => [String(key).slice(0, 40), sanitizeValue(val)]));
  }
  if (typeof value === 'string') return previewText(value, 500);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return previewText(String(value), 200);
}

function previewText(text, maxLen) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen)}...` : normalized;
}

module.exports = {
  EXECUTION_LEVEL,
  DEFAULT_POLICY,
  getExecutionPolicy,
  planNoblesseExecution,
  markExecutionRunning,
  completeNoblesseExecution,
  failNoblesseExecution,
  formatExecutionBlockedReply,
};
