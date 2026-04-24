'use strict';

const admin = require('firebase-admin');
const { getTokyoDateParts } = require('./date-utils');
const { normalizeMatchSchedule } = require('./match-schedule');

let _db = null;

function getDb() {
  if (_db) return _db;
  if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential:  admin.credential.cert(sa),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }
  _db = admin.database();
  return _db;
}

/* プレイヤー設定を Firebase config から取得（5分キャッシュ） */
let _playersCache = null;
let _playersCacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000;
const DEFAULT_RESTRICT_MONTHS = [5, 6, 8, 9, 11];
const AI_CHAT_GUARD_PATH = 'config/aiChatGuard/autoDisabled';
const AI_CHAT_USAGE_ROOT = 'aiChatUsage';
const GEO_GAME_ROOT = 'geoGames';
const GEO_GAME_USAGE_ROOT = 'geoGameUsage';
const GEO_GAME_CACHE_ROOT = 'geoGameCache';
const OCR_AUTOMATION_ROOT = 'ocrAutomation';
const SCREENSHOT_CANDIDATES_ROOT = 'screenshotCandidates';

async function getPlayers() {
  if (_playersCache && Date.now() - _playersCacheTs < CACHE_TTL) return _playersCache;
  const snap = await getDb().ref('config/players').once('value');
  const raw = snap.val();
  console.log('[firebase] config/players raw:', JSON.stringify(raw)?.slice(0, 200));
  _playersCache = raw || [];
  _playersCacheTs = Date.now();
  return _playersCache;
}

/* OCR結果を一時保留（TTL: 1時間） */
async function savePending(msgId, data) {
  await getDb().ref(`pendingOcr/${msgId}`).set({
    ...data,
    expiresAt: Date.now() + 60 * 60 * 1000,
  });
}

async function getPending(msgId) {
  const snap = await getDb().ref(`pendingOcr/${msgId}`).once('value');
  const data = snap.val();
  if (!data) return null;
  if (data.expiresAt < Date.now()) { await deletePending(msgId); return null; }
  return data;
}

async function deletePending(msgId) {
  await getDb().ref(`pendingOcr/${msgId}`).remove();
}

async function getMonthResults(year, month) {
  const snap = await getDb().ref(`matchResults/${year}/${month}`).once('value');
  return snap.val() || {};
}

async function getYearResults(year) {
  const snap = await getDb().ref(`matchResults/${year}`).once('value');
  return snap.val() || {};
}

async function getMonthlyRule(year, month) {
  const snap = await getDb().ref(`monthlyRules/${year}/${month}`).once('value');
  return snap.val() || null;
}

/* ウイコレのリアルタイム情報
   config/uicolleNews: { event, gacha, updatedAt, diary, blogUrl } */
async function getUicolleNews() {
  const snap = await getDb().ref('config/uicolleNews').once('value');
  return snap.val() || null;
}

