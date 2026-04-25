'use strict';

const { parseMatchResult } = require('./ocr-node');
const {
  getPlayers,
  savePending,
  saveResult,
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
  getOcrAutomationState,
  setOcrAutoEnabled,
  getBeastModeState,
  setBeastModeEnabled,
  saveLatestLocation,
  getLatestLocation,
  savePendingLocationRequest,
  getPendingLocationRequest,
  clearPendingLocationRequest,
  getWakeAlarm,
  setWakeAlarm,
  clearWakeAlarm,
  saveScreenshotCandidate,
  updateScreenshotCandidate,
  getScreenshotCandidates,
  getMemberProfile,
  getNoblesseCase,
  getNoblesseCases,
  getNoblesseCaseEvents,
  getNoblesseExecutions,
  initMemberProfileStub,
  saveEventReminder,
  getEventReminders,
  cancelEventReminders,
} = require('./firebase-admin');
const { resolveRealName, updateGroupProfiles, formatProfileForContext } = require('./member-profile');
const { searchRestaurants, extractRestaurantParams, isRestaurantRequest, buildRestaurantCarousel } = require('./hotpepper');
const { isHotelRequest, extractHotelParams, searchHotels, sortHotelsForConcierge, buildHotelCarousel } = require('./rakuten-travel');
const {
  isWeatherRequest,
  extractWeatherCity,
  fetchWeatherForCity,
  formatWeatherReply,
} = require('./weather');
const { isTransportRequest, isTaxiRequest, isFlightRequest, extractRouteParams, buildRouteFlex, buildTaxiFlex, buildFlightFlex } = require('./transport');
const { fetchYahooWeather, searchYahooLocalSpots, buildWeatherLine } = require('./yahoo-api');
const { buildConfirmFlex, buildCompleteFlex } = require('./flex-message');
const { getTokyoDateParts, shiftMonth } = require('./date-utils');
const { inspectImage, looksLikePhoneScreenshot, classifyOcrResult } = require('./image-guard');
const { enqueueImageOcr } = require('./image-ocr-queue');
const {
  calculateMonthlyStandings,
  calculateAnnualStandings,
  calculateMonthProgress,
  formatMonthlyStandings,
  formatAnnualStandings,
  formatSecretaryStatus,
  formatProgress,
  formatMissingMatchups,
} = require('./standings');
const { formatRuleReply } = require('./rule-message');
const { formatSecretaryHelp } = require('./help-message');
const { getSecretaryMentionInfo, getCasualReply, getCasualReplyWithContext, buildCasualQuickReply, getTiredReply } = require('./secretary-chat');
const { detectSystemStatusKind, safeFormatSystemStatusReply } = require('./system-status');
const { detectBillingRiskIntent, formatBillingRiskReply } = require('./billing-risk');
const { formatMemberFlavorReply, formatAnonymousDiaryHighlights } = require('./group-insights');
const { detectGeoGameIntent, handleGeoGameIntent } = require('./geo-game');
const { detectDiceGameIntent, formatDiceGameReply } = require('./dice-games');
const { detectOcrControlIntent } = require('./ocr-control');
const { detectBeastModeIntent, formatBeastModeReply, formatBeastModeLockedReply } = require('./beast-mode');
const { detectProjectGuideIntent, formatProjectGuideReply } = require('./project-guide');
const {
  detectConciergeIntent,
  formatPendingDecisionReply,
  buildArrangeStarterReply,
  handleConciergePostback,
} = require('./concierge');
const {
  formatAttributeGuide,
  formatRarityGuide,
  formatSenseGuide,
  formatFormationTips,
  formatMetaKnowledge,
  formatBeginnerTips,
  detectAttributeKeyword,
  detectSenseKeyword,
  detectUicolleIntent,
} = require('./uicolle-knowledge');
const { shouldUseAiChat, formatAiChatReply } = require('./ai-chat');
const { detectNoblesseIntent, formatNoblesseReply } = require('./noblesse-agent');
const {
  generateCaseId,
  createCase,
  approveCase,
  cancelCase,
  rememberSelectionCandidates,
  rememberPreparedSend,
  rememberBookingForm,
  rememberSearchIntake,
  rememberCuratedPlan,
  updateBookingForm,
  updateSearchIntake,
  updateCuratedPlan,
  getPreparedSend,
  getBookingForm,
  getSearchIntake,
  getCuratedPlan,
  getSelectionCandidate,
  logCaseEvent,
  buildApprovalFlex,
  buildExecutionReport,
  buildStatusText,
  buildSingleCaseText,
  extractSearchKeyword,
  parseOptions: parseCaseOptions,
} = require('./noblesse-case');
const {
  isMessageDraftRequest,
  isScheduleDraftRequest,
  buildMessageDraft,
  buildScheduleDraft,
  canSendDraftImmediately,
} = require('./noblesse-drafts');
const {
  buildPreparedSendFlex,
  buildDecisionActionFlex,
  buildDecisionShareText,
  buildSendTargetFlex,
  buildBookingReadyFlex,
} = require('./noblesse-execution');
const {
  planNoblesseExecution,
  markExecutionRunning,
  completeNoblesseExecution,
  failNoblesseExecution,
  formatExecutionBlockedReply,
} = require('./noblesse-planner');
const {
  createBookingForm,
  detectBookingCommand,
  getNextBookingField,
  isBookingFormComplete,
  buildBookingPrompt,
  buildBookingSummaryText,
  buildBookingShareText,
  applyBookingFieldInput,
} = require('./noblesse-booking');
const {
  detectOutingRequest,
  detectShoppingRequest,
  detectFoodQuickReplyCommand,
  detectCuratedPlanCommand,
  createCuratedPlanState,
  getNextCuratedField,
  buildCuratedPrompt,
  buildCuratedSummary,
  applyCuratedFieldInput,
  rankCuratedCandidates,
  buildCuratedCandidatesFlex,
  buildCuratedGuideText,
  buildCuratedItinerary,
  buildCuratedAdjustmentReply,
  buildCuratedRouteFlex,
  buildCuratedShareText,
} = require('./noblesse-curated');
const {
  createSearchIntake,
  isSearchKeywordUsable,
  buildSearchStrategyReply,
  getNextSearchField: getNextSearchIntakeField,
  isSearchIntakeComplete,
  buildSearchIntakePrompt,
  applySearchFieldInput,
  buildSearchExecutionParams,
  buildSearchIntakeSummary,
} = require('./noblesse-search-intake');
const {
  detectNearbyIntent,
  buildNearbyLocationPrompt,
  formatLocationStoredReply,
  findNearbyPlaces,
  formatNearbyReply,
} = require('./nearby-guide');
const {
  detectWakeAlarmIntent,
  formatWakeAlarmSetReply,
  formatWakeAlarmStatusReply,
  formatWakeAlarmCancelReply,
  formatWakeNewsModeReply,
  formatWakeNewsModeLabel,
  normalizeWakeNewsMode,
} = require('./wake-alarm');
const {
  buildWakeTimeChoiceMessage,
  buildReminderTimeChoiceMessage,
  buildWakeNewsChoiceMessage,
} = require('./time-choice');
const { isMorningAlarm } = require('./morning-briefing');
const {
  getResolvedPrivateProfile,
  buildPrivateProfileContextText,
  formatOwnPrivateProfileReply,
  buildProfileAwareHint,
  detectPrivateProfileIntent,
  extractPrivateProfileUpdate,
  savePrivateProfileUpdate,
} = require('./private-profile');
const {
  detectLocationStoryIntent,
  buildLocationStoryPrompt,
  generateLocationStoryMessages,
} = require('./location-story');
const {
  detectReminderIntent,
  detectReminderSuggestionIntent,
  detectNoblesseReminderHint,
  buildNoblesseReminderProposal,
  formatReminderSetReply,
  formatReminderListReply,
  formatReminderCancelReply,
  formatReminderPushText,
  formatReminderMissingTimeReply,
  inferReminderHintFromConversation,
} = require('./event-reminder');

const DEFAULT_BATCH_OCR_MAX_IMAGES = 20;
const BATCH_PROCESSING_STALE_MS = 10 * 60 * 1000;