/* 日記アーカイブ — 直近N件 */
async function getRecentDiaries(limit = 7) {
  const snap = await getDb().ref('diary').orderByChild('createdAt').limitToLast(limit).once('value');
  const raw = snap.val();
  if (!raw) return [];
  return Object.entries(raw)
    .map(([date, entry]) => ({ date, ...entry }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function getRestrictMonths() {
  const snap = await getDb().ref('config/restrictMonths').once('value');
  const raw = snap.val();
  const months = Array.isArray(raw) ? raw : Object.values(raw || {});
  if (!months.length) return DEFAULT_RESTRICT_MONTHS;
  const normalized = months.map(Number).filter(month => Number.isInteger(month) && month >= 1 && month <= 12);
  return normalized.length ? normalized : DEFAULT_RESTRICT_MONTHS;
}

async function getMatchSchedule() {
  const snap = await getDb().ref('config/matchSchedule').once('value');
  return normalizeMatchSchedule(snap.val());
}

async function checkFirebaseStatus() {
  const startedAt = Date.now();
  try {
    const snap = await getDb().ref('config/players').once('value');
    const players = snap.val();
    const playerCount = Array.isArray(players)
      ? players.length
      : Object.keys(players || {}).length;
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      playerCount,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err?.message || String(err),
    };
  }
}

async function getGeoGameConfig() {
  const snap = await getDb().ref('config/geoGame').once('value');
  return snap.val() || {};
}

async function getGeoGame(sourceId) {
  if (!sourceId) return null;
  const snap = await getDb().ref(`${GEO_GAME_ROOT}/${sourceId}/current`).once('value');
  return snap.val() || null;
}

async function saveGeoGame(sourceId, game) {
  if (!sourceId || !game) return;
  await getDb().ref(`${GEO_GAME_ROOT}/${sourceId}/current`).set(game);
}

async function saveGeoGameAnswer(sourceId, answerKey, answer) {
  if (!sourceId || !answerKey || !answer) return;
  await getDb().ref(`${GEO_GAME_ROOT}/${sourceId}/current/answers/${answerKey}`).set(answer);
}

async function finishGeoGame(sourceId, game, status = 'finished') {
  if (!sourceId || !game) return;
  const finishedAt = Date.now();
  const finishedGame = { ...game, status, finishedAt };
  const updates = {};
  updates[`${GEO_GAME_ROOT}/${sourceId}/current`] = null;
  updates[`${GEO_GAME_ROOT}/${sourceId}/history/${game.id || finishedAt}`] = finishedGame;
  await getDb().ref().update(updates);
}

async function reserveGeoGameStart(dayKey, limit) {
  const ref = getDb().ref(`${GEO_GAME_USAGE_ROOT}/${dayKey}/started`);
  const result = await ref.transaction(current => {
    const count = Number(current) || 0;
    if (limit > 0 && count >= limit) return;
    return count + 1;
  }, undefined, false);
  return {
    allowed: !!result.committed,
    count: Number(result.snapshot?.val()) || 0,
    limit,
  };
}

async function getGeoGameUsage(dayKey) {
  const snap = await getDb().ref(`${GEO_GAME_USAGE_ROOT}/${dayKey}`).once('value');
  return snap.val() || {};
}

async function getGeoGameGeocodeCache(cacheKey) {
  if (!cacheKey) return null;
  const snap = await getDb().ref(`${GEO_GAME_CACHE_ROOT}/geocodes/${cacheKey}`).once('value');
  return snap.val() || null;
}

async function saveGeoGameGeocodeCache(cacheKey, data) {
  if (!cacheKey || !data) return;
  await getDb().ref(`${GEO_GAME_CACHE_ROOT}/geocodes/${cacheKey}`).set({
    ...data,
    savedAt: Date.now(),
  });
}

async function getOcrAutomationState(sourceId) {
  if (!sourceId) return normalizeOcrAutomationState(null);
  const snap = await getDb().ref(`${OCR_AUTOMATION_ROOT}/${sourceId}`).once('value');
  return normalizeOcrAutomationState(snap.val());
}

async function setOcrAutoEnabled(sourceId, enabled, updatedBy = null) {
  if (!sourceId) return normalizeOcrAutomationState({ autoEnabled: enabled });
  const now = Date.now();
  const payload = {
    autoEnabled: enabled === true,
    updatedAt: now,
    updatedAtIso: new Date(now).toISOString(),
    updatedBy: String(updatedBy || '不明').slice(0, 50),
  };
  await getDb().ref(`${OCR_AUTOMATION_ROOT}/${sourceId}`).update(payload);
  return normalizeOcrAutomationState(payload);
}

async function saveScreenshotCandidate(sourceId, dayKey, msgId, data = {}) {
  if (!sourceId || !dayKey || !msgId) return;
  const now = Date.now();
  await getDb().ref(`${SCREENSHOT_CANDIDATES_ROOT}/${sourceId}/${dayKey}/${msgId}`).update({
    ...data,
    messageId: msgId,
    status: data.status || 'queued',
    updatedAt: now,
    updatedAtIso: new Date(now).toISOString(),
  });
}

async function updateScreenshotCandidate(sourceId, dayKey, msgId, patch = {}) {
  if (!sourceId || !dayKey || !msgId) return;
  const now = Date.now();
  await getDb().ref(`${SCREENSHOT_CANDIDATES_ROOT}/${sourceId}/${dayKey}/${msgId}`).update({
    ...patch,
    updatedAt: now,
    updatedAtIso: new Date(now).toISOString(),
  });
}

async function getScreenshotCandidates(sourceId, dayKey, limit = 100) {
  if (!sourceId || !dayKey) return [];
  const snap = await getDb().ref(`${SCREENSHOT_CANDIDATES_ROOT}/${sourceId}/${dayKey}`).once('value');
  const raw = snap.val();
  if (!raw) return [];
  const rows = Object.entries(raw)
    .map(([id, value]) => ({ id, ...(value || {}), messageId: value?.messageId || id }))
    .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
  const max = Number(limit);
  return Number.isFinite(max) && max > 0 ? rows.slice(0, Math.floor(max)) : rows;
}

function normalizeOcrAutomationState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    autoEnabled: source.autoEnabled !== false,
    updatedAt: toNonNegativeInteger(source.updatedAt) || null,
    updatedAtIso: source.updatedAtIso ? trimGuardText(source.updatedAtIso) : '',
    updatedBy: source.updatedBy ? trimGuardText(source.updatedBy) : '',
  };
}

async function getAiChatGuardState(limits) {
  const period = getAiUsagePeriod();
  const [guardSnap, usageSnap] = await Promise.all([
    getDb().ref(AI_CHAT_GUARD_PATH).once('value'),
    getDb().ref(getAiUsagePath(period)).once('value'),
  ]);
  const autoDisabled = await recoverAiAutoDisabledIfExpired(guardSnap.val(), usageSnap.val(), limits, period);
  return buildAiGuardState({
    autoDisabled,
    usage: usageSnap.val(),
    limits,
    period,
  });
}

async function reserveAiChatRequest(limits, metadata = {}) {
  const period = getAiUsagePeriod();
  const meta = normalizeAiMetadata(metadata);
  const autoDisabled = await getAiAutoDisabled(limits);
  if (autoDisabled.disabled) {
    return {
      allowed: false,
      reason: autoDisabled.reason || 'AI会話は課金ガードで自動停止中です',
      state: await getAiChatGuardState(limits),
    };
  }

  const ref = getDb().ref(getAiUsagePath(period));
  const now = Date.now();
  const result = await ref.transaction(current => {
    const usage = normalizeAiMonthUsage(current, period);
    const dayUsage = normalizeAiDayUsage(usage.days[period.dayKey]);
    const reason = findAiLimitReason(usage, dayUsage, limits, true);
    if (reason) return;

    usage.calls += 1;
    usage.reservedCalls += 1;
    if (meta.provider) usage.lastProvider = meta.provider;
    if (meta.model) usage.lastModel = meta.model;
    usage.days[period.dayKey] = {
      ...dayUsage,
      calls: dayUsage.calls + 1,
      reservedCalls: dayUsage.reservedCalls + 1,
      ...(meta.provider ? { lastProvider: meta.provider } : {}),
      ...(meta.model ? { lastModel: meta.model } : {}),
      updatedAt: now,
    };
    usage.updatedAt = now;
    return usage;
  }, undefined, false);

  const usage = result.snapshot?.val();
  const state = buildAiGuardState({
    autoDisabled: { disabled: false },
    usage,
    limits,
    period,
  });

  if (result.committed) {
    return { allowed: true, state };
  }

  const reason = findAiLimitReason(
    normalizeAiMonthUsage(usage, period),
    normalizeAiDayUsage(normalizeAiMonthUsage(usage, period).days[period.dayKey]),
    limits,
    true,
  );
  await disableAiChatForBillingRisk(reason?.message || 'AI会話の無料枠ガード上限に達しました', {
    code: reason?.code || 'ai_guard_limit',
    provider: meta.provider,
    model: meta.model,
    usage: state.usage,
    limits: state.limits,
    period: state.period,
  });
  return {
    allowed: false,
    reason: reason?.message || 'AI会話の無料枠ガード上限に達しました',
    state: await getAiChatGuardState(limits),
  };
}