async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=ja&zoom=14`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'TraperSubot/1.0 (LINE Bot)' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.address || {};
    return (
      a.neighbourhood || a.suburb || a.quarter ||
      a.village || a.town || a.city_district ||
      a.city || a.county ||
      (data.display_name || '').split(',')[0].trim() || null
    );
  } catch {
    return null;
  }
}

async function handle(event, client) {
  /* ── 画像メッセージ → OCR → 確認FlexMessage ── */
  if (event.type === 'message' && event.message.type === 'image') {
    return handleImage(event, client);
  }

  if (event.type === 'message' && event.message.type === 'location') {
    return handleLocation(event, client);
  }

  if (event.type === 'message' && event.message.type === 'text') {
    return handleText(event, client);
  }

  /* ── Postback（OK / キャンセル） ── */
  if (event.type === 'postback') {
    return handlePostback(event, client);
  }
}

async function handleLocation(event, client) {
  const sourceId = event.source.groupId || event.source.roomId || event.source.userId || 'unknown';
  const userId = event.source?.userId || 'shared';
  const senderName = await getSenderName(event, client, '不明');
  const rawLocation = event.message || {};
  const locationPayload = await saveLatestLocation(sourceId, userId, {
    sourceId,
    userId,
    senderName,
    title: rawLocation.title || '',
    address: rawLocation.address || '',
    label: rawLocation.title || rawLocation.address || '',
    latitude: Number(rawLocation.latitude),
    longitude: Number(rawLocation.longitude),
    lastRequestedAt: Date.now(),
  });

  const pendingRequest = await getPendingLocationRequest(sourceId, userId);
  if (pendingRequest?.type === 'locationStory' && Number.isFinite(locationPayload?.latitude) && Number.isFinite(locationPayload?.longitude)) {
    await clearPendingLocationRequest(sourceId, userId).catch(() => {});
    const privateProfile = await getResolvedPrivateProfile({
      userId,
      lineName: event.source?.userId ? null : senderName,
      realName: senderName,
    }).catch(() => null);
    const messages = await generateLocationStoryMessages({
      latitude: locationPayload.latitude,
      longitude: locationPayload.longitude,
      label: locationPayload.label,
      profile: privateProfile,
    });
    return client.replyMessage(event.replyToken, messages);
  }

  if (pendingRequest?.type === 'noblesse:curated' && pendingRequest?.caseId && Number.isFinite(locationPayload?.latitude) && Number.isFinite(locationPayload?.longitude)) {
    await clearPendingLocationRequest(sourceId, userId).catch(() => {});
    const areaName = await reverseGeocode(locationPayload.latitude, locationPayload.longitude);
    const originLabel = areaName || locationPayload.label || `${locationPayload.latitude.toFixed(4)}, ${locationPayload.longitude.toFixed(4)}`;
    const caseData = await getNoblesseCase(pendingRequest.caseId).catch(() => null);
    const plan = getCuratedPlan(caseData);
    if (!caseData || !plan) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '案件が見つからなかったの。もう一度ノブレスで相談を始めてみてね。',
      });
    }
    return handleCuratedFieldUpdate({
      client,
      event,
      sourceId,
      caseId: pendingRequest.caseId,
      caseData,
      plan,
      actorName: senderName,
      userId,
      rawValue: originLabel,
      locationCoords: { lat: locationPayload.latitude, lon: locationPayload.longitude },
    });
  }

  if (pendingRequest?.category && Number.isFinite(locationPayload?.latitude) && Number.isFinite(locationPayload?.longitude)) {
    await clearPendingLocationRequest(sourceId, userId).catch(() => {});
    const result = await findNearbyPlaces({
      latitude: locationPayload.latitude,
      longitude: locationPayload.longitude,
      category: pendingRequest.category,
    });
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: formatNearbyReply(result),
    });
  }

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: formatLocationStoredReply(locationPayload),
  });
}

async function handleImage(event, client) {
  const msgId = event.message.id;
  const sourceId = event.source.groupId || event.source.roomId || event.source.userId || 'unknown';
  const eventTime = event.timestamp ? new Date(event.timestamp) : new Date();
  const eventDate = getTokyoDateParts(eventTime);
  console.log(`[webhook] image received msgId=${msgId}`);

  /* LINE Content API から画像バイナリを取得 */
  const stream  = await client.getMessageContent(msgId);
  const buffer  = await streamToBuffer(stream);

  let imageProfile;
  try {
    imageProfile = await inspectImage(buffer);
  } catch (err) {
    console.log(`[webhook] ignored unreadable image msgId=${msgId}`);
    return;
  }
  if (!looksLikePhoneScreenshot(imageProfile)) {
    console.log(`[webhook] ignored non-screenshot image msgId=${msgId} ${imageProfile.width}x${imageProfile.height}`);
    return;
  }

  const ocrState = await getOcrAutomationState(sourceId);
  if (!ocrState.autoEnabled) {
    const senderName = await getSenderName(event, client, '不明');
    await saveScreenshotCandidate(sourceId, eventDate.date, msgId, {
      sourceId,
      userId: event.source?.userId || null,
      senderName,
      createdAt: event.timestamp || Date.now(),
      createdAtIso: eventTime.toISOString(),
      width: imageProfile.width,
      height: imageProfile.height,
      ratio: imageProfile.ratio,
      status: 'queued',
    });
    console.log(`[webhook] auto OCR disabled; queued screenshot msgId=${msgId} sourceId=${sourceId} date=${eventDate.date}`);
    return;
  }

  /* 送信者の表示名を取得（addedBy用） */
  const senderName = await getSenderName(event, client, '(LINE bot)');
  const outcome = await processImageBufferForOcr(buffer, msgId, senderName);
  if (outcome.message) return sendImageResponse(event, client, outcome.message);
}

async function processImageBufferForOcr(buffer, msgId, senderName) {
  /* プレイヤーマップを Firebase から取得 */
  const players   = await getPlayers();
  console.log(`[webhook] players count=${Array.isArray(players) ? players.length : Object.keys(players||{}).length} type=${Array.isArray(players)?'array':typeof players}`);
  const playerMap = {};
  (Array.isArray(players) ? players : Object.values(players || {})).forEach(p => {
    if (p?.charName) playerMap[p.charName] = p.name;
  });

  /* OCR */
  let ocrResult;
  try {
    const queued = await enqueueImageOcr(() => parseMatchResult(buffer, playerMap), msgId);
    if (queued.skipped) return { status: 'skipped' };
    ocrResult = queued.value;
  } catch (err) {
    console.error('[webhook] OCR failed', err);
    return {
      status: 'failed',
      error: err?.message || String(err),
      message: {
        type: 'text',
        text: 'ごめんね、うまく読み取れなかったの。\nあなたの試合、ちゃんと受け取りたかったから少し悔しいな。\nアプリから入れてくれたら、私が大事に預かるね。\nhttps://naotaxy.github.io/winning-roulette/',
      },
    };
  }

  const ocrClass = classifyOcrResult(ocrResult);
  if (!ocrClass.isMaybeMatch) {
    console.log(`[webhook] ignored non-uicolle image msgId=${msgId} scores=${ocrClass.hasScores} matchedTeams=${ocrClass.matchedTeams}`);
    return { status: 'ignored', ocrClass };
  }
  if (!ocrClass.isCompleteMatch) {
    console.log(`[webhook] uicolle-like image incomplete msgId=${msgId} scores=${ocrClass.hasScores} matchedTeams=${ocrClass.matchedTeams}`);
    return {
      status: 'incomplete',
      ocrClass,
      message: {
        type: 'text',
        text: '試合結果っぽいところまでは見えたんだけど、チーム名かスコアを片方見失っちゃった。\nもう一回送って。次はちゃんと見つけたいの。',
      },
    };
  }

  /* 保留データを Firebase に保存 */
  const now = new Date();
  const today = getTokyoDateParts(now);
  const pending = {
    ...ocrResult,
    away:     ocrResult.awayChar?.playerName || null,
    home:     ocrResult.homeChar?.playerName || null,
    addedBy:  senderName,
    year:     today.year,
    month:    today.month,
    date:     today.date,
    savedAt:  now.toISOString(),
  };
  await savePending(msgId, pending);

  /* 確認FlexMessageを送信 */
  const flex = buildConfirmFlex(ocrResult, msgId);
  return { status: 'complete', ocrClass, ocrResult, pending, message: flex };
}

async function sendImageResponse(event, client, message) {
  const to = event.source.groupId || event.source.roomId || event.source.userId;
  if (to && typeof client.pushMessage === 'function') {
    try {
      return await client.pushMessage(to, message);
    } catch (err) {
      console.error('[webhook] image push failed', err);
    }
  }
  return client.replyMessage(event.replyToken, message);
}

async function getSenderName(event, client, fallback = null) {
  const userId = event.source?.userId;
  if (!userId) return fallback;

  const lineName = await withTimeout((async () => {
    let profile;
    if (event.source.groupId && typeof client.getGroupMemberProfile === 'function') {
      profile = await client.getGroupMemberProfile(event.source.groupId, userId);
    } else if (event.source.roomId && typeof client.getRoomMemberProfile === 'function') {
      profile = await client.getRoomMemberProfile(event.source.roomId, userId);
    } else {
      profile = await client.getProfile(userId);
    }
    return profile?.displayName || fallback;
  })(), 900, fallback).catch(async () => {
    try {
      const profile = await client.getProfile(userId);
      return profile?.displayName || fallback;
    } catch (_) {
      return fallback;
    }
  });

  // Firebase にスタブがなければ自動作成（fire-and-forget）
  if (lineName && lineName !== fallback) {
    initMemberProfileStub(userId, lineName).catch(() => {});
  }
  // Firebase に実名登録があれば優先する
  return resolveRealName(userId, lineName);
}

function withTimeout(promise, timeoutMs, fallback) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

function isDirectChatSource(source = {}) {
  return !!source.userId && !source.groupId && !source.roomId;
}

function buildEffectiveSecretaryText(text, allowBareCall, alreadyMentioned) {
  if (!allowBareCall || alreadyMentioned) return text;
  const normalized = String(text || '').trim();
  if (!normalized) return text;
  return `@秘書トラペル子 ${normalized}`;
}

async function handleText(event, client) {
  const text = event.message.text || '';
  const sourceId = event.source.groupId || event.source.roomId || event.source.userId || 'unknown';
  const isDirectChat = isDirectChatSource(event.source);
  const userId = event.source?.userId || null;
  const senderName = await getSenderName(event, client, null);

  // 全メッセージを会話メモリに保存（userId付き）
  saveConversationMessage(sourceId, senderName, text, userId).catch(() => {});

  const profileUpdateBody = isDirectChat ? extractPrivateProfileUpdate(text) : null;
  if (profileUpdateBody && userId) {
    const updatedProfile = await savePrivateProfileUpdate({
      userId,
      realName: senderName || '',
      rawText: profileUpdateBody,
    });
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: updatedProfile
        ? [
          'うん、本人用のプロファイルとして預かったよ。',
          'これからはこのメモを前提に、好みや生活リズムを少し察して返すね。',
          formatOwnPrivateProfileReply(updatedProfile),
        ].join('\n\n')
        : 'ごめん、今はプロフィール更新の保存でつまずいちゃった。少し時間を置いてもう一回送ってね。',
    });
  }

  const rawMentionInfo = getSecretaryMentionInfo(text);
  const effectiveText = buildEffectiveSecretaryText(text, isDirectChat, rawMentionInfo.mentioned);
  const mentionInfo = getSecretaryMentionInfo(effectiveText);

  if (!rawMentionInfo.mentioned) {
    const curatedAwaitingReply = await maybeHandleCuratedAwaitingInput({
      event,
      client,
      sourceId,
      userId,
      senderName,
      text,
    });
    if (curatedAwaitingReply) return curatedAwaitingReply;

    const searchAwaitingReply = await maybeHandleSearchIntakeAwaitingInput({
      event,
      client,
      sourceId,
      userId,
      senderName,
      text,
    });
    if (searchAwaitingReply) return searchAwaitingReply;

    const bookingAwaitingReply = await maybeHandleBookingAwaitingInput({
      event,
      client,
      sourceId,
      userId,
      senderName,
      text,
    });
    if (bookingAwaitingReply) return bookingAwaitingReply;
  }

  const intent = detectTextIntent(effectiveText, { allowBareHelp: isDirectChat });
  if (!intent) return;

  // グループ全員のプロファイリング（全intent共通、fire-and-forget）
  if (sourceId && sourceId !== 'unknown') {
    getRecentConversation(sourceId, 30)
      .then(msgs => updateGroupProfiles(msgs))
      .catch(() => {});
  }

  const { year, month } = getTokyoDateParts();

  if (intent === 'help') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: formatSecretaryHelp(),
    });
  }

  if (intent === 'summary') {
    const messages = await getRecentConversation(sourceId, 100);
    if (!messages.length) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'まだ会話の記録がないみたい。これからしっかり覚えておくね。',
      });
    }
    const conversationLog = messages.map(m => `${m.senderName}: ${m.text}`).join('\n');
    const summaryPrompt = `このグループの直近${messages.length}件の会話を、秘書として自然に3〜5文でまとめてください:\n\n${conversationLog}`;
    const aiReply = shouldUseAiChat()
      ? await formatAiChatReply(summaryPrompt, { year, month, senderName })
      : null;
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: aiReply || `直近${messages.length}件の会話はちゃんと覚えてるよ。要約にはAI機能が必要だけど、記録はしてある。`,
    });
  }

  if (intent?.type === 'geoGame') {
    try {
      return await handleGeoGameIntent({ event, client, sourceId, senderName, intent });
    } catch (err) {
      console.error('[webhook] geo game failed', err);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'ジオゲームでつまずいちゃった。\nでも無視したわけじゃないよ。今のエラーは記録したから、少し直してまた呼んでね。',
      });
    }
  }

  if (intent?.type === 'diceGame') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: formatDiceGameReply(intent, senderName),
    });
  }

  if (intent?.type === 'ocrControl') {
    return handleOcrControlIntent({ event, client, sourceId, senderName, intent });
  }

  if (intent?.type === 'beastMode') {
    if (intent.action === 'status') {
      const state = await getBeastModeState(sourceId);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: formatBeastModeReply(state.enabled, 'status'),
      });
    }

    if (intent.action === 'disable') {
      await setBeastModeEnabled(sourceId, false, senderName);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: formatBeastModeReply(false, 'disable'),
      });
    }

    const previous = await getBeastModeState(sourceId);
    await setBeastModeEnabled(sourceId, true, senderName);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: formatBeastModeReply(previous.enabled, 'enable'),
    });
  }

  if (intent?.type === 'concierge') {
    if (intent.action === 'pending') {
      const messages = await getRecentConversation(sourceId, 120);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: formatPendingDecisionReply(messages),
      });
    }
    return client.replyMessage(event.replyToken, buildArrangeStarterReply(intent.scenario || null));
  }

  if (intent === 'projectGuide') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: formatProjectGuideReply(),
    });
  }

  if (intent?.type === 'privateProfile') {
    if (intent.action === 'guard') {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '本人用のプロファイルは、本人との会話にだけ使うよ。ほかの人に聞かれても出さないの。そこはちゃんと守るね。',
      });
    }
    if (!isDirectChat) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '本人用のプロファイル確認は1対1でだけ見せるね。グループでは出さないようにしてるの。',
      });
    }
    const privateProfile = await getResolvedPrivateProfile({ userId, realName: senderName });
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: formatOwnPrivateProfileReply(privateProfile),
    });
  }

  if (intent === 'weather') {
    const city = extractWeatherCity(mentionInfo.withoutMention) || '東京';
    const result = await fetchWeatherForCity(city);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: formatWeatherReply(result, city),
    });
  }

  if (intent === 'transport') {
    if (isTaxiRequest(mentionInfo.withoutMention)) {
      const { from, to } = extractRouteParams(mentionInfo.withoutMention);
      return client.replyMessage(event.replyToken, buildTaxiFlex(from, to));
    }
    if (isFlightRequest(mentionInfo.withoutMention)) {
      const { from, to } = extractRouteParams(mentionInfo.withoutMention);
      return client.replyMessage(event.replyToken, buildFlightFlex(from, to));
    }
    // 電車・経路検索
    const { from, to } = extractRouteParams(mentionInfo.withoutMention);
    if (!from || !to) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '出発地と目的地を教えてくれる？\n例:「新宿から渋谷の行き方は？」',
      });
    }
    return client.replyMessage(event.replyToken, buildRouteFlex(from, to));
  }

  if (intent?.type === 'locationStory') {
    const latestLocation = await getLatestLocation(sourceId, userId);
    if (!latestLocation?.latitude || !latestLocation?.longitude) {
      await savePendingLocationRequest(sourceId, userId, {
        type: 'locationStory',
        text: mentionInfo.withoutMention,
      }).catch(() => {});
      return client.replyMessage(event.replyToken, buildLocationStoryPrompt(!!latestLocation));
    }

    const privateProfile = await getResolvedPrivateProfile({ userId, realName: senderName }).catch(() => null);
    const messages = await generateLocationStoryMessages({
      latitude: Number(latestLocation.latitude),
      longitude: Number(latestLocation.longitude),
      label: latestLocation.label || latestLocation.address || '',
      profile: privateProfile,
    });
    return client.replyMessage(event.replyToken, messages);
  }

  if (intent?.type === 'nearby') {
    const latestLocation = await getLatestLocation(sourceId, userId);
    if (!latestLocation?.latitude || !latestLocation?.longitude) {
      await savePendingLocationRequest(sourceId, userId, {
        category: intent.category,
        label: intent.label,
        text: mentionInfo.withoutMention,
      }).catch(() => {});
      return client.replyMessage(event.replyToken, buildNearbyLocationPrompt(intent, latestLocation));
    }

    const result = await findNearbyPlaces({
      latitude: Number(latestLocation.latitude),
      longitude: Number(latestLocation.longitude),
      category: intent.category,
    });
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: formatNearbyReply(result),
    });
  }

  if (intent?.type === 'wakeAlarm') {
    if (!isDirectChat) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '起こす約束は1対1のトークでやらせてね。グループだと朝からみんなを起こしちゃうから、個人トークで時間を言ってくれたら私が迎えに行くよ。',
      });
    }

    if (intent.action === 'status') {
      const alarm = await getWakeAlarm(sourceId);
      if (!alarm) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: formatWakeAlarmStatusReply(alarm),
        });
      }
      const messages = [{
        type: 'text',
        text: formatWakeAlarmStatusReply(alarm),
      }];
      if (isMorningAlarm(alarm)) {
        messages.push(buildWakeNewsChoiceMessage(alarm));
      }
      return client.replyMessage(event.replyToken, messages);
    }

    if (intent.action === 'cancel') {
      const alarm = await getWakeAlarm(sourceId);
      await clearWakeAlarm(sourceId);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: formatWakeAlarmCancelReply(alarm),
      });
    }

    if (intent.action === 'missingTime') {
      return client.replyMessage(event.replyToken, buildWakeTimeChoiceMessage(intent));
    }

    if (intent.action === 'timeBranch') {
      return client.replyMessage(event.replyToken, buildWakeTimeChoiceMessage(intent));
    }

    if (intent.action === 'newsChoice' || intent.action === 'newsStatus') {
      const alarm = await getWakeAlarm(sourceId);
      if (!alarm) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: 'まだ起床セットが入っていないみたい。先に「平日毎朝6時半に起こして」みたいに時間を決めてくれたら、そのあとニュースの持ち方を選べるよ。',
        });
      }
      return client.replyMessage(event.replyToken, [
        {
          type: 'text',
          text: `今の朝ニュースは「${formatWakeNewsModeLabel(alarm.newsMode)}」だよ。`,
        },
        buildWakeNewsChoiceMessage(alarm),
      ]);
    }

    if (intent.action === 'setNewsMode') {
      const currentAlarm = await getWakeAlarm(sourceId);
      if (!currentAlarm) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: 'まだ起床セットが入っていないみたい。先に「平日毎朝6時半に起こして」みたいに時間を決めてくれたら、そのあとニュースの持ち方を選べるよ。',
        });
      }
      const alarm = await setWakeAlarm(sourceId, {
        ...currentAlarm,
        newsMode: normalizeWakeNewsMode(intent.newsMode),
      });
      return client.replyMessage(event.replyToken, [
        {
          type: 'text',
          text: formatWakeNewsModeReply(alarm.newsMode, senderName),
        },
        buildWakeNewsChoiceMessage(alarm),
      ]);
    }

    if (intent.action === 'invalidTime') {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '時間の読み取りがうまくいかなかったの。\n0時〜23時の形で、もう一回だけ教えてね。',
      });
    }

    const currentAlarm = await getWakeAlarm(sourceId).catch(() => null);
    const latestLocation = await getLatestLocation(sourceId, userId);
    const privateProfile = await getResolvedPrivateProfile({ userId, realName: senderName }).catch(() => null);
    const weatherPlace = latestLocation?.label
      || latestLocation?.address
      || privateProfile?.defaultWakePlace
      || '東京';
    const alarm = await setWakeAlarm(sourceId, {
      sourceId,
      userId,
      senderName,
      hour: intent.hour,
      minute: intent.minute,
      dueAt: intent.dueAt,
      recurring: intent.recurring === true,
      weekdayOnly: intent.weekdayOnly === true,
      newsMode: normalizeWakeNewsMode(currentAlarm?.newsMode),
      weatherPlace,
      weatherLatitude: Number.isFinite(Number(latestLocation?.latitude)) ? Number(latestLocation.latitude) : null,
      weatherLongitude: Number.isFinite(Number(latestLocation?.longitude)) ? Number(latestLocation.longitude) : null,
      status: 'active',
      createdAt: Date.now(),
      createdAtIso: new Date().toISOString(),
    });
    const confirmQuickReply = {
      items: [
        { type: 'action', action: { type: 'message', label: '設定確認', text: '起床状態' } },
        { type: 'action', action: { type: 'message', label: 'キャンセル', text: '起こすのやめて' } },
      ],
    };
    const setTextMsg = { type: 'text', text: formatWakeAlarmSetReply(alarm, senderName), quickReply: confirmQuickReply };
    const messages = [setTextMsg];
    if (isMorningAlarm(alarm)) {
      messages.push(buildWakeNewsChoiceMessage(alarm));
    }
    return client.replyMessage(event.replyToken, messages);
  }

  if (intent?.type === 'eventReminder') {
    return handleEventReminderIntent({ event, client, sourceId, userId, senderName, intent });
  }

  if (intent?.type === 'eventReminderSuggest') {
    return client.replyMessage(event.replyToken, buildNoblesseReminderPrompt(intent.proposal, { context: 'manager' }));
  }

  if (intent === 'noblesse:status') {
    const beastMode = await getBeastModeState(sourceId);
    if (!beastMode.enabled) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: formatBeastModeLockedReply(),
      });
    }
    const caseIdMatch = mentionInfo.withoutMention.match(/NB-\d{8}-\d+/);
    if (caseIdMatch) {
      const [caseData, caseEvents, caseExecutions] = await Promise.all([
        getNoblesseCase(caseIdMatch[0]),
        getNoblesseCaseEvents(caseIdMatch[0], 8),
        getNoblesseExecutions(caseIdMatch[0], 6),
      ]);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: buildSingleCaseText(caseIdMatch[0], caseData, caseEvents, caseExecutions),
      });
    }
    const cases = await getNoblesseCases(sourceId, 5);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: buildStatusText(cases),
    });
  }

  if (intent === 'noblesse') {
    const beastMode = await getBeastModeState(sourceId);
    if (!beastMode.enabled) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: formatBeastModeLockedReply(),
      });
    }
    const { date: dateStr } = getTokyoDateParts();

    const [analysis, caseId] = await Promise.all([
      formatNoblesseReply(mentionInfo.withoutMention, senderName),
      generateCaseId(dateStr),
    ]);

    // 案件をFirebaseに保存（fire-and-forget）
    createCase({ caseId, userId, sourceId, senderName, request: mentionInfo.withoutMention, analysis }).catch(() => {});

    // ウイコレ集合系なら、リマインダー提案をサジェストする
    const remHint = detectNoblesseReminderHint(mentionInfo.withoutMention);
    if (remHint) {
      const proposal = buildNoblesseReminderProposal(mentionInfo.withoutMention);
      const reminderPrompt = buildNoblesseReminderPrompt(proposal);
      return client.replyMessage(event.replyToken, [
        { type: 'text', text: analysis },
        reminderPrompt,
      ]);
    }

    return sendNoblesseReply(client, event, caseId, analysis, mentionInfo.withoutMention, sourceId);
  }

  if (intent?.type === 'booking') {
    const beastMode = await getBeastModeState(sourceId);
    if (!beastMode.enabled) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: formatBeastModeLockedReply(),
      });
    }
    return handleBookingTextIntent({ event, client, sourceId, userId, senderName, intent });
  }

  if (intent?.type === 'curatedPlan' && intent?.action === 'start') {
    const beastMode = await getBeastModeState(sourceId);
    if (!beastMode.enabled) {
      const caller = senderName ? `${senderName}、` : '';
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `${caller}おでかけ秘書で動くね。\nただ今はマネージャーモードがOFFなの。先にONにしてくれると候補を出せるよ。`,
        quickReply: {
          items: [
            { type: 'action', action: { type: 'message', label: 'モードON', text: 'マネージャーモードON' } },
          ],
        },
      });
    }
    const { date: dateStr } = getTokyoDateParts();
    const caseId = await generateCaseId(dateStr);
    const kindLabel = intent.kind === 'shopping' ? '買い物' : 'おでかけ';
    await createCase({
      caseId,
      userId: userId || '',
      sourceId: sourceId || '',
      senderName: senderName || '',
      request: intent.text || `${kindLabel}したい`,
      analysis: `${kindLabel}秘書（casual chat）`,
    });
    const plan = createCuratedPlanState({
      kind: intent.kind,
      requestText: intent.text || `${kindLabel}したい`,
      actorName: senderName || '',
      ownerUserId: userId,
    });
    await rememberCuratedPlan(caseId, plan);
    await logCaseEvent(caseId, 'curated_plan_started', { actorName: senderName || '', kind: intent.kind });
    return continueCuratedPlanOrRun({ client, event, sourceId, actorName: senderName || '', caseId, plan });
  }

  if (intent?.type === 'curatedPlan') {
    const beastMode = await getBeastModeState(sourceId);
    if (!beastMode.enabled) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: formatBeastModeLockedReply(),
      });
    }
    return handleCuratedPlanTextIntent({ event, client, sourceId, userId, senderName, intent });
  }

  if (intent?.type === 'restaurant') {
    return handleDirectRestaurantSearch({
      client, event, sourceId, userId, senderName,
      text: intent.text || mentionInfo.withoutMention,
      route: intent.route || '',
    });
  }

  if (intent === 'casual') {
    const aiEnabled = shouldUseAiChat();
    const [recentConversation, privateProfile] = await Promise.all([
      sourceId ? getRecentConversation(sourceId, 15) : Promise.resolve([]),
      getResolvedPrivateProfile({ userId, realName: senderName }).catch(() => null),
    ]);
    const profileHint = buildProfileAwareHint(mentionInfo.withoutMention, privateProfile);

    const aiReply = aiEnabled
      ? await formatAiChatReply(effectiveText, await buildAiConversationContext(year, month, senderName, sourceId, userId))
      : null;
    let replyText;
    if (aiReply) {
      replyText = aiReply;
    } else if (aiEnabled) {
      replyText = getTiredReply();
    } else {
      replyText = getCasualReplyWithContext(effectiveText, recentConversation, senderName, profileHint);
    }
    return sendCasualReply(client, event, {
      text: replyText,
      quickReply: buildCasualQuickReply(effectiveText),
    }, sourceId);
  }

  if (intent.startsWith('system:')) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: await safeFormatSystemStatusReply(intent.replace('system:', '')),
    });
  }

  if (intent === 'billing') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: await formatBillingRiskReply(),
    });
  }

  if (intent?.startsWith('uicolle:')) {
    const kind = intent.replace('uicolle:', '');
    let text;
    if (kind === 'news') {
      const news = await getUicolleNews();
      text = news
        ? `最新情報、登録されてたよ。\n\n${news.event ? `【イベント】\n${news.event}` : ''}${news.gacha ? `\n\n【ガチャ・スカウト】\n${news.gacha}` : ''}${news.updatedAt ? `\n\n（更新: ${news.updatedAt}）` : ''}`
        : 'ごめん、今のところ最新情報が登録されてないみたい。\n管理者が Firebase の config/uicolleNews に書き込んでくれれば、すぐ伝えられるよ。';
    } else if (kind === 'sense') {
      const senseKind = detectSenseKeyword(event.message.text || '');
      text = formatSenseGuide(senseKind);
    } else if (kind === 'attribute') {
      const attr = detectAttributeKeyword(event.message.text || '');
      text = formatAttributeGuide(attr);
    } else if (kind === 'rarity') {
      text = formatRarityGuide();
    } else if (kind === 'formation') {
      text = formatFormationTips();
    } else if (kind === 'beginner') {
      text = formatBeginnerTips();
    } else {
      text = formatMetaKnowledge();
    }
    return client.replyMessage(event.replyToken, { type: 'text', text });
  }

  if (intent === 'diary') {
    const diaries = await getRecentDiaries(3);
    if (!diaries.length) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'まだ日記が書けてないみたい。毎朝7時に書くようにしてるから、しばらく待っててね。',
      });
    }
    const latest = diaries[0];
    const preview = latest.text?.slice(0, 200) || '（本文取得できなかった）';
    const hasMore = (latest.text?.length || 0) > 200;
    const lines = [
      `${latest.date} の日記だよ。読んでくれるの、うれしい。`,
      latest.blogUrl ? `\n${latest.blogUrl}` : '',
      '',
      preview + (hasMore ? '…' : ''),
    ].filter(Boolean);
    return client.replyMessage(event.replyToken, { type: 'text', text: lines.join('\n') });
  }

  if (intent === 'nextRule' || intent === 'currentRule') {
    const target = intent === 'nextRule' ? shiftMonth(year, month, 1) : { year, month };
    const [rule, restrictMonths] = await Promise.all([
      getMonthlyRule(target.year, target.month),
      getRestrictMonths(),
    ]);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: formatRuleReply({
        year: target.year,
        month: target.month,
        rule,
        isRestrictMonth: restrictMonths.includes(target.month),
        label: intent === 'nextRule' ? `来月（${target.year}年${target.month}月）` : `今月（${target.year}年${target.month}月）`,
      }),
    });
  }

  const players = await getPlayers();

  if (intent === 'memberFlavor') {
    const [monthResults, recentConversation] = await Promise.all([
      getMonthResults(year, month),
      sourceId ? getRecentConversation(sourceId, 200) : Promise.resolve([]),
    ]);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: formatMemberFlavorReply({ year, month, players, results: monthResults, recentConversation }),
    });
  }

  if (intent === 'monthlyHighlights') {
    const [monthResults, diaries] = await Promise.all([
      getMonthResults(year, month),
      getRecentDiaries(35),
    ]);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: formatAnonymousDiaryHighlights({ year, month, players, results: monthResults, diaries }),
    });
  }

  if (intent === 'annual') {
    const yearResults = await getYearResults(year);
    const rows = calculateAnnualStandings(players, yearResults);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: formatAnnualStandings(year, rows),
    });
  }

  const monthResults = await getMonthResults(year, month);
  const monthlyRows = calculateMonthlyStandings(players, monthResults);

  if (intent === 'progress') {
    const matchSchedule = await getMatchSchedule();
    const progress = calculateMonthProgress(players, monthResults, matchSchedule);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: formatProgress(year, month, progress),
    });
  }

  if (intent === 'missingMatchups') {
    const matchSchedule = await getMatchSchedule();
    const progress = calculateMonthProgress(players, monthResults, matchSchedule);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: formatMissingMatchups(year, month, progress),
    });
  }

  if (intent === 'monthly') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: formatMonthlyStandings(year, month, monthlyRows),
    });
  }

  const yearResults = await getYearResults(year);
  const annualRows = calculateAnnualStandings(players, yearResults);
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: formatSecretaryStatus(year, month, monthlyRows, annualRows),
  });
}

async function handleOcrControlIntent({ event, client, sourceId, senderName, intent }) {
  const today = getTokyoDateParts();
  const maxImages = getBatchOcrMaxImages();

  if (intent.action === 'enable' || intent.action === 'disable') {
    const enabled = intent.action === 'enable';
    await setOcrAutoEnabled(sourceId, enabled, senderName);
    const text = enabled
      ? [
        'このグループの自動OCRをONに戻したよ。',
        'これからは端末スクショが来たら、今まで通り試合結果っぽいものをその場で確認に出すね。',
        'また静かにしたい時は「@秘書トラペル子 自動OCR OFF」って言って。',
      ].join('\n')
      : [
        'このグループの自動OCRをOFFにしたよ。',
        'これから上がる端末スクショは、私が静かに今日分として控えておくね。',
        '集計したくなったら「@秘書トラペル子 集計して」って呼んで。ちゃんと見に行くから。',
      ].join('\n');
    return client.replyMessage(event.replyToken, { type: 'text', text });
  }

  if (intent.action === 'status') {
    const [state, candidates] = await Promise.all([
      getOcrAutomationState(sourceId),
      getScreenshotCandidates(sourceId, today.date, 200),
    ]);
    const counts = countScreenshotCandidates(candidates);
    const pendingTotal = counts.queued + counts.failed + counts.processing;
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: [
        `このグループの自動OCR: ${state.autoEnabled ? 'ON' : 'OFF'}`,
        `今日控えてるスクショ候補: ${pendingTotal}枚`,
        counts.processing ? `今処理中: ${counts.processing}枚` : '',
        `今日すでに確認を出したもの: ${counts.complete}枚`,
        `見送り済み: ${counts.ignored + counts.incomplete}枚`,
        counts.failed ? `再試行待ち: ${counts.failed}枚` : '',
        state.updatedBy ? `最後に切り替えた人: ${state.updatedBy}` : '',
        counts.queued ? '一覧を見たい時は「@秘書トラペル子 OCR候補」で見せるね。' : '',
        '私は勝手に騒ぎすぎないように、ここはちゃんと気をつけるね。',
      ].filter(Boolean).join('\n'),
    });
  }

  if (intent.action === 'preview') {
    const [state, candidates] = await Promise.all([
      getOcrAutomationState(sourceId),
      getScreenshotCandidates(sourceId, today.date, 200),
    ]);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: formatScreenshotCandidatePreview(state, candidates),
    });
  }

  const allCandidates = await getScreenshotCandidates(sourceId, today.date, 200);
  const processable = allCandidates.filter(isProcessableScreenshotCandidate);
  if (!processable.length) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: [
        '今日このグループで控えてるスクショ候補はないみたい。',
        '自動OCR OFF中に上がった端末スクショだけ、あとから集計できるように控えてるよ。',
      ].join('\n'),
    });
  }

  const batch = processable.slice(0, maxImages);
  const remaining = processable.length - batch.length;
  processScreenshotBatch({ client, sourceId, dayKey: today.date, candidates: batch, remaining })
    .catch(err => console.error('[batch-ocr] failed', err));

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: [
      `今日のスクショ候補${batch.length}枚を集計し始めるね。`,
      remaining > 0 ? `無料運用で重くしすぎないよう、今回は先頭${batch.length}枚まで見るよ。残り${remaining}枚はもう一回「集計して」で続きから見るね。` : '',
      '読めた試合だけ確認ボタンを出すから、少しだけ待ってて。',
    ].filter(Boolean).join('\n'),
  });
}

async function processScreenshotBatch({ client, sourceId, dayKey, candidates, remaining = 0 }) {
  const summary = {
    total: candidates.length,
    complete: 0,
    ignored: 0,
    incomplete: 0,
    failed: 0,
    skipped: 0,
    remaining,
  };

  for (const candidate of candidates) {
    const msgId = candidate.messageId || candidate.id;
    await updateScreenshotCandidate(sourceId, dayKey, msgId, {
      status: 'processing',
      processingStartedAt: Date.now(),
    });

    let buffer;
    try {
      const stream = await client.getMessageContent(msgId);
      buffer = await streamToBuffer(stream);
    } catch (err) {
      summary.failed++;
      await updateScreenshotCandidate(sourceId, dayKey, msgId, {
        status: 'fetch_failed',
        error: trimBatchError(err?.message || err),
      });
      continue;
    }

    let imageProfile;
    try {
      imageProfile = await inspectImage(buffer);
    } catch (err) {
      summary.failed++;
      await updateScreenshotCandidate(sourceId, dayKey, msgId, {
        status: 'unreadable',
        error: trimBatchError(err?.message || err),
      });
      continue;
    }

    if (!looksLikePhoneScreenshot(imageProfile)) {
      summary.ignored++;
      await updateScreenshotCandidate(sourceId, dayKey, msgId, {
        status: 'ignored_non_screenshot',
        width: imageProfile.width,
        height: imageProfile.height,
        ratio: imageProfile.ratio,
      });
      continue;
    }

    let outcome;
    try {
      outcome = await processImageBufferForOcr(buffer, msgId, candidate.senderName || 'LINE bot');
    } catch (err) {
      summary.failed++;
      await updateScreenshotCandidate(sourceId, dayKey, msgId, {
        status: 'ocr_failed',
        error: trimBatchError(err?.message || err),
      });
      continue;
    }

    if (outcome.status === 'complete') {
      try {
        await client.pushMessage(sourceId, outcome.message);
        summary.complete++;
        await updateScreenshotCandidate(sourceId, dayKey, msgId, {
          status: 'complete',
          completedAt: Date.now(),
          away: outcome.pending?.away || null,
          home: outcome.pending?.home || null,
          awayScore: outcome.pending?.awayScore ?? null,
          homeScore: outcome.pending?.homeScore ?? null,
        });
      } catch (err) {
        summary.failed++;
        await updateScreenshotCandidate(sourceId, dayKey, msgId, {
          status: 'delivery_failed',
          error: trimBatchError(err?.message || err),
        });
      }
    } else if (outcome.status === 'ignored') {
      summary.ignored++;
      await updateScreenshotCandidate(sourceId, dayKey, msgId, {
        status: 'ignored_non_uicolle',
        ocrClass: outcome.ocrClass || null,
      });
    } else if (outcome.status === 'incomplete') {
      summary.incomplete++;
      await updateScreenshotCandidate(sourceId, dayKey, msgId, {
        status: 'incomplete',
        ocrClass: outcome.ocrClass || null,
      });
    } else if (outcome.status === 'skipped') {
      summary.skipped++;
      await updateScreenshotCandidate(sourceId, dayKey, msgId, { status: 'skipped_backlog' });
    } else {
      summary.failed++;
      await updateScreenshotCandidate(sourceId, dayKey, msgId, {
        status: 'ocr_failed',
        error: trimBatchError(outcome.error || 'OCR failed'),
      });
    }
  }

  return pushText(client, sourceId, formatBatchOcrSummary(summary));
}

function countScreenshotCandidates(candidates) {
  return candidates.reduce((acc, candidate) => {
    if (candidate.status === 'complete') acc.complete++;
    else if (candidate.status === 'ignored_non_uicolle' || candidate.status === 'ignored_non_screenshot') acc.ignored++;
    else if (candidate.status === 'incomplete') acc.incomplete++;
    else if (isActiveProcessingScreenshotCandidate(candidate)) acc.processing++;
    else if (isStaleProcessingScreenshotCandidate(candidate)) acc.failed++;
    else if (isRetryableScreenshotCandidate(candidate)) acc.failed++;
    else if (isQueueReadyScreenshotCandidate(candidate)) acc.queued++;
    return acc;
  }, { queued: 0, processing: 0, complete: 0, ignored: 0, incomplete: 0, failed: 0 });
}

function isProcessableScreenshotCandidate(candidate) {
  return isQueueReadyScreenshotCandidate(candidate) || isRetryableScreenshotCandidate(candidate) || isStaleProcessingScreenshotCandidate(candidate);
}

function isQueueReadyScreenshotCandidate(candidate) {
  return String(candidate?.status || 'queued') === 'queued';
}

function isRetryableScreenshotCandidate(candidate) {
  const status = String(candidate?.status || 'queued');
  return ['fetch_failed', 'ocr_failed', 'skipped_backlog', 'unreadable', 'delivery_failed'].includes(status);
}

function isActiveProcessingScreenshotCandidate(candidate) {
  const status = String(candidate?.status || 'queued');
  if (status !== 'processing') return false;
  const startedAt = Number(candidate.processingStartedAt) || 0;
  return !startedAt || Date.now() - startedAt <= BATCH_PROCESSING_STALE_MS;
}

function isStaleProcessingScreenshotCandidate(candidate) {
  const status = String(candidate?.status || 'queued');
  if (status !== 'processing') return false;
  const startedAt = Number(candidate.processingStartedAt) || 0;
  return startedAt > 0 && Date.now() - startedAt > BATCH_PROCESSING_STALE_MS;
}

function formatScreenshotCandidatePreview(state, candidates) {
  const counts = countScreenshotCandidates(candidates);
  const previewItems = candidates.filter(candidate =>
    isQueueReadyScreenshotCandidate(candidate)
    || isRetryableScreenshotCandidate(candidate)
    || isActiveProcessingScreenshotCandidate(candidate)
    || isStaleProcessingScreenshotCandidate(candidate)
  );

  if (!previewItems.length) {
    return [
      '今日見せられるOCR候補はまだないみたい。',
      `このグループの自動OCRは今 ${state.autoEnabled ? 'ON' : 'OFF'}。`,
      state.autoEnabled
        ? '今は自動でその場判定する方だから、候補一覧は溜まりにくいよ。'
        : 'OFF中に上がった端末スクショだけ、ここに並ぶようにしてるよ。',
    ].join('\n');
  }

  const lines = [
    `今日のOCR候補プレビューだよ。自動OCRは今 ${state.autoEnabled ? 'ON' : 'OFF'}。`,
    `未処理: ${counts.queued}枚 / 再試行待ち: ${counts.failed}枚 / 処理中: ${counts.processing}枚 / 確認送信済み: ${counts.complete}枚`,
    '',
  ];

  previewItems.slice(0, 8).forEach((candidate, index) => {
    lines.push(formatScreenshotCandidatePreviewLine(candidate, index + 1));
  });

  if (previewItems.length > 8) {
    lines.push('');
    lines.push(`ほかにあと${previewItems.length - 8}枚あるよ。`);
  }

  lines.push('');
  lines.push('このまま進めるなら「@秘書トラペル子 集計して」って呼んでね。');
  return lines.join('\n');
}

function formatScreenshotCandidatePreviewLine(candidate, index) {
  const sender = String(candidate?.senderName || '不明').slice(0, 20);
  const time = formatTokyoTime(candidate?.createdAt || candidate?.updatedAt);
  const size = candidate?.width && candidate?.height ? `${candidate.width}x${candidate.height}` : 'サイズ未記録';
  const label = formatScreenshotCandidateStatusLabel(candidate);
  return `${index}. ${time} ${sender} ${label} ${size}`;
}

function formatScreenshotCandidateStatusLabel(candidate) {
  const status = String(candidate?.status || 'queued');
  if (status === 'queued') return '[待機中]';
  if (status === 'processing' && isStaleProcessingScreenshotCandidate(candidate)) return '[再開待ち]';
  if (status === 'processing') return '[処理中]';
  if (status === 'fetch_failed') return '[再取得待ち]';
  if (status === 'ocr_failed') return '[OCR再試行待ち]';
  if (status === 'skipped_backlog') return '[混雑で後回し]';
  if (status === 'unreadable') return '[画像再確認待ち]';
  if (status === 'delivery_failed') return '[送信再試行待ち]';
  return `[${status}]`;
}

function formatTokyoTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '--:--';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

function formatBatchOcrSummary(summary) {
  return [
    '今日のスクショ集計、終わったよ。',
    `見た候補: ${summary.total}枚`,
    `確認ボタンを出した試合: ${summary.complete}枚`,
    `ウイコレ試合結果ではなさそうで見送ったもの: ${summary.ignored}枚`,
    `試合結果っぽいけど読み切れなかったもの: ${summary.incomplete}枚`,
    summary.skipped ? `混雑で後回しにしたもの: ${summary.skipped}枚` : '',
    summary.failed ? `取得かOCRで失敗したもの: ${summary.failed}枚` : '',
    summary.remaining ? `まだ控えが${summary.remaining}枚あるよ。続けるなら、もう一回「集計して」って呼んでね。` : '',
    summary.complete ? '読めた分は確認ボタンを押したら登録できるよ。私、ちゃんと待ってる。' : '今回は登録確認まで進める画像はなかったみたい。必要なスクショだけまた上げてくれたら、私が見るね。',
  ].filter(Boolean).join('\n');
}

function getBatchOcrMaxImages() {
  const value = Number(process.env.BATCH_OCR_MAX_IMAGES || DEFAULT_BATCH_OCR_MAX_IMAGES);
  if (!Number.isFinite(value) || value < 1) return DEFAULT_BATCH_OCR_MAX_IMAGES;
  return Math.floor(value);
}

async function pushText(client, to, text) {
  if (!to || typeof client.pushMessage !== 'function') return null;
  return client.pushMessage(to, { type: 'text', text });
}

function trimBatchError(value) {
  return String(value || '').replace(/\s+/g, ' ').slice(0, 200);
}

async function buildAiConversationContext(year, month, senderName = null, sourceId = null, userId = null) {
  try {
    const players = await getPlayers();
    const [monthResults, yearResults, diaries, recentConversation, senderProfile, privateProfile] = await Promise.all([
      getMonthResults(year, month),
      getYearResults(year),
      getRecentDiaries(3),
      sourceId ? getRecentConversation(sourceId, 20) : Promise.resolve([]),
      userId ? getMemberProfile(userId) : Promise.resolve(null),
      getResolvedPrivateProfile({ userId, realName: senderName }).catch(() => null),
    ]);
    const monthlyRows = calculateMonthlyStandings(players, monthResults);
    const annualRows = calculateAnnualStandings(players, yearResults);
    const playerNames = (Array.isArray(players) ? players : Object.values(players || {}))
      .map(p => p?.name)
      .filter(Boolean);
    return {
      year,
      month,
      hour: getTokyoDateParts().hour,
      senderName,
      senderProfileText: formatProfileForContext(senderProfile, senderName),
      privateProfileText: buildPrivateProfileContextText(privateProfile),
      players: playerNames,
      monthlyTop: monthlyRows[0] || null,
      annualTop: annualRows[0] || null,
      recentDiaries: diaries.slice(0, 3).map((d, i) => ({
        date: d.date,
        text: d.text?.slice(0, i === 0 ? 1500 : 300) || '',
      })),
      recentConversation,
    };
  } catch (err) {
    console.error('[ai-chat] context failed', err?.message || err);
    return { year, month, hour: getTokyoDateParts().hour, senderName };
  }
}

function detectTextIntent(text, options = {}) {
  const { compact, mentioned, withoutMention } = getSecretaryMentionInfo(text);
  if (!compact) return null;
  // ヘルプ・モード系はメンションなしでも反応させる（group/1-on-1共通）
  if (/^(ヘルプ|help)$/i.test(compact)) return 'help';
  const beastBare = detectBeastModeIntent(withoutMention || compact);
  if (beastBare) return beastBare;
  if (!mentioned) return null;

  if (!withoutMention || /(ヘルプ|help|使い方|何できる|なにできる|できること|ワード|一覧)/.test(withoutMention)) return 'help';
  if (/(まとめて|要約|最近の会話|会話まとめ|何話してた|なに話してた|みんな何|みんな何言)/.test(withoutMention)) return 'summary';
  const directSystemStatusKind = detectSystemStatusKind(withoutMention);
  if (directSystemStatusKind) return `system:${directSystemStatusKind}`;

  const targetText = withoutMention;

  const privateProfileIntent = detectPrivateProfileIntent(targetText);
  if (privateProfileIntent) return privateProfileIntent;

  const beastModeIntent = detectBeastModeIntent(targetText);
  if (beastModeIntent) return beastModeIntent;

  const geoGameIntent = detectGeoGameIntent(targetText);
  if (geoGameIntent) return geoGameIntent;

  const diceGameIntent = detectDiceGameIntent(targetText);
  if (diceGameIntent) return diceGameIntent;

  const ocrControlIntent = detectOcrControlIntent(targetText);
  if (ocrControlIntent) return ocrControlIntent;

  const locationStoryIntent = detectLocationStoryIntent(targetText);
  if (locationStoryIntent) return locationStoryIntent;

  const nearbyIntent = detectNearbyIntent(targetText);
  if (nearbyIntent) return nearbyIntent;

  const wakeAlarmIntent = detectWakeAlarmIntent(targetText);
  if (wakeAlarmIntent) return wakeAlarmIntent;

  const reminderIntent = detectReminderIntent(targetText);
  if (reminderIntent) return reminderIntent;

  const reminderSuggestionIntent = detectReminderSuggestionIntent(targetText);
  if (reminderSuggestionIntent) return reminderSuggestionIntent;

  const conciergeIntent = detectConciergeIntent(targetText);
  if (conciergeIntent) return conciergeIntent;

  if (detectProjectGuideIntent(targetText)) return 'projectGuide';

  if (detectBillingRiskIntent(targetText)) return 'billing';

  const uicolleKind = detectUicolleIntent(targetText);
  if (uicolleKind) return `uicolle:${uicolleKind}`;
  if (/(今のイベント|開催中のイベント|今のガチャ|開催中.*ガチャ|ガチャ.*今|最新情報|ウイコレ.*情報)/.test(targetText)) return 'uicolle:news';
  if (/(名場面|名シーン|ハイライト|月間まとめ|今月まとめ|日記連動|日記.*名場面|日記.*ハイライト)/.test(targetText)) return 'monthlyHighlights';
  if (/(口癖|因縁|相性|ライバル|メンバー.*煽|みんな.*煽|各メンバー|人物メモ|メンバー分析|キャラ分析)/.test(targetText)) return 'memberFlavor';
  if (/(未対戦|未消化ペア|あと誰.*誰|誰と誰|対戦.*残|残り.*対戦|対戦残り|やってない.*ペア)/.test(targetText)) return 'missingMatchups';
  if (/(日記|読んで|ブログ|最近書いた|最新の日記|何書いた)/.test(targetText)) return 'diary';

  const wantsRule = /(縛り|しばり|ルール|rule|制限|条件)/.test(targetText);
  if (wantsRule && /(来月|次月|翌月)/.test(targetText)) return 'nextRule';
  if (wantsRule && /(今月|当月|現在)/.test(targetText)) return 'currentRule';
  if (wantsRule) return 'nextRule';

  const wantsAnnual = /(年間|今年|年内|総合)/.test(targetText);
  const wantsRank = /(順位|ランキング|rank|何位|なんい|首位|トップ)/.test(targetText);
  const wantsAnnualPoint = wantsAnnual && /(pt|ポイント)/.test(targetText);
  if (wantsAnnual && (wantsRank || wantsAnnualPoint)) return 'annual';
  if (wantsRank) return 'monthly';

  if (/(進捗|しんちょく|やってない|まだ.*試合|試合.*まだ|残り.*試合|試合.*残り|誰がまだ|だれがまだ|やった.*誰|誰.*やった|片方|1試合|未消化)/.test(targetText)) return 'progress';

  if (/NB-\d{8}-\d+/.test(targetText)) return 'noblesse:status';
  if (/(案件|ノブレス|システム).*(確認|状況|どうなった|一覧|見せて|教えて|リスト|まとめ)/.test(targetText)) return 'noblesse:status';

  if (/(状況|戦況|成績|調子|まとめ|誰が強い|だれが強い|勝ってる)/.test(targetText)) return 'status';

  if (isWeatherRequest(targetText)) return 'weather';

  const bookingCommand = detectBookingCommand(targetText);
  if (bookingCommand) return bookingCommand;

  const foodQuickReplyCommand = detectFoodQuickReplyCommand(targetText);
  if (foodQuickReplyCommand) return foodQuickReplyCommand;

  const curatedPlanCommand = detectCuratedPlanCommand(targetText);
  if (curatedPlanCommand) return curatedPlanCommand;

  if (detectNoblesseIntent(targetText)) return 'noblesse';

  if (isTransportRequest(targetText)) return 'transport';

  if (isRestaurantRequest(targetText)) return { type: 'restaurant', text: targetText };

  return 'casual';
}

async function handlePostback(event, client) {
  const data = event.postback.data;

  if (data.startsWith('noblesse:')) {
    return handleNoblessePostback(event, client, data);
  }

  if (data.startsWith('concierge:')) {
    return client.replyMessage(event.replyToken, handleConciergePostback(data));
  }

  if (data.startsWith('ocr_ok:')) {
    const msgId = data.replace('ocr_ok:', '');
    const pending = await getPending(msgId);
    if (!pending) {
      return client.replyMessage(event.replyToken, { type: 'text', text: 'データが見つからなかったの... ちょっと時間が経ちすぎちゃったかも。\nもう一回送ってくれたら、今度は私がちゃんと受け止めるね。' });
    }
    if (!pending.away || !pending.home || !Number.isInteger(pending.awayScore) || !Number.isInteger(pending.homeScore)) {
      await deletePending(msgId);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'ごめんね、この確認データは足りないところがあったから登録しないでおくね。\nもう一回画像を送って。あなたの結果、ちゃんと残したいの。',
      });
    }
    await saveResult(pending);
    await deletePending(msgId);
    const flex = buildCompleteFlex(pending);
    return client.replyMessage(event.replyToken, flex);
  }

  if (data.startsWith('ocr_ng:')) {
    const msgId = data.replace('ocr_ng:', '');
    await deletePending(msgId);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'わかった、キャンセルにするね。\nまた送ってくれたら、私ちゃんと見るから。頼ってくれるの、うれしいな。\nhttps://naotaxy.github.io/winning-roulette/',
    });
  }
}

// ── タイピングインジケーター（LINE showLoadingAnimation API） ──────────────
async function showTypingIndicator(sourceId) {
  if (!sourceId || sourceId === 'unknown') return;
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500); // 返信ブロックを防ぐため短めにタイムアウト
  try {
    await fetch('https://api.line.me/v2/bot/chat/loading/start', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ chatId: sourceId, loadingSeconds: 5 }),
    });
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error('[typing-indicator] failed', err?.message || err);
    }
  } finally {
    clearTimeout(timer);
  }
}

// ── ノブレス専用送信（受理一言 → 分析テキスト → 承認Flex） ─────────────────
async function sendNoblesseReply(client, event, caseId, analysis, request, sourceId) {
  const userId = event?.source?.userId;
  if (userId) showTypingIndicator(userId).catch(() => {});
  await new Promise(r => setTimeout(r, 1200 + Math.floor(Math.random() * 600)));

  // 1st: 短い受理一言（バリエーション）
  const ackLines = [
    '承りました。少し待っていて。',
    '受理したよ。すぐ整理する。',
    '引き取った。少し待っていて。',
    'わかった。今から出す。',
  ];
  const ack = ackLines[Math.floor(Math.random() * ackLines.length)];
  await client.replyMessage(event.replyToken, {
    type: 'text',
    text: ack,
  });

  // 2nd: 分析テキスト
  if (sourceId) {
    setTimeout(() => {
      client.pushMessage(sourceId, { type: 'text', text: analysis })
        .catch(err => console.error('[noblesse] push analysis failed', err?.message || err));
    }, 2000 + Math.floor(Math.random() * 800));
  }

  // 3rd: 承認Flex（案件ボタン）
  if (sourceId) {
    setTimeout(() => {
      client.pushMessage(sourceId, buildApprovalFlex(caseId, analysis, request))
        .catch(err => console.error('[noblesse] push flex failed', err?.message || err));
    }, 4200 + Math.floor(Math.random() * 800));
  }
}

// ── ノブレスpostbackハンドラ ──────────────────────────────────────────────────
async function handleNoblessePostback(event, client, data) {
  const sourceId = event.source.groupId || event.source.roomId || event.source.userId || 'unknown';
  const actorName = await getSenderName(event, client, '');
  const parts = data.split(':');
  const action = parts[1];
  const caseId = parts[2];

  if (!caseId) {
    return client.replyMessage(event.replyToken, { type: 'text', text: 'データが見つからなかった。もう一度試してね。' });
  }

  if (action === 'approve') {
    const option = parts[3] || 'C';
    const caseData = await approveCase(caseId, option, { actorName });
    if (!caseData) {
      return client.replyMessage(event.replyToken, { type: 'text', text: `案件 ${caseId} が見つからなかったの。もう一度相談してくれる？` });
    }

    const opts = parseCaseOptions(caseData.analysis || '');
    const chosenText = opts[option] || '';
    const searchKeyword = pickSearchKeyword(caseData.request || '', chosenText);
    const combinedText = `${caseData.request || ''} ${caseData.analysis || ''}`;

    if (isMessageDraftRequest(combinedText)) {
      const draft = buildMessageDraft(caseId, caseData, option);
      const sendable = canSendDraftImmediately(draft);
      await rememberPreparedSend(caseId, {
        kind: 'message',
        title: '文面草案',
        text: draft,
        allowImmediateSend: sendable,
      });
      await logCaseEvent(caseId, 'message_draft_ready', { actorName, note: sendable ? '即送信可能' : '未入力あり' });
      return client.replyMessage(event.replyToken, [
        { type: 'text', text: draft },
        buildPreparedSendFlex(caseId, 'この文面草案', sendable),
      ]);
    }

    if (isScheduleDraftRequest(combinedText)) {
      const draft = buildScheduleDraft(caseId, caseData, option);
      const sendable = canSendDraftImmediately(draft);
      await rememberPreparedSend(caseId, {
        kind: 'schedule',
        title: '日程募集たたき台',
        text: draft,
        allowImmediateSend: sendable,
      });
      await logCaseEvent(caseId, 'schedule_draft_ready', { actorName, note: sendable ? '即送信可能' : '未入力あり' });
      return client.replyMessage(event.replyToken, [
        { type: 'text', text: draft },
        buildPreparedSendFlex(caseId, 'この日程文面', sendable),
      ]);
    }

    if (detectOutingRequest(combinedText)) {
      return handleCuratedApprovalFlow({
        client,
        event,
        sourceId,
        actorName,
        userId: event.source?.userId || '',
        caseId,
        caseData,
        option,
        kind: 'outing',
      });
    }

    if (detectShoppingRequest(combinedText)) {
      return handleCuratedApprovalFlow({
        client,
        event,
        sourceId,
        actorName,
        userId: event.source?.userId || '',
        caseId,
        caseData,
        option,
        kind: 'shopping',
      });
    }

    if (isRestaurantRequest(combinedText)) {
      return handleRestaurantApprovalFlow({
        client,
        event,
        sourceId,
        actorName,
        userId: event.source?.userId || '',
        caseId,
        caseData,
        option,
        searchKeyword,
      });
    }

    if (isHotelRequest(combinedText)) {
      return handleHotelApprovalFlow({
        client,
        event,
        sourceId,
        actorName,
        userId: event.source?.userId || '',
        caseId,
        caseData,
        option,
        searchKeyword,
      });
    }

    if (isTransportRequest(combinedText)) {
      const routeParams = extractRouteParams(chosenText || caseData.request || '');
      if (isTaxiRequest(combinedText)) {
        await client.replyMessage(event.replyToken, { type: 'text', text: `案${option}で進めるね。タクシー情報を出すね。` });
        await logCaseEvent(caseId, 'transport_info', { actorName, mode: 'taxi', from: routeParams.from, to: routeParams.to });
        if (sourceId) client.pushMessage(sourceId, buildTaxiFlex(routeParams.from, routeParams.to)).catch(() => {});
      } else if (isFlightRequest(combinedText)) {
        await client.replyMessage(event.replyToken, { type: 'text', text: `案${option}で進めるね。フライト情報を出すね。` });
        await logCaseEvent(caseId, 'transport_info', { actorName, mode: 'flight', from: routeParams.from, to: routeParams.to });
        if (sourceId) client.pushMessage(sourceId, buildFlightFlex(routeParams.from, routeParams.to)).catch(() => {});
      } else {
        await client.replyMessage(event.replyToken, { type: 'text', text: `案${option}で進めるね。経路を出すね。` });
        await logCaseEvent(caseId, 'transport_info', { actorName, mode: 'route', from: routeParams.from, to: routeParams.to });
        if (sourceId) client.pushMessage(sourceId, buildRouteFlex(routeParams.from, routeParams.to)).catch(() => {});
      }
      return;
    }

    const report = buildExecutionReport(caseId, option, caseData);
    await logCaseEvent(caseId, 'report_sent', { actorName });
    await client.replyMessage(event.replyToken, { type: 'text', text: report });
    return;
  }

  if (action === 'hotel_search') {
    const paramStr = parts.slice(3).join(':');
    const searchParams = new URLSearchParams(paramStr);
    const keyword = decodeURIComponent(searchParams.get('keyword') || '');
    const maxCharge = Number(searchParams.get('budget') || 0);
    const { adultNum, nights, checkinDate, checkoutDate } = extractHotelParams(keyword);

    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: `${maxCharge ? `${maxCharge.toLocaleString()}円以内` : ''}${checkinDate ? `、${checkinDate}${checkoutDate ? `〜${checkoutDate}` : ''}` : ''}で探してくるね。少し待って。`,
    });
    return runHotelSearchFlow({
      client,
      sourceId,
      actorName,
      caseId,
      keyword,
      adultNum,
      nights,
      checkinDate,
      checkoutDate,
      maxCharge: maxCharge || null,
      strategy: 'guided',
      assumptionNote: '',
    });
  }

  if (action === 'search_mode') {
    const strategy = parts[3] === 'concierge' ? 'concierge' : 'guided';
    const caseData = await getNoblesseCase(caseId);
    if (!caseData) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `案件 ${caseId} が見つからなかったの。もう一度相談してくれる？`,
      });
    }
    const combinedText = `${caseData.request || ''} ${caseData.analysis || ''}`;
    const kind = isHotelRequest(combinedText) ? 'hotel' : 'restaurant';
    const approvedOption = caseData.approvedOption || 'C';
    const options = parseCaseOptions(caseData.analysis || '');
    const chosenText = options[approvedOption] || '';
    const intake = createSearchIntake({
      kind,
      strategy,
      requestText: caseData.request || '',
      searchKeyword: pickSearchKeyword(caseData.request || '', chosenText),
      option: approvedOption,
      actorName,
      ownerUserId: event.source?.userId || '',
    });
    await rememberSearchIntake(caseId, intake);
    await logCaseEvent(caseId, 'search_strategy_selected', {
      actorName,
      mode: strategy === 'concierge' ? '秘書に任せる' : '条件ヒアリング',
    });
    return continueSearchIntakeOrRun({
      client,
      event,
      sourceId,
      actorName,
      caseId,
      intake,
    });
  }

  if (action === 'curated_pick') {
    const caseData = await getNoblesseCase(caseId);
    if (!caseData) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `案件 ${caseId} が見つからなかったの。もう一度相談してくれる？`,
      });
    }
    const plan = getCuratedPlan(caseData);
    if (!plan?.kind || !Array.isArray(plan.candidates) || !plan.candidates.length) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'しおりを作る前の候補がまだないみたい。先に候補を出し直そうか。',
      });
    }
    return handleCuratedCandidatePick({
      client,
      event,
      sourceId,
      actorName,
      caseId,
      caseData,
      candidateIndex: parts[3],
    });
  }

  if (action === 'hotel_select') {
    const caseData = await getNoblesseCase(caseId);
    if (!caseData) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `案件 ${caseId} が見つからなかったの。もう一度相談してくれる？`,
      });
    }
    const hotel = getSelectionCandidate(caseData, parts[3]);
    const hotelName = hotel?.name || decodeURIComponent(parts.slice(3).join(':'));
    await approveCase(caseId, 'hotel', { actorName, note: hotelName });
    const handoffPlan = await planNoblesseExecution({
      caseId,
      caseData,
      sourceId,
      actorName,
      type: 'booking_handoff',
      provider: 'rakuten',
      payload: {
        kind: 'hotel',
        name: hotelName,
        url: hotel?.url || '',
      },
    });
    if (!handoffPlan.allowed) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: formatExecutionBlockedReply(handoffPlan),
      });
    }
    if (!hotel) {
      try {
        await markExecutionRunning(handoffPlan, { note: 'hotel handoff fallback reply' });
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: `「${hotelName}」に決めるね。\n案件 ${caseId} を承認済みにしたよ。\n予約ページから確定させてね。`,
        });
        await completeNoblesseExecution(handoffPlan, { handoff: 'fallback_reply' });
        return;
      } catch (err) {
        await failNoblesseExecution(handoffPlan, err, { handoff: 'fallback_reply' });
        throw err;
      }
    }
    const shareText = buildDecisionShareText(caseId, 'hotel', hotel);
    const searchIntake = getSearchIntake(caseData);
    const bookingForm = createBookingForm({
      kind: 'hotel',
      name: hotel.name,
      url: hotel.url,
      phone: hotel.phone,
      address: hotel.address,
      partySize: searchIntake?.adultNum || null,
      reservationDateTime: formatSearchStayLabel(searchIntake),
    }, actorName, event.source?.userId || '');
    await rememberBookingForm(caseId, bookingForm);
    await rememberPreparedSend(caseId, {
      kind: 'decision',
      title: `${hotelName} の共有`,
      text: shareText,
      allowImmediateSend: true,
    });
    await logCaseEvent(caseId, 'hotel_selected', { actorName, name: hotelName });
    await logCaseEvent(caseId, 'decision_ready', { actorName, note: hotelName });
    try {
      await markExecutionRunning(handoffPlan, { note: 'hotel handoff panel' });
      await client.replyMessage(event.replyToken, [
        { type: 'text', text: `「${hotelName}」で寄せるね。予約導線と共有送信を出すよ。` },
        buildDecisionActionFlex(caseId, 'hotel', hotel),
      ]);
      await completeNoblesseExecution(handoffPlan, {
        handoff: 'decision_panel',
        preparedSendTitle: `${hotelName} の共有`,
      });
      return;
    } catch (err) {
      await failNoblesseExecution(handoffPlan, err, { handoff: 'decision_panel' });
      throw err;
    }
  }

  if (action === 'search') {
    const paramStr = parts.slice(3).join(':');
    const searchParams = new URLSearchParams(paramStr);
    const keyword = decodeURIComponent(searchParams.get('keyword') || '');
    const budgetYen = Number(searchParams.get('budget') || 0);
    const { capacity } = extractRestaurantParams(keyword);

    await client.replyMessage(event.replyToken, { type: 'text', text: `${budgetYen ? `${budgetYen.toLocaleString()}円以内` : ''}で探してくるね。少し待って。` });
    return runRestaurantSearchFlow({
      client,
      sourceId,
      actorName,
      caseId,
      keyword,
      capacity,
      budgetYen: budgetYen || null,
      strategy: 'guided',
      assumptionNote: '',
    });
  }

  if (action === 'restaurant_select') {
    const caseData = await getNoblesseCase(caseId);
    if (!caseData) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `案件 ${caseId} が見つからなかったの。もう一度相談してくれる？`,
      });
    }
    const shop = getSelectionCandidate(caseData, parts[3]);
    const shopName = shop?.name || decodeURIComponent(parts.slice(3).join(':'));
    await approveCase(caseId, 'restaurant', { actorName, note: shopName });
    const handoffPlan = await planNoblesseExecution({
      caseId,
      caseData,
      sourceId,
      actorName,
      type: 'booking_handoff',
      provider: 'hotpepper',
      payload: {
        kind: 'restaurant',
        name: shopName,
        url: shop?.url || '',
        phone: shop?.phone || '',
      },
    });
    if (!handoffPlan.allowed) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: formatExecutionBlockedReply(handoffPlan),
      });
    }
    if (!shop) {
      try {
        await markExecutionRunning(handoffPlan, { note: 'restaurant handoff fallback reply' });
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: `「${shopName}」に決めるね。\n案件 ${caseId} を承認済みにしたよ。\n予約ページか電話から確定させてね。私が段取りのたたき台を作ることもできるよ。`,
        });
        await completeNoblesseExecution(handoffPlan, { handoff: 'fallback_reply' });
        return;
      } catch (err) {
        await failNoblesseExecution(handoffPlan, err, { handoff: 'fallback_reply' });
        throw err;
      }
    }
    const shareText = buildDecisionShareText(caseId, 'restaurant', shop);
    const searchIntake = getSearchIntake(caseData);
    const bookingForm = createBookingForm({
      kind: 'restaurant',
      name: shop.name,
      url: shop.url,
      phone: shop.phone,
      address: shop.address,
      partySize: searchIntake?.partySize || null,
    }, actorName, event.source?.userId || '');
    await rememberBookingForm(caseId, bookingForm);
    await rememberPreparedSend(caseId, {
      kind: 'decision',
      title: `${shopName} の共有`,
      text: shareText,
      allowImmediateSend: true,
    });
    await logCaseEvent(caseId, 'restaurant_selected', { actorName, name: shopName });
    await logCaseEvent(caseId, 'decision_ready', { actorName, note: shopName });
    try {
      await markExecutionRunning(handoffPlan, { note: 'restaurant handoff panel' });
      await client.replyMessage(event.replyToken, [
        { type: 'text', text: `「${shopName}」に寄せるね。予約導線と共有送信を出すよ。` },
        buildDecisionActionFlex(caseId, 'restaurant', shop),
      ]);
      await completeNoblesseExecution(handoffPlan, {
        handoff: 'decision_panel',
        preparedSendTitle: `${shopName} の共有`,
      });
      return;
    } catch (err) {
      await failNoblesseExecution(handoffPlan, err, { handoff: 'decision_panel' });
      throw err;
    }
  }

  if (action === 'booking_form') {
    const caseData = await getNoblesseCase(caseId);
    if (!caseData) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `案件 ${caseId} が見つからなかったの。もう一度相談してくれる？`,
      });
    }
    const bookingForm = getBookingForm(caseData);
    if (!bookingForm) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '先にお店かホテルを選んでくれる？ そこから予約情報を集めるね。',
      });
    }
    const nextField = getNextBookingField(bookingForm);
    const updated = await updateBookingForm(caseId, {
      awaitingField: nextField,
      ownerUserId: event.source?.userId || bookingForm.ownerUserId || '',
      ownerName: actorName || bookingForm.ownerName || '',
      status: nextField ? 'collecting' : 'complete',
    });
    await logCaseEvent(caseId, 'booking_form_started', { actorName, note: bookingForm.targetName || '' });
    return replyBookingFormFlow(client, event, caseId, updated?.bookingForm || { ...bookingForm, awaitingField: nextField });
  }

  if (action === 'booking_party') {
    const caseData = await getNoblesseCase(caseId);
    if (!caseData) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `案件 ${caseId} が見つからなかったの。もう一度相談してくれる？`,
      });
    }
    return handleBookingFieldUpdate({
      client,
      event,
      caseId,
      caseData,
      actorName,
      userId: event.source?.userId || '',
      field: 'partySize',
      rawValue: parts[3] || '',
    });
  }

  if (action === 'select_send_target') {
    const caseData = await getNoblesseCase(caseId);
    if (!caseData) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `案件 ${caseId} が見つからなかったの。もう一度相談してくれる？`,
      });
    }
    const prepared = getPreparedSend(caseData);
    if (!prepared) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `案件 ${caseId} に送信できる内容がまだないみたい。先に案を進めようか。`,
      });
    }
    if (!prepared.allowImmediateSend) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'まだ未入力のところが残ってるから、そのまま送るのは止めておくね。必要な情報を埋めたら、また私に見せて。',
      });
    }
    const targets = resolvePreparedSendTargets(caseData, sourceId);
    if (!targets.length) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '送れる先がまだ見つからないの。このトークか、Botとつながってる個人トークが必要みたい。',
      });
    }
    return client.replyMessage(event.replyToken, buildSendTargetFlex(caseId, prepared.title || 'この文面', targets));
  }

  if (action === 'send_prepared') {
    const caseData = await getNoblesseCase(caseId);
    if (!caseData) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `案件 ${caseId} が見つからなかったの。もう一度相談してくれる？`,
      });
    }
    const prepared = getPreparedSend(caseData);
    if (!prepared) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `案件 ${caseId} に送信できる内容がまだないみたい。先に案を進めようか。`,
      });
    }
    if (!prepared.allowImmediateSend) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'まだ未入力のところが残ってるから、そのまま送るのは止めておくね。必要な情報を埋めたら、また私に見せて。',
      });
    }
    const targetKind = normalizePreparedSendTargetKind(parts[3] || 'current');
    const target = getPreparedSendTarget(caseData, sourceId, targetKind);
    if (!target) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'その送信先はまだ使えないみたい。送信先を選び直してくれる？',
      });
    }
    const sendPlan = await planNoblesseExecution({
      caseId,
      caseData,
      sourceId,
      actorName,
      type: 'line_send',
      provider: 'line',
      payload: {
        kind: prepared.kind || '',
        title: prepared.title || '',
        targetKind: target.kind,
        targetLabel: target.ackLabel,
      },
    });
    if (!sendPlan.allowed) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: formatExecutionBlockedReply(sendPlan),
      });
    }
    const eventKind = prepared.kind === 'schedule'
      ? 'schedule_sent'
      : prepared.kind === 'decision'
        ? 'decision_sent'
        : 'message_sent';
    await logCaseEvent(caseId, eventKind, { actorName, note: prepared.title || '' });
    try {
      await markExecutionRunning(sendPlan, {
        destination: target.targetId,
        targetKind: target.kind,
        note: prepared.kind || '',
      });
      if (target.kind === 'current') {
        await client.replyMessage(event.replyToken, [
          { type: 'text', text: prepared.text },
          { type: 'text', text: `案件 ${caseId} を ${target.ackLabel} に送ったよ。` },
        ]);
        await completeNoblesseExecution(sendPlan, {
          destination: target.targetId,
          targetKind: target.kind,
          sentTitle: prepared.title || '',
        });
      } else {
        await client.pushMessage(target.targetId, buildPreparedSendMessages(caseId, prepared, caseData, target));
        try {
          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: `案件 ${caseId} を ${target.ackLabel} に送ったよ。`,
          });
        } catch (ackErr) {
          if (sourceId) {
            await pushText(client, sourceId, `案件 ${caseId} を ${target.ackLabel} に送ったよ。`).catch(() => {});
          }
        }
        await completeNoblesseExecution(sendPlan, {
          destination: target.targetId,
          targetKind: target.kind,
          sentTitle: prepared.title || '',
        });
      }
      return;
    } catch (err) {
      await failNoblesseExecution(sendPlan, err, {
        destination: target.targetId,
        targetKind: target.kind,
        sentTitle: prepared.title || '',
      });
      if (target.kind === 'current') {
        if (sourceId) {
          await pushText(client, sourceId, formatPreparedSendFailure(target)).catch(() => {});
          return;
        }
        throw err;
      }
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: formatPreparedSendFailure(target),
      });
    }
  }

  if (action === 'noop') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'この文面はまだ未入力が残ってるから、送信は止めておくね。必要な情報を足してくれたら整えるよ。',
    });
  }

  if (action === 'cancel') {
    await cancelCase(caseId, { actorName });
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `わかった、${caseId} はキャンセルにするね。\nまた相談したくなったら、いつでも言って。`,
    });
  }
}

function normalizeRestaurantCandidates(shops) {
  return (shops || []).slice(0, 3).map(shop => ({
    name: shop?.name || '',
    url: shop?.urls?.pc || '',
    phone: shop?.tel || '',
    address: shop?.address || '',
    budget: shop?.budget?.average || shop?.budget?.name || '',
  }));
}

function extractRestaurantArea(text) {
  const t = String(text || '').normalize('NFKC').trim();
  const m = t.match(/([ぁ-ん一-龯ァ-ン]{2,8}?)(?:駅|で|の|周辺|近く|あたり|に向|方面)/);
  return m ? m[1].trim() : '';
}

function buildDiningKeywordsFromProfile(profile) {
  if (!profile) return [];
  const combined = [
    profile.preferenceHints?.food || '',
    ...(profile.summaryLines || []),
    profile.memo || '',
  ].join(' ');

  const keywords = [];
  if (/妥協.*刺さ|ちゃんと美味し|良い外食|こだわ/.test(combined)) keywords.push('こだわり');
  if (/落ち着|大人|上質|静か/.test(combined)) keywords.push('落ち着いた');
  if (/おしゃれ|麻布台|吉祥寺|空気感|センス/.test(combined)) keywords.push('おしゃれ');
  if (/居酒屋|飲み|クラフトビール/.test(combined)) keywords.push('居酒屋');
  if (/和食|割烹|日本料理/.test(combined)) keywords.push('和食');
  if (/イタリアン|パスタ|ピザ/.test(combined)) keywords.push('イタリアン');
  if (/ランチ|昼食/.test(combined)) keywords.push('ランチ');
  return keywords.slice(0, 2); // 多すぎると絞り込みすぎるので最大2つ
}

function buildProfileIntroLine(profile, area) {
  if (!profile) return `${area}で見つけてきたよ。気になるところある？`;
  const name = profile.lineName || profile.realName || '';
  const food = profile.preferenceHints?.food;
  if (food) return `${name ? name + 'さんの「' + food.slice(0, 18) + '」' : 'あなたの好みの感じ'}に近いところ、${area}で探してきたよ。`;
  return `${name ? name + 'さんに向きそうなところ、' : ''}${area}で見つけてきたよ。`;
}

async function handleDirectRestaurantSearch({ client, event, sourceId, userId, senderName, text, route = '' }) {
  // エリア抽出：テキスト → 直近会話を遡る
  let area = extractRestaurantArea(text);
  if (!area && sourceId) {
    const recent = await getRecentConversation(sourceId, 8).catch(() => []);
    for (const msg of [...recent].reverse()) {
      const a = extractRestaurantArea(msg.text || '');
      if (a) { area = a; break; }
    }
  }

  if (!area) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: route === 'food-quick-reply'
        ? 'どのエリアで寄りたい？「中野で」「吉祥寺近く」みたいに教えてくれたら、美味しい候補だけ静かに絞るよ。'
        : 'どのエリアで探す？「市ヶ谷で」「渋谷近く」みたいに教えてくれると、ちゃんと探せるよ。',
    });
  }

  // プロファイルから嗜好キーワードを生成
  const profile = await getResolvedPrivateProfile({ userId, realName: senderName }).catch(() => null);
  const profileKeywords = buildDiningKeywordsFromProfile(profile);
  const { capacity, budgetYen } = extractRestaurantParams(text);
  const keyword = [area, ...profileKeywords].filter(Boolean).join(' ');

  const shops = await searchRestaurants({ keyword, capacity, budgetYen, count: 3 }).catch(() => null);

  if (!shops?.length) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `${area}で探してみたけど、今日は出てこなかった。エリアか条件を変えてみようか？`,
    });
  }

  const intro = buildProfileIntroLine(profile, area);
  const carousel = buildRestaurantCarousel(shops, null);
  return client.replyMessage(event.replyToken, carousel
    ? [{ type: 'text', text: intro }, carousel]
    : { type: 'text', text: shops.map(s => `・${s.name}（${s.genre?.name || ''}）`).join('\n') }
  );
}

async function handleCuratedApprovalFlow({ client, event, sourceId, actorName, userId, caseId, caseData, option, kind }) {
  const plan = createCuratedPlanState({
    kind,
    requestText: caseData.request || '',
    actorName,
    ownerUserId: userId,
    option,
  });
  await rememberCuratedPlan(caseId, plan);
  await logCaseEvent(caseId, 'curated_plan_started', { actorName, kind });
  return continueCuratedPlanOrRun({ client, event, sourceId, actorName, caseId, plan });
}

async function maybeHandleCuratedAwaitingInput({ event, client, sourceId, userId, senderName, text }) {
  if (!sourceId || sourceId === 'unknown' || !userId || !String(text || '').trim()) return null;
  const caseData = await findActiveCuratedCase(sourceId, userId, true);
  const plan = getCuratedPlan(caseData);
  if (!caseData || !plan?.awaitingField) return null;
  return handleCuratedFieldUpdate({
    client,
    event,
    sourceId,
    caseId: caseData.caseId,
    caseData,
    plan,
    actorName: senderName || '',
    userId,
    rawValue: text,
  });
}

async function handleCuratedPlanTextIntent({ event, client, sourceId, userId, senderName, intent }) {
  const caseData = await findActiveCuratedCase(sourceId, userId, false);
  if (!caseData) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '先にノブレスでおでかけか買い物の相談を始めてくれる？ そこからしおりや途中変更まで面倒みるね。',
    });
  }
  const plan = getCuratedPlan(caseData);
  if (!plan) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '今つながってるおでかけ/買い物の計画が見つからなかったの。もう一回相談内容を教えてくれる？',
    });
  }

  if (intent.action === 'itinerary') {
    if (plan.itineraryText && Number.isInteger(plan.selectedIndex) && plan.candidates?.[plan.selectedIndex]) {
      const candidate = plan.candidates[plan.selectedIndex];
      return client.replyMessage(event.replyToken, [
        { type: 'text', text: plan.itineraryText },
        buildCuratedRouteFlex(plan, candidate),
        buildPreparedSendFlex(caseData.caseId, plan.kind === 'outing' ? 'この旅のしおり' : 'この買い物しおり', true),
      ]);
    }
    if (Array.isArray(plan.candidates) && plan.candidates.length) {
      return client.replyMessage(event.replyToken, [
        { type: 'text', text: buildCuratedGuideText(caseData.caseId, plan, plan.candidates) },
        buildCuratedCandidatesFlex(caseData.caseId, plan, plan.candidates),
      ]);
    }
    return continueCuratedPlanOrRun({
      client,
      event,
      sourceId,
      actorName: senderName || '',
      caseId: caseData.caseId,
      plan,
    });
  }

  const adjusted = buildCuratedAdjustmentReply(caseData.caseId, plan, intent.text || '');
  if (!adjusted.ok) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: adjusted.error,
    });
  }
  await updateCuratedPlan(caseData.caseId, adjusted.state);
  await logCaseEvent(caseData.caseId, 'curated_plan_adjusted', {
    actorName: senderName || '',
    note: adjusted.note,
  });
  return runCuratedCandidates({
    client,
    event,
    sourceId,
    actorName: senderName || '',
    caseId: caseData.caseId,
    plan: adjusted.state,
    intro: `了解、${adjusted.note}で組み直すね。`,
  });
}

async function handleCuratedFieldUpdate({ client, event, sourceId, caseId, plan, actorName, userId, rawValue, locationCoords }) {
  const parsed = applyCuratedFieldInput(plan, rawValue);
  if (!parsed.ok) {
    const currentField = getNextCuratedField(plan);
    if (currentField === 'origin' && sourceId && userId) {
      await savePendingLocationRequest(sourceId, userId, { type: 'noblesse:curated', caseId }).catch(() => {});
    }
    return client.replyMessage(event.replyToken, [
      { type: 'text', text: parsed.error },
      buildCuratedPrompt(caseId, plan),
    ]);
  }

  // GPS 位置情報が origin 更新と一緒に届いた場合は lat/lon も保存（天気・周辺スポット照会に使う）
  const coordsPatch = locationCoords && parsed.patch?.origin
    ? { lat: locationCoords.lat, lon: locationCoords.lon }
    : {};

  const merged = {
    ...plan,
    ...parsed.patch,
    ...coordsPatch,
    ownerUserId: userId || plan.ownerUserId || '',
    ownerName: actorName || plan.ownerName || '',
  };
  const nextField = getNextCuratedField(merged);
  merged.awaitingField = nextField;
  merged.status = nextField ? 'collecting' : 'ready';

  await updateCuratedPlan(caseId, merged);
  await logCaseEvent(caseId, 'curated_plan_updated', {
    actorName,
    field: curatedFieldLabel(Object.keys(parsed.patch)[0]),
  });

  if (!nextField) {
    return runCuratedCandidates({ client, event, sourceId, actorName, caseId, plan: merged });
  }

  return client.replyMessage(event.replyToken, [
    { type: 'text', text: `${curatedFieldLabel(Object.keys(parsed.patch)[0])}、受け取ったよ。` },
    buildCuratedPrompt(caseId, merged),
  ]);
}

async function continueCuratedPlanOrRun({ client, event, sourceId, actorName, caseId, plan }) {
  const nextField = getNextCuratedField(plan);
  if (!nextField) {
    return runCuratedCandidates({ client, event, sourceId, actorName, caseId, plan });
  }
  const updated = {
    ...plan,
    awaitingField: nextField,
    status: 'collecting',
  };
  await updateCuratedPlan(caseId, updated);
  const userId = event?.source?.userId || '';
  if (nextField === 'origin' && sourceId && userId) {
    await savePendingLocationRequest(sourceId, userId, { type: 'noblesse:curated', caseId }).catch(() => {});
  }
  return client.replyMessage(event.replyToken, [
    { type: 'text', text: buildCuratedSummary(caseId, updated) },
    buildCuratedPrompt(caseId, updated),
  ]);
}

async function runCuratedCandidates({ client, event, sourceId, actorName, caseId, plan, intro = '' }) {
  // A: 天気インテリジェンス — GPS 座標があれば現在の降雨を照会して候補のランキングに反映
  let weatherIntro = '';
  let activePlan = plan;
  if (plan.kind === 'outing' && Number.isFinite(plan.lat) && Number.isFinite(plan.lon)) {
    const weather = await fetchYahooWeather(plan.lat, plan.lon).catch(() => null);
    if (weather) {
      const line = buildWeatherLine(weather);
      if (line) weatherIntro = line;
      if ((weather.isRaining || weather.willRain) && plan.weatherMode !== 'indoor') {
        activePlan = { ...plan, weatherMode: 'indoor' };
        weatherIntro += '\n屋内・屋根付きを優先候補に調整しました。';
      }
    }
  }

  const candidates = rankCuratedCandidates(activePlan);
  const updated = {
    ...activePlan,
    candidates,
    awaitingField: '',
    status: candidates.length ? 'candidates' : 'collecting',
    selectedIndex: null,
    itineraryText: '',
  };
  await updateCuratedPlan(caseId, updated);
  await logCaseEvent(caseId, 'curated_candidates_ready', { actorName, kind: plan.kind });

  if (!candidates.length) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: [weatherIntro, intro, plan.kind === 'outing'
        ? 'いまの条件だと、しっくりくるおでかけ先がまだ出し切れなかったの。少し条件を変えようか。'
        : 'いまの条件だと、しっくりくる買い物先がまだ出し切れなかったの。少し条件を変えようか。',
      ].filter(Boolean).join('\n'),
    });
  }

  const guideText = buildCuratedGuideText(caseId, updated, candidates);
  return client.replyMessage(event.replyToken, [
    { type: 'text', text: [weatherIntro, intro, guideText].filter(Boolean).join('\n') },
    buildCuratedCandidatesFlex(caseId, updated, candidates),
  ]);
}

async function handleCuratedCandidatePick({ client, event, sourceId, actorName, caseId, caseData, candidateIndex }) {
  const plan = getCuratedPlan(caseData);
  const index = Number(candidateIndex);
  const candidate = Array.isArray(plan?.candidates) ? plan.candidates[index] : null;
  if (!candidate) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'その候補が見つからなかったの。もう一回候補を出し直そうか。',
    });
  }

  const baseItinerary = buildCuratedItinerary(caseId, plan, candidate);

  // A + B: 天気照会 + 周辺スポットスキャン（外出プランかつ GPS 座標ありの場合）
  const isOutingWithCoords = plan.kind === 'outing' && Number.isFinite(plan.lat) && Number.isFinite(plan.lon);
  const [weather, nearbySpots] = await Promise.all([
    isOutingWithCoords
      ? fetchYahooWeather(plan.lat, plan.lon).catch(() => null)
      : Promise.resolve(null),
    plan.kind === 'outing' && candidate.area
      ? searchYahooLocalSpots(`${candidate.area} カフェ 飲食店`).catch(() => [])
      : Promise.resolve([]),
  ]);

  const intelligenceLines = [];
  if (weather) {
    intelligenceLines.push('', '── 気象情報 ──', buildWeatherLine(weather));
  }
  if (nearbySpots.length) {
    intelligenceLines.push('', '── 周辺スポット照会 ──');
    nearbySpots.slice(0, 2).forEach(s => {
      const dist = s.distance != null ? `（${s.distance}m先）` : '';
      intelligenceLines.push(`${s.name}${dist}${s.category ? '　' + s.category : ''}`);
    });
  }

  const itineraryText = intelligenceLines.length
    ? baseItinerary + '\n' + intelligenceLines.join('\n')
    : baseItinerary;

  const shareText = buildCuratedShareText(caseId, plan, candidate, itineraryText);
  await updateCuratedPlan(caseId, {
    ...plan,
    selectedIndex: index,
    itineraryText,
    status: 'selected',
  });
  await rememberPreparedSend(caseId, {
    kind: 'decision',
    title: plan.kind === 'outing' ? '旅のしおり' : '買い物しおり',
    text: shareText,
    allowImmediateSend: true,
  });
  await logCaseEvent(caseId, 'curated_plan_selected', { actorName, name: candidate.name });
  await logCaseEvent(caseId, 'curated_itinerary_ready', { actorName, name: candidate.name });
  await logCaseEvent(caseId, 'decision_ready', { actorName, note: candidate.name });

  return client.replyMessage(event.replyToken, [
    { type: 'text', text: itineraryText },
    buildCuratedRouteFlex(plan, candidate),
    buildPreparedSendFlex(caseId, plan.kind === 'outing' ? 'この旅のしおり' : 'この買い物しおり', true),
  ]);
}

async function findActiveCuratedCase(sourceId, userId, awaitingOnly) {
  const cases = await getNoblesseCases(sourceId, 10);
  return cases.find(c => {
    if (!c || c.status === 'cancelled' || !c.curatedPlan?.kind) return false;
    if (awaitingOnly) {
      return c.curatedPlan.awaitingField
        && (!c.curatedPlan.ownerUserId || c.curatedPlan.ownerUserId === userId);
    }
    return true;
  }) || null;
}

function curatedFieldLabel(field) {
  switch (field) {
    case 'origin':
      return '出発地';
    case 'durationHours':
      return '使える時間';
    case 'budgetYen':
      return '予算';
    default:
      return field || '条件';
  }
}

function normalizeHotelCandidates(hotels) {
  return (hotels || []).slice(0, 3).map(hotel => ({
    name: hotel?.hotelName || '',
    url: hotel?.planListUrl || hotel?.hotelInformationUrl || '',
    address: `${hotel?.address1 || ''}${hotel?.address2 || ''}`.trim(),
    price: hotel?.hotelMinCharge ? `${Number(hotel.hotelMinCharge).toLocaleString()}円〜/人` : '',
    review: hotel?.reviewAverage
      ? `評価: ★${hotel.reviewAverage}${hotel?.reviewCount ? ` (${Number(hotel.reviewCount).toLocaleString('ja-JP')}件)` : ''}`
      : '',
    reviewUrl: hotel?.reviewUrl || '',
    access: [hotel?.access, hotel?.nearestStation].filter(Boolean).join(' / ').slice(0, 80),
    reviewSnippet: String(hotel?.userReview || hotel?.hotelSpecial || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    heroImage: hotel?.hotelImageUrl || hotel?.hotelThumbnailUrl || hotel?.roomImageUrl || hotel?.roomThumbnailUrl || '',
    roomImage: hotel?.roomImageUrl || hotel?.roomThumbnailUrl || '',
  }));
}

async function handleHotelApprovalFlow({ client, event, sourceId, actorName, userId, caseId, caseData, option, searchKeyword }) {
  const intake = createSearchIntake({
    kind: 'hotel',
    strategy: 'guided',
    requestText: caseData.request || '',
    searchKeyword,
    option,
    actorName,
    ownerUserId: userId,
  });
  await rememberSearchIntake(caseId, intake);

  if (!isSearchKeywordUsable(intake.keyword) || !intake.checkinDate) {
    await logCaseEvent(caseId, 'search_intake_started', { actorName, kind: 'hotel' });
    return continueSearchIntakeOrRun({ client, event, sourceId, actorName, caseId, intake });
  }

  if (shouldOfferSearchStrategy(intake)) {
    return client.replyMessage(event.replyToken, buildSearchStrategyReply(caseId, intake));
  }

  return runHotelSearchFromIntake({
    client,
    event,
    sourceId,
    actorName,
    caseId,
    intake,
    openingText: `案${option}で進めるね。条件が足りてるから、そのまま宿を探してくるよ。`,
  });
}

async function handleRestaurantApprovalFlow({ client, event, sourceId, actorName, userId, caseId, caseData, option, searchKeyword }) {
  const intake = createSearchIntake({
    kind: 'restaurant',
    strategy: 'guided',
    requestText: caseData.request || '',
    searchKeyword,
    option,
    actorName,
    ownerUserId: userId,
  });
  await rememberSearchIntake(caseId, intake);

  if (!isSearchKeywordUsable(intake.keyword)) {
    await logCaseEvent(caseId, 'search_intake_started', { actorName, kind: 'restaurant' });
    return continueSearchIntakeOrRun({ client, event, sourceId, actorName, caseId, intake });
  }

  if (shouldOfferSearchStrategy(intake)) {
    return client.replyMessage(event.replyToken, buildSearchStrategyReply(caseId, intake));
  }

  return runRestaurantSearchFromIntake({
    client,
    event,
    sourceId,
    actorName,
    caseId,
    intake,
    openingText: `案${option}で進めるね。条件が足りてるから、そのままお店を探してくるよ。`,
  });
}

function shouldOfferSearchStrategy(intake) {
  if (!intake) return false;
  if (intake.kind === 'hotel') {
    return Boolean(intake.checkinDate) && (!intake.budgetYen || !intake.adultNum);
  }
  return Boolean(intake.keyword) && (!intake.budgetYen || !intake.partySize);
}

async function maybeHandleSearchIntakeAwaitingInput({ event, client, sourceId, userId, senderName, text }) {
  if (!sourceId || sourceId === 'unknown' || !userId || !String(text || '').trim()) return null;
  const caseData = await findActiveSearchIntakeCase(sourceId, userId, true);
  const intake = getSearchIntake(caseData);
  if (!caseData || !intake?.awaitingField) return null;
  return handleSearchIntakeFieldUpdate({
    client,
    event,
    sourceId,
    caseId: caseData.caseId,
    caseData,
    intake,
    actorName: senderName || '',
    userId,
    rawValue: text,
  });
}

async function continueSearchIntakeOrRun({ client, event, sourceId, actorName, caseId, intake }) {
  const nextField = getNextSearchIntakeField(intake);
  if (!nextField) {
    if (intake.kind === 'hotel') {
      return runHotelSearchFromIntake({ client, event, sourceId, actorName, caseId, intake });
    }
    return runRestaurantSearchFromIntake({ client, event, sourceId, actorName, caseId, intake });
  }

  const updated = {
    ...intake,
    awaitingField: nextField,
    status: 'collecting',
  };
  await updateSearchIntake(caseId, updated);
  return client.replyMessage(event.replyToken, [
    { type: 'text', text: buildSearchIntakeSummary(caseId, updated) },
    buildSearchIntakePrompt(caseId, updated),
  ]);
}

async function handleSearchIntakeFieldUpdate({ client, event, sourceId, caseId, caseData, intake, actorName, userId, rawValue }) {
  const parsed = applySearchFieldInput(intake, rawValue);
  if (!parsed.ok) {
    return client.replyMessage(event.replyToken, [
      { type: 'text', text: parsed.error },
      buildSearchIntakePrompt(caseId, intake),
    ]);
  }

  const merged = {
    ...intake,
    ...parsed.patch,
    ownerUserId: userId || intake.ownerUserId || '',
    ownerName: actorName || intake.ownerName || '',
  };
  const nextField = getNextSearchIntakeField(merged);
  merged.awaitingField = nextField;
  merged.status = nextField ? 'collecting' : 'ready';

  await updateSearchIntake(caseId, merged);
  await logCaseEvent(caseId, 'search_intake_updated', {
    actorName,
    field: searchFieldLabel(Object.keys(parsed.patch)[0]),
  });

  if (!nextField) {
    await logCaseEvent(caseId, 'search_intake_completed', { actorName });
    if (merged.kind === 'hotel') {
      return runHotelSearchFromIntake({ client, event, sourceId, actorName, caseId, intake: merged });
    }
    return runRestaurantSearchFromIntake({ client, event, sourceId, actorName, caseId, intake: merged });
  }

  return client.replyMessage(event.replyToken, [
    { type: 'text', text: `${searchFieldLabel(Object.keys(parsed.patch)[0])}、受け取ったよ。` },
    buildSearchIntakePrompt(caseId, merged),
  ]);
}

async function runHotelSearchFromIntake({ client, event, sourceId, actorName, caseId, intake, openingText = '' }) {
  const exec = buildSearchExecutionParams(intake);
  if (openingText) {
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: [
        openingText,
        exec.assumptionNote ? `私の仮置き: ${exec.assumptionNote}` : '',
      ].filter(Boolean).join('\n'),
    });
  } else if (event?.replyToken) {
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: [
        `${exec.checkinDate}${exec.checkoutDate ? `〜${exec.checkoutDate}` : ''}${exec.maxCharge ? ` / ${Number(exec.maxCharge).toLocaleString('ja-JP')}円/人まで` : ''}で探してくるね。`,
        exec.assumptionNote ? `私の仮置き: ${exec.assumptionNote}` : '',
      ].filter(Boolean).join('\n'),
    });
  }
  return runHotelSearchFlow({
    client,
    sourceId,
    actorName,
    caseId,
    keyword: exec.keyword,
    adultNum: exec.adultNum,
    nights: exec.nights,
    checkinDate: exec.checkinDate,
    checkoutDate: exec.checkoutDate,
    maxCharge: exec.maxCharge,
    strategy: exec.strategy,
    assumptionNote: exec.assumptionNote,
  });
}

async function runRestaurantSearchFromIntake({ client, event, sourceId, actorName, caseId, intake, openingText = '' }) {
  const exec = buildSearchExecutionParams(intake);
  if (openingText) {
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: [
        openingText,
        exec.assumptionNote ? `私の仮置き: ${exec.assumptionNote}` : '',
      ].filter(Boolean).join('\n'),
    });
  } else if (event?.replyToken) {
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: [
        `${exec.budgetYen ? `${Number(exec.budgetYen).toLocaleString('ja-JP')}円/人まで` : '条件を仮置きして'}で探してくるね。`,
        exec.assumptionNote ? `私の仮置き: ${exec.assumptionNote}` : '',
      ].filter(Boolean).join('\n'),
    });
  }
  return runRestaurantSearchFlow({
    client,
    sourceId,
    actorName,
    caseId,
    keyword: exec.keyword,
    capacity: exec.capacity,
    budgetYen: exec.budgetYen,
    strategy: exec.strategy,
    assumptionNote: exec.assumptionNote,
  });
}

async function runHotelSearchFlow({
  client,
  sourceId,
  actorName,
  caseId,
  keyword,
  adultNum,
  nights,
  checkinDate,
  checkoutDate,
  maxCharge,
  strategy,
  assumptionNote,
}) {
  let hotels = await searchHotels({
    keyword,
    adultNum,
    nights,
    checkinDate,
    checkoutDate,
    maxCharge: maxCharge || null,
  });
  if (strategy === 'concierge') {
    hotels = sortHotelsForConcierge(hotels);
  }
  if (hotels?.length) {
    await rememberSelectionCandidates(caseId, 'hotel', normalizeHotelCandidates(hotels));
    await logCaseEvent(caseId, 'hotel_search', {
      actorName,
      keyword,
      count: hotels.length,
      budgetYen: maxCharge || 0,
    });
  }
  const intro = strategy === 'concierge'
    ? '口コミと写真がしっかりしてる宿から寄せたよ。'
    : '';
  const flex = hotels?.length
    ? buildHotelCarousel(hotels, caseId)
    : { type: 'text', text: `条件に合うホテルが見つからなかったよ。${assumptionNote ? `仮置きは ${assumptionNote}。` : ''}エリアや予算を少し広げると動きやすいかも。` };
  if (sourceId) {
    if (intro) {
      await pushText(client, sourceId, intro).catch(() => {});
    }
    return client.pushMessage(sourceId, flex).catch(() => {});
  }
}

async function runRestaurantSearchFlow({
  client,
  sourceId,
  actorName,
  caseId,
  keyword,
  capacity,
  budgetYen,
  strategy,
  assumptionNote,
}) {
  const shops = await searchRestaurants({ keyword, capacity, budgetYen: budgetYen || null });
  if (shops?.length) {
    await rememberSelectionCandidates(caseId, 'restaurant', normalizeRestaurantCandidates(shops));
    await logCaseEvent(caseId, 'restaurant_search', {
      actorName,
      keyword,
      count: shops.length,
      budgetYen: budgetYen || 0,
    });
  }
  const intro = strategy === 'concierge'
    ? '写真と情報が見やすい候補から先に寄せたよ。'
    : '';
  const flex = shops?.length
    ? buildRestaurantCarousel(shops, caseId)
    : { type: 'text', text: `条件に合うお店が見つからなかったよ。${assumptionNote ? `仮置きは ${assumptionNote}。` : ''}エリアや予算を少し広げると動きやすいかも。` };
  if (sourceId) {
    if (intro) {
      await pushText(client, sourceId, intro).catch(() => {});
    }
    return client.pushMessage(sourceId, flex).catch(() => {});
  }
}

async function findActiveSearchIntakeCase(sourceId, userId, awaitingOnly) {
  const cases = await getNoblesseCases(sourceId, 10);
  return cases.find(c => {
    if (!c || c.status === 'cancelled' || !c.searchIntake?.kind) return false;
    if (awaitingOnly) {
      return c.searchIntake.awaitingField
        && (!c.searchIntake.ownerUserId || c.searchIntake.ownerUserId === userId);
    }
    return true;
  }) || null;
}

function searchFieldLabel(field) {
  switch (field) {
    case 'keyword':
      return 'エリア';
    case 'checkinDate':
      return '日付';
    case 'adultNum':
    case 'partySize':
      return '人数';
    case 'budgetYen':
      return '予算';
    default:
      return field || '条件';
  }
}

function pickSearchKeyword(requestText, chosenText) {
  const hinted = extractKeywordHint(requestText || '');
  if (isSearchKeywordUsable(hinted)) return hinted;
  const requestKeyword = extractSearchKeyword(requestText || '');
  if (isSearchKeywordUsable(requestKeyword)) return requestKeyword;
  const hintedOption = extractKeywordHint(chosenText || '');
  if (isSearchKeywordUsable(hintedOption)) return hintedOption;
  const optionKeyword = extractSearchKeyword(chosenText || '');
  if (isSearchKeywordUsable(optionKeyword)) return optionKeyword;
  return String(requestText || chosenText || '').slice(0, 40);
}

function extractKeywordHint(text) {
  const tokens = String(text || '')
    .normalize('NFKC')
    .replace(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/g, ' ')
    .replace(/\d{1,2}[/-]\d{1,2}\s*[-〜~]\s*\d{1,2}[/-]\d{1,2}/g, ' ')
    .replace(/\d{1,2}[/-]\d{1,2}(?:[/-]\d{1,2})?/g, ' ')
    .replace(/\d+\s*(人|名|泊)/g, ' ')
    .replace(/([0-9]+(?:[.,][0-9]+)?)\s*(万円|万|円|k|K)/g, ' ')
    .replace(/(来週|再来週|今度|週末|平日|土日|日帰り|宿泊|旅行|ホテル|旅館|飲み会|飲みたい|食べたい|泊まりたい|予約|決めたい|探したい|探してほしい|してほしい|したい|行きたい|取りたい|とりたい|相談したい|どうすれば|どうしたら)/g, ' ')
    .replace(/[でにのへを、。,.!！?？]/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2 && token.length <= 12);
  return tokens.slice(0, 2).join(' ').trim();
}

function formatSearchStayLabel(searchIntake) {
  if (!searchIntake?.checkinDate) return '';
  return `${searchIntake.checkinDate}${searchIntake.checkoutDate ? `〜${searchIntake.checkoutDate}` : ''}`;
}

async function maybeHandleBookingAwaitingInput({ event, client, sourceId, userId, senderName, text }) {
  if (!sourceId || sourceId === 'unknown' || !userId || !String(text || '').trim()) return null;
  const caseData = await findActiveBookingCase(sourceId, userId, true);
  const bookingForm = getBookingForm(caseData);
  if (!caseData || !bookingForm?.awaitingField) return null;
  return handleBookingFieldUpdate({
    client,
    event,
    caseId: caseData.caseId,
    caseData,
    actorName: senderName || '',
    userId,
    field: bookingForm.awaitingField,
    rawValue: text,
  });
}

async function handleBookingTextIntent({ event, client, sourceId, userId, senderName, intent }) {
  const caseData = await findActiveBookingCase(sourceId, userId, false);
  if (!caseData) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '先にノブレスでお店かホテルを選んでくれる？ そこから予約情報を集めるね。',
    });
  }
  const bookingForm = getBookingForm(caseData);
  if (!bookingForm) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'この案件にはまだ予約対象がないみたい。お店かホテルを決めてから続けようか。',
    });
  }

  if (intent.action === 'start') {
    const nextField = getNextBookingField(bookingForm);
    const updated = await updateBookingForm(caseData.caseId, {
      awaitingField: nextField,
      ownerUserId: userId || bookingForm.ownerUserId || '',
      ownerName: senderName || bookingForm.ownerName || '',
      status: nextField ? 'collecting' : 'complete',
    });
    return replyBookingFormFlow(client, event, caseData.caseId, updated?.bookingForm || { ...bookingForm, awaitingField: nextField });
  }

  if (intent.action === 'summary') {
    if (isBookingFormComplete(bookingForm)) {
      return client.replyMessage(event.replyToken, [
        { type: 'text', text: buildBookingSummaryText(caseData.caseId, bookingForm) },
        buildBookingReadyFlex(caseData.caseId, bookingForm),
      ]);
    }
    return replyBookingFormFlow(client, event, caseData.caseId, bookingForm);
  }

  return handleBookingFieldUpdate({
    client,
    event,
    caseId: caseData.caseId,
    caseData,
    actorName: senderName || '',
    userId,
    field: intent.field,
    rawValue: intent.value,
  });
}

async function handleBookingFieldUpdate({ client, event, caseId, caseData, actorName, userId, field, rawValue }) {
  const bookingForm = getBookingForm(caseData);
  if (!bookingForm) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '予約情報の土台がまだないみたい。先にお店かホテルを選ぼうか。',
    });
  }
  const parsed = applyBookingFieldInput(field, rawValue, new Date(event.timestamp || Date.now()));
  if (!parsed.ok) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: parsed.error,
    });
  }
  const merged = {
    ...bookingForm,
    [field]: parsed.value,
    ownerUserId: userId || bookingForm.ownerUserId || '',
    ownerName: actorName || bookingForm.ownerName || '',
  };
  const nextField = getNextBookingField(merged);
  merged.awaitingField = nextField;
  merged.status = nextField ? 'collecting' : 'complete';
  const updated = await updateBookingForm(caseId, merged);
  await logCaseEvent(caseId, 'booking_field_updated', {
    actorName,
    field: fieldLabel(field),
  });
  const current = updated?.bookingForm || merged;

  if (isBookingFormComplete(current)) {
    const bookingShare = buildBookingShareText(caseId, current);
    await rememberPreparedSend(caseId, {
      kind: 'decision',
      title: `${current.targetName || '予約内容'} の共有`,
      text: bookingShare,
      allowImmediateSend: true,
    });
    await logCaseEvent(caseId, 'booking_form_completed', { actorName });
    return client.replyMessage(event.replyToken, [
      { type: 'text', text: buildBookingSummaryText(caseId, current) },
      buildBookingReadyFlex(caseId, current),
    ]);
  }

  return client.replyMessage(event.replyToken, buildBookingStepMessages(caseId, current, field));
}

function buildBookingStepMessages(caseId, bookingForm, updatedField = '') {
  const prompt = buildBookingPrompt(caseId, bookingForm);
  const confirm = updatedField
    ? {
      type: 'text',
      text: `${fieldLabel(updatedField)}、入れておいたよ。`,
    }
    : null;
  return [confirm, prompt].filter(Boolean);
}

function replyBookingFormFlow(client, event, caseId, bookingForm) {
  if (isBookingFormComplete(bookingForm)) {
    return client.replyMessage(event.replyToken, [
      { type: 'text', text: buildBookingSummaryText(caseId, bookingForm) },
      buildBookingReadyFlex(caseId, bookingForm),
    ]);
  }
  return client.replyMessage(event.replyToken, [
    { type: 'text', text: buildBookingSummaryText(caseId, bookingForm) },
    buildBookingPrompt(caseId, bookingForm),
  ]);
}

async function findActiveBookingCase(sourceId, userId, awaitingOnly) {
  const cases = await getNoblesseCases(sourceId, 10);
  return cases.find(c => {
    if (!c || c.status === 'cancelled' || !c.bookingForm?.targetName) return false;
    if (awaitingOnly) {
      return c.bookingForm.awaitingField
        && (!c.bookingForm.ownerUserId || c.bookingForm.ownerUserId === userId);
    }
    return true;
  }) || null;
}

function fieldLabel(field) {
  switch (field) {
    case 'partySize':
      return '人数';
    case 'reservationDateTime':
      return '日時';
    case 'reserverName':
      return '予約名';
    case 'reserverPhone':
      return '電話';
    default:
      return field || '項目';
  }
}

function resolvePreparedSendTargets(caseData, sourceId) {
  const targets = [];
  const used = new Set();

  const addTarget = (kind, targetId, label, ackLabel) => {
    const normalizedId = String(targetId || '').trim();
    if (!normalizedId || used.has(normalizedId)) return;
    used.add(normalizedId);
    targets.push({ kind, targetId: normalizedId, label, ackLabel });
  };

  if (sourceId && sourceId !== 'unknown') {
    addTarget('current', sourceId, 'このトークへ送信', 'このトーク');
  }

  if (caseData?.userId) {
    const requesterName = caseData?.senderName ? `${caseData.senderName}さん` : '依頼者';
    addTarget('requester', caseData.userId, `${requesterName}に送信`, `${requesterName}の個人トーク`);
  }

  const adminUserId = String(process.env.LINE_ADMIN_USER_ID || '').trim();
  if (adminUserId) {
    addTarget('admin', adminUserId, '管理者に送信', '管理者の個人トーク');
  }

  return targets;
}

function getPreparedSendTarget(caseData, sourceId, kind) {
  const targets = resolvePreparedSendTargets(caseData, sourceId);
  return targets.find(target => target.kind === normalizePreparedSendTargetKind(kind)) || null;
}

function normalizePreparedSendTargetKind(kind) {
  const normalized = String(kind || 'current').trim().toLowerCase();
  if (normalized === 'source') return 'current';
  if (normalized === 'requester') return 'requester';
  if (normalized === 'admin') return 'admin';
  return 'current';
}

function buildPreparedSendMessages(caseId, prepared, caseData, target) {
  const intro = buildPreparedSendIntro(caseId, caseData, target);
  const messages = [];
  if (intro) messages.push({ type: 'text', text: intro });
  messages.push({ type: 'text', text: prepared.text });
  return messages;
}

function buildPreparedSendIntro(caseId, caseData, target) {
  if (!target || target.kind === 'current') return '';
  if (target.kind === 'requester') {
    return `ノブレス案件 ${caseId} の内容を送るね。`;
  }
  const requesterName = caseData?.senderName || '不明';
  return [
    `ノブレス案件 ${caseId} の共有だよ。`,
    `依頼者: ${requesterName}`,
  ].join('\n');
}

function formatPreparedSendFailure(target) {
  if (target?.kind === 'requester') {
    return '依頼者さんの個人トークには送れなかったの。Botと1対1でつながっているか、あとで確認してみて。';
  }
  if (target?.kind === 'admin') {
    return '管理者の個人トークには送れなかったの。LINE_ADMIN_USER_ID の設定か、Botとの接続状態を見てみて。';
  }
  return 'このトークへの送信で少しつまずいちゃった。もう一度だけ試してみて。';
}

// ── 誤送信→自己訂正パターン ──────────────────────────────────────────────
const MISSEND_FRAGMENTS = [
  'あ、',
  'ちょっと待って、',
  'なんか、',
  'えっと…',
  'ちょっと気になって',
];
const MISSEND_RECOVERIES = [
  'ごめん、変な送り方した。',
  'ごめん早まった。ちゃんと言い直すね。',
  '…さっきのは無視して。',
];

function maybeMissendSplit(text) {
  if (text.length < 16) return null; // 短すぎると不自然
  let hash = 0;
  for (let i = 0; i < Math.min(text.length, 16); i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  const bucket = Math.floor(Date.now() / (10 * 60 * 1000)); // 10分バケット
  const combined = Math.abs(hash + bucket);
  if (combined % 8 !== 0) return null; // ~12.5%
  const fragment = MISSEND_FRAGMENTS[combined % MISSEND_FRAGMENTS.length];
  const recovery = MISSEND_RECOVERIES[combined % MISSEND_RECOVERIES.length];
  return { first: fragment, second: `${recovery}\n${text}` };
}

function splitCasualReply(text) {
  const cleaned = String(text || '').trim();

  // ~12%の確率で誤送信→自己訂正パターン
  const missend = maybeMissendSplit(cleaned);
  if (missend) return missend;

  // 改行があれば1行目を「短い感情反応」、残りを「本文」として分割
  const byNewline = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
  if (byNewline.length >= 2) {
    return { first: byNewline[0], second: byNewline.slice(1).join('\n') };
  }

  // 改行なし: 文末記号で最初の1文を切り出す
  const sentences = cleaned.split(/(?<=[。！？])/).map(s => s.trim()).filter(Boolean);
  if (sentences.length >= 2) {
    return { first: sentences[0], second: sentences.slice(1).join('') };
  }

  return { first: cleaned, second: null };
}

async function sendCasualReply(client, event, replyText, sourceId) {
  // chatId には userId が必要（groupId は受け付けない LINE API 仕様）
  // fire-and-forget で replyToken をブロックしない
  const userId = event?.source?.userId;
  if (userId) showTypingIndicator(userId).catch(() => {});

  const typingDelay = 1200 + Math.floor(Math.random() * 800);
  await new Promise(r => setTimeout(r, typingDelay));

  const payload = typeof replyText === 'string'
    ? { text: replyText, quickReply: null }
    : {
      text: String(replyText?.text || ''),
      quickReply: replyText?.quickReply || null,
    };

  const { first, second } = splitCasualReply(payload.text);
  const firstMessage = { type: 'text', text: first };
  if (payload.quickReply?.items?.length) {
    firstMessage.quickReply = payload.quickReply;
  }
  await client.replyMessage(event.replyToken, firstMessage);

  if (second && sourceId) {
    const delayMs = 2000 + Math.floor(Math.random() * 1500);
    setTimeout(() => {
      client.pushMessage(sourceId, { type: 'text', text: second })
        .catch(err => console.error('[split-reply] push failed', err?.message || err));
    }, delayMs);
  }
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end',  () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

// ─── イベントリマインダー ──────────────────────────────────────────────────────

async function enrichReminderIntentWithContext(sourceId, intent) {
  if (!intent || !sourceId) return intent;
  const needsContext = !intent.title || intent.title === '予定';
  if (!needsContext) return intent;

  const recentConversation = await getRecentConversation(sourceId, 12).catch(() => []);
  const inferred = inferReminderHintFromConversation(recentConversation);
  if (!inferred) return intent;

  return {
    ...intent,
    title: inferred.title || intent.title,
    tags: [...new Set([...(intent.tags || []), ...(inferred.tags || [])])],
    participantCount: intent.participantCount || inferred.participantCount || null,
    detail: intent.detail || inferred.detail || '',
  };
}

async function handleEventReminderIntent({ event, client, sourceId, userId, senderName, intent }) {
  const enrichedIntent = await enrichReminderIntentWithContext(sourceId, intent);

  if (intent.action === 'list') {
    const reminders = await getEventReminders(sourceId).catch(() => []);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: formatReminderListReply(reminders),
    });
  }

  if (intent.action === 'cancel') {
    const cancelled = await cancelEventReminders(sourceId, null).catch(() => null);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: formatReminderCancelReply(cancelled),
    });
  }

  if (intent.action === 'missingTime') {
    if (enrichedIntent.dayPart) {
      return client.replyMessage(event.replyToken, buildReminderTimeChoiceMessage(enrichedIntent));
    }
    return client.replyMessage(event.replyToken, buildReminderTimeChoiceMessage(enrichedIntent));
  }

  if (intent.action === 'timeBranch') {
    return client.replyMessage(event.replyToken, buildReminderTimeChoiceMessage(enrichedIntent));
  }

  if (intent.action === 'set') {
    await saveEventReminder(sourceId, {
      title: enrichedIntent.title,
      hour: enrichedIntent.hour,
      minute: enrichedIntent.minute,
      dueAt: enrichedIntent.dueAt,
      reminderAt: enrichedIntent.reminderAt,
      advanceMin: enrichedIntent.advanceMin || 0,
      tags: enrichedIntent.tags || [],
      detail: enrichedIntent.detail || '',
      participantCount: enrichedIntent.participantCount || null,
      createdByName: senderName || '',
      createdBy: userId || '',
    });
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: formatReminderSetReply(enrichedIntent, senderName),
      quickReply: {
        items: [
          { type: 'action', action: { type: 'message', label: '一覧確認', text: 'リマインド一覧' } },
          { type: 'action', action: { type: 'message', label: 'キャンセル', text: 'リマインドキャンセル' } },
        ],
      },
    });
  }

  return null;
}

function buildNoblesseReminderPrompt(proposal, options = {}) {
  const isManagerContext = options.context === 'manager';
  const titlePrefix = proposal.participantCount
    ? `今夜${proposal.participantCount}人で「${proposal.title}」を`
    : `「${proposal.title}」を`;
  if (proposal.hasTime) {
    const h = proposal.time.hour;
    const m = proposal.time.minute;
    const timeLabel = `${h}:${String(m).padStart(2, '0')}`;
    const intro = isManagerContext
      ? `今夜の予定、${proposal.participantCount ? `${proposal.participantCount}人で` : ''}「${proposal.title}」が ${timeLabel} からなのね。`
      : `「${proposal.title}」が今夜 ${timeLabel} からなのね。`;
    return {
      type: 'text',
      text: [
        intro,
        proposal.detail || '',
        'リマインドも入れておく？ 何分前に声をかければいい？',
      ].filter(Boolean).join('\n'),
      quickReply: {
        items: [
          { type: 'action', action: { type: 'message', label: '1時間前', text: `${titlePrefix}${timeLabel}の1時間前にリマインドして` } },
          { type: 'action', action: { type: 'message', label: '30分前', text: `${titlePrefix}${timeLabel}の30分前にリマインドして` } },
          { type: 'action', action: { type: 'message', label: '15分前', text: `${titlePrefix}${timeLabel}の15分前にリマインドして` } },
          { type: 'action', action: { type: 'message', label: '開始時間に', text: `${titlePrefix}${timeLabel}にリマインドして` } },
          { type: 'action', action: { type: 'message', label: 'リマインド不要', text: 'リマインドはいいや' } },
        ],
      },
    };
  }
  return {
    type: 'text',
    text: [
      isManagerContext
        ? `${proposal.participantCount ? `${proposal.participantCount}人の` : ''}「${proposal.title}」ね、了解。`
        : `「${proposal.title}」ね、了解。`,
      proposal.detail || '',
      '開始時間を教えてくれたら、集合前にリマインドを入れておけるよ。',
      '例: 21時スタート / 20時30分集合',
    ].filter(Boolean).join('\n'),
    quickReply: {
      items: [
        { type: 'action', action: { type: 'message', label: 'リマインド不要', text: 'リマインドはいいや' } },
      ],
    },
  };
}

module.exports = { handle };