async function recordAiChatUsage(usage, limits, metadata = {}) {
  const tokenUsage = normalizeAiTokenUsage(usage);
  if (!tokenUsage.totalTokens && !tokenUsage.inputTokens && !tokenUsage.outputTokens) {
    return getAiChatGuardState(limits);
  }

  const period = getAiUsagePeriod();
  const meta = normalizeAiMetadata(metadata);
  const ref = getDb().ref(getAiUsagePath(period));
  const now = Date.now();
  const result = await ref.transaction(current => {
    const monthUsage = normalizeAiMonthUsage(current, period);
    const dayUsage = normalizeAiDayUsage(monthUsage.days[period.dayKey]);
    monthUsage.tokens += tokenUsage.totalTokens;
    monthUsage.inputTokens += tokenUsage.inputTokens;
    monthUsage.outputTokens += tokenUsage.outputTokens;
    if (meta.provider) monthUsage.lastProvider = meta.provider;
    if (meta.model) monthUsage.lastModel = meta.model;
    monthUsage.days[period.dayKey] = {
      ...dayUsage,
      tokens: dayUsage.tokens + tokenUsage.totalTokens,
      inputTokens: dayUsage.inputTokens + tokenUsage.inputTokens,
      outputTokens: dayUsage.outputTokens + tokenUsage.outputTokens,
      ...(meta.provider ? { lastProvider: meta.provider } : {}),
      ...(meta.model ? { lastModel: meta.model } : {}),
      updatedAt: now,
    };
    monthUsage.updatedAt = now;
    return monthUsage;
  }, undefined, false);

  const state = buildAiGuardState({
    autoDisabled: await getAiAutoDisabled(),
    usage: result.snapshot?.val(),
    limits,
    period,
  });
  const reason = findAiLimitReason(
    normalizeAiMonthUsage(result.snapshot?.val(), period),
    normalizeAiDayUsage(normalizeAiMonthUsage(result.snapshot?.val(), period).days[period.dayKey]),
    limits,
    false,
  );
  if (reason) {
    await disableAiChatForBillingRisk(reason.message, {
      code: reason.code,
      provider: meta.provider,
      model: meta.model,
      usage: state.usage,
      limits: state.limits,
      period: state.period,
    });
    return getAiChatGuardState(limits);
  }
  return state;
}

async function disableAiChatForBillingRisk(reason, details = {}) {
  const payload = {
    disabled: true,
    reason: trimGuardText(reason || 'AI会話の課金リスクを検知しました'),
    disabledAt: Date.now(),
    disabledAtIso: new Date().toISOString(),
    source: 'linebot-ai-cost-guard',
    details: sanitizeGuardDetails(details),
  };
  await getDb().ref(AI_CHAT_GUARD_PATH).set(payload);
  return payload;
}

async function getAiAutoDisabled(limits = null) {
  const snap = await getDb().ref(AI_CHAT_GUARD_PATH).once('value');
  const raw = snap.val();
  if (!limits) return normalizeAutoDisabled(raw);
  const period = getAiUsagePeriod();
  const usageSnap = await getDb().ref(getAiUsagePath(period)).once('value');
  return recoverAiAutoDisabledIfExpired(raw, usageSnap.val(), limits, period);
}

async function recoverAiAutoDisabledIfExpired(rawAutoDisabled, currentUsage, limits, period) {
  const autoDisabled = normalizeAutoDisabled(rawAutoDisabled);
  if (!autoDisabled.disabled) return autoDisabled;

  const code = getAutoDisabledCode(rawAutoDisabled);
  if (!isAutoRecoverableGuardCode(code)) return autoDisabled;
  if (!isAutoDisabledPeriodExpired(code, rawAutoDisabled, period)) return autoDisabled;

  const monthUsage = normalizeAiMonthUsage(currentUsage, period);
  const dayUsage = normalizeAiDayUsage(monthUsage.days[period.dayKey]);
  const currentReason = findAiLimitReason(monthUsage, dayUsage, limits, true);
  if (currentReason) return autoDisabled;

  const recoveredAt = Date.now();
  const payload = {
    disabled: false,
    reason: '',
    recoveredAt,
    recoveredAtIso: new Date(recoveredAt).toISOString(),
    source: 'linebot-ai-cost-guard-auto-recovery',
    recoveredFrom: {
      code,
      reason: autoDisabled.reason,
      disabledAt: autoDisabled.disabledAt,
      disabledAtIso: autoDisabled.disabledAtIso,
      period: getAutoDisabledPeriod(rawAutoDisabled),
      currentPeriod: {
        date: period.date,
        monthKey: period.monthKey,
        dayKey: period.dayKey,
      },
    },
  };
  await getDb().ref(AI_CHAT_GUARD_PATH).set(payload);
  console.log(`[ai-guard] auto recovered code=${code} period=${period.date}`);
  return normalizeAutoDisabled(payload);
}

function getAutoDisabledCode(rawAutoDisabled) {
  const source = rawAutoDisabled && typeof rawAutoDisabled === 'object' ? rawAutoDisabled : {};
  const code = trimGuardText(source.details?.code || source.code || '');
  if (code) return code;

  const reason = String(source.reason || '');
  if (/日次.*トークン/.test(reason)) return 'daily_token_limit';
  if (/月次.*トークン/.test(reason)) return 'monthly_token_limit';
  if (/日次上限|日次.*回/.test(reason)) return 'daily_request_limit';
  if (/月次上限|月次.*回/.test(reason)) return 'monthly_request_limit';
  return '';
}

function isAutoRecoverableGuardCode(code) {
  return [
    'daily_request_limit',
    'daily_token_limit',
    'monthly_request_limit',
    'monthly_token_limit',
  ].includes(code);
}

function isAutoDisabledPeriodExpired(code, rawAutoDisabled, currentPeriod) {
  const disabledPeriod = getAutoDisabledPeriod(rawAutoDisabled);
  if (code.startsWith('daily_')) {
    const disabledDate = disabledPeriod.date || getDisabledPeriodFromTimestamp(rawAutoDisabled).date;
    return !!disabledDate && disabledDate !== currentPeriod.date;
  }
  if (code.startsWith('monthly_')) {
    const disabledMonth = disabledPeriod.monthKey || getDisabledPeriodFromTimestamp(rawAutoDisabled).monthKey;
    return !!disabledMonth && disabledMonth !== currentPeriod.monthKey;
  }
  return false;
}

function getAutoDisabledPeriod(rawAutoDisabled) {
  const period = rawAutoDisabled?.details?.period;
  if (!period || typeof period !== 'object') return {};
  return {
    date: trimGuardText(period.date || ''),
    monthKey: trimGuardText(period.monthKey || ''),
    dayKey: trimGuardText(period.dayKey || ''),
  };
}

function getDisabledPeriodFromTimestamp(rawAutoDisabled) {
  const disabledAt = toNonNegativeInteger(rawAutoDisabled?.disabledAt);
  if (!disabledAt) return {};
  return getAiUsagePeriod(new Date(disabledAt));
}

function getAiUsagePeriod(date = new Date()) {
  const parts = getTokyoDateParts(date);
  return {
    ...parts,
    monthKey: `${parts.year}-${pad2(parts.month)}`,
    dayKey: pad2(parts.day),
  };
}

function getAiUsagePath(period) {
  return `${AI_CHAT_USAGE_ROOT}/${period.year}/${pad2(period.month)}`;
}

function buildAiGuardState({ autoDisabled, usage, limits, period }) {
  const monthUsage = normalizeAiMonthUsage(usage, period);
  const dayUsage = normalizeAiDayUsage(monthUsage.days[period.dayKey]);
  return {
    autoDisabled: normalizeAutoDisabled(autoDisabled),
    limits: normalizeAiLimits(limits),
    period: {
      year: period.year,
      month: period.month,
      day: period.day,
      monthKey: period.monthKey,
      dayKey: period.dayKey,
      date: period.date,
    },
    usage: {
      monthCalls: monthUsage.calls,
      dayCalls: dayUsage.calls,
      monthTokens: monthUsage.tokens,
      dayTokens: dayUsage.tokens,
      monthInputTokens: monthUsage.inputTokens,
      monthOutputTokens: monthUsage.outputTokens,
      dayInputTokens: dayUsage.inputTokens,
      dayOutputTokens: dayUsage.outputTokens,
      updatedAt: monthUsage.updatedAt || null,
    },
  };
}

function normalizeAiMonthUsage(raw, period) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const days = source.days && typeof source.days === 'object' ? { ...source.days } : {};
  return {
    period: source.period || period.monthKey,
    calls: toNonNegativeInteger(source.calls),
    reservedCalls: toNonNegativeInteger(source.reservedCalls),
    tokens: toNonNegativeInteger(source.tokens),
    inputTokens: toNonNegativeInteger(source.inputTokens),
    outputTokens: toNonNegativeInteger(source.outputTokens),
    days,
    updatedAt: toNonNegativeInteger(source.updatedAt),
  };
}

function normalizeAiDayUsage(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    calls: toNonNegativeInteger(source.calls),
    reservedCalls: toNonNegativeInteger(source.reservedCalls),
    tokens: toNonNegativeInteger(source.tokens),
    inputTokens: toNonNegativeInteger(source.inputTokens),
    outputTokens: toNonNegativeInteger(source.outputTokens),
    updatedAt: toNonNegativeInteger(source.updatedAt),
  };
}

function normalizeAiTokenUsage(usage) {
  const source = usage && typeof usage === 'object' ? usage : {};
  const inputTokens = toNonNegativeInteger(source.input_tokens ?? source.inputTokens ?? source.promptTokenCount);
  const outputTokens = toNonNegativeInteger(source.output_tokens ?? source.outputTokens ?? source.candidatesTokenCount);
  const totalTokens = toNonNegativeInteger(source.total_tokens ?? source.totalTokens ?? source.totalTokenCount) || inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

function normalizeAiMetadata(metadata) {
  const source = metadata && typeof metadata === 'object' ? metadata : {};
  return {
    provider: trimGuardText(source.provider || ''),
    model: trimGuardText(source.model || ''),
  };
}

function normalizeAiLimits(limits) {
  const source = limits && typeof limits === 'object' ? limits : {};
  return {
    dailyRequests: toNonNegativeInteger(source.dailyRequests),
    monthlyRequests: toNonNegativeInteger(source.monthlyRequests),
    dailyTokens: toNonNegativeInteger(source.dailyTokens),
    monthlyTokens: toNonNegativeInteger(source.monthlyTokens),
    estimatedTokensPerReply: toNonNegativeInteger(source.estimatedTokensPerReply),
  };
}

function normalizeAutoDisabled(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    disabled: source.disabled === true,
    reason: source.reason ? trimGuardText(source.reason) : '',
    disabledAt: toNonNegativeInteger(source.disabledAt) || null,
    disabledAtIso: source.disabledAtIso ? trimGuardText(source.disabledAtIso) : '',
    source: source.source ? trimGuardText(source.source) : '',
  };
}

function findAiLimitReason(monthUsage, dayUsage, limits, includeEstimate) {
  const normalizedLimits = normalizeAiLimits(limits);
  const estimate = includeEstimate ? normalizedLimits.estimatedTokensPerReply : 0;
  if (normalizedLimits.dailyRequests <= 0) {
    return { code: 'daily_request_limit_zero', message: 'AI_CHAT_DAILY_LIMIT が0なのでAI会話を止めました' };
  }
  if (normalizedLimits.monthlyRequests <= 0) {
    return { code: 'monthly_request_limit_zero', message: 'AI_CHAT_MONTHLY_LIMIT が0なのでAI会話を止めました' };
  }
  if (dayUsage.calls >= normalizedLimits.dailyRequests) {
    return { code: 'daily_request_limit', message: `AI会話の日次上限 ${normalizedLimits.dailyRequests} 回に達したので自動停止しました` };
  }
  if (monthUsage.calls >= normalizedLimits.monthlyRequests) {
    return { code: 'monthly_request_limit', message: `AI会話の月次上限 ${normalizedLimits.monthlyRequests} 回に達したので自動停止しました` };
  }
  if (normalizedLimits.dailyTokens > 0 && dayUsage.tokens + estimate >= normalizedLimits.dailyTokens) {
    return { code: 'daily_token_limit', message: `AI会話の日次トークン上限 ${normalizedLimits.dailyTokens} に近づいたので自動停止しました` };
  }
  if (normalizedLimits.monthlyTokens > 0 && monthUsage.tokens + estimate >= normalizedLimits.monthlyTokens) {
    return { code: 'monthly_token_limit', message: `AI会話の月次トークン上限 ${normalizedLimits.monthlyTokens} に近づいたので自動停止しました` };
  }
  return null;
}

function toNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function trimGuardText(value) {
  return String(value || '').replace(/\s+/g, ' ').slice(0, 200);
}

function sanitizeGuardDetails(details) {
  const safe = {};
  for (const [key, value] of Object.entries(details || {})) {
    if (value == null) continue;
    if (typeof value === 'string') safe[key] = trimGuardText(value);
    else if (typeof value === 'number' || typeof value === 'boolean') safe[key] = value;
    else if (typeof value === 'object') {
      try {
        safe[key] = JSON.parse(JSON.stringify(value));
      } catch (_) {
        safe[key] = trimGuardText(value);
      }
    }
  }
  return safe;
}

/* グループ会話メモリ */
const CONVERSATION_ROOT = 'conversations';

async function saveConversationMessage(sourceId, senderName, text, userId = null) {
  if (!sourceId || !text) return;
  const entry = {
    senderName: String(senderName || '不明').slice(0, 50),
    text: String(text).slice(0, 500),
    timestamp: Date.now(),
  };
  if (userId) entry.userId = userId;
  await getDb().ref(`${CONVERSATION_ROOT}/${sourceId}/messages`).push(entry);
}

async function getRecentConversation(sourceId, limit = 100) {
  if (!sourceId) return [];
  const snap = await getDb()
    .ref(`${CONVERSATION_ROOT}/${sourceId}/messages`)
    .orderByChild('timestamp')
    .limitToLast(limit)
    .once('value');
  const raw = snap.val();
  if (!raw) return [];
  return Object.values(raw).sort((a, b) => a.timestamp - b.timestamp);
}

/* matchResults に保存 */
async function saveResult(pending) {
  const { year, month, away, home, awayScore, homeScore, awayPK, homePK, date, addedBy } = pending;
  const ref = getDb().ref(`matchResults/${year}/${month}`);
  const entry = {
    date, away, home,
    awayScore, homeScore,
    addedBy: addedBy || 'LINE bot',
    addedAt: admin.database.ServerValue.TIMESTAMP,
  };
  if (awayPK != null && homePK != null) {
    entry.awayPK = awayPK;
    entry.homePK = homePK;
  }
  await ref.push(entry);
}

// ── ノブレス案件ログ ──────────────────────────────────────────────────────────
async function incrementNoblesseCaseCounter(dateStr) {
  const ref = getDb().ref(`meta/noblesse/counter/${dateStr}`);
  const result = await ref.transaction(n => (n || 0) + 1);
  return String(result.snapshot.val()).padStart(3, '0');
}

async function saveNoblesseCase(caseId, data) {
  await getDb().ref(`noblesse/cases/${caseId}`).set({
    ...data,
    caseId,
    updatedAt: admin.database.ServerValue.TIMESTAMP,
  });
}

async function getNoblesseCase(caseId) {
  const snap = await getDb().ref(`noblesse/cases/${caseId}`).once('value');
  return snap.val() || null;
}

// ── メンバープロファイル（LINE名→実名・人物メモ） ────────────────────────────
let _profilesCache = null;
let _profilesCacheTs = 0;
const PROFILES_CACHE_TTL = 5 * 60 * 1000; // 5分

async function getMemberProfiles() {
  if (_profilesCache && Date.now() - _profilesCacheTs < PROFILES_CACHE_TTL) return _profilesCache;
  try {
    const snap = await getDb().ref('config/memberProfiles').once('value');
    _profilesCache = snap.val() || {};
    _profilesCacheTs = Date.now();
    return _profilesCache;
  } catch (err) {
    console.error('[firebase] getMemberProfiles failed', err?.message || err);
    return {};
  }
}

async function getMemberProfile(userId) {
  if (!userId) return null;
  const profiles = await getMemberProfiles();
  return profiles[userId] || null;
}

async function saveMemberProfile(userId, data) {
  if (!userId) return;
  try {
    await getDb().ref(`config/memberProfiles/${userId}`).update({
      ...data,
      updatedAt: new Date().toISOString().slice(0, 10),
    });
    _profilesCache = null; // キャッシュ破棄
  } catch (err) {
    console.error('[firebase] saveMemberProfile failed', err?.message || err);
  }
}

async function initMemberProfileStub(userId, lineName) {
  if (!userId || !lineName) return;
  const existing = await getMemberProfile(userId);
  if (existing) return;
  await saveMemberProfile(userId, { lineName, realName: '' });
  console.log(`[firebase] profile stub created: ${lineName} (${userId})`);
}

module.exports = {
  getPlayers,
  savePending,
  getPending,
  deletePending,
  getMonthResults,
  getYearResults,
  getMonthlyRule,
  getRestrictMonths,
  getMatchSchedule,
  getUicolleNews,
  getRecentDiaries,
  saveConversationMessage,
  getRecentConversation,
  checkFirebaseStatus,
  getGeoGameConfig,
  getGeoGame,
  saveGeoGame,
  saveGeoGameAnswer,
  finishGeoGame,
  reserveGeoGameStart,
  getGeoGameUsage,
  getGeoGameGeocodeCache,
  saveGeoGameGeocodeCache,
  getOcrAutomationState,
  setOcrAutoEnabled,
  saveScreenshotCandidate,
  updateScreenshotCandidate,
  getScreenshotCandidates,
  getAiChatGuardState,
  reserveAiChatRequest,
  recordAiChatUsage,
  disableAiChatForBillingRisk,
  saveResult,
  getMemberProfiles,
  getMemberProfile,
  saveMemberProfile,
  initMemberProfileStub,
  incrementNoblesseCaseCounter,
  saveNoblesseCase,
  getNoblesseCase,
};
