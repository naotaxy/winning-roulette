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
  saveScreenshotCandidate,
  updateScreenshotCandidate,
  getScreenshotCandidates,
  getMemberProfile,
} = require('./firebase-admin');
const { resolveRealName, autoUpdateMemo, formatProfileForContext } = require('./member-profile');
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
const { getSecretaryMentionInfo, getCasualReply, getCasualReplyWithContext, getTiredReply } = require('./secretary-chat');
const { detectSystemStatusKind, safeFormatSystemStatusReply } = require('./system-status');
const { detectBillingRiskIntent, formatBillingRiskReply } = require('./billing-risk');
const { formatMemberFlavorReply, formatAnonymousDiaryHighlights } = require('./group-insights');
const { detectGeoGameIntent, handleGeoGameIntent } = require('./geo-game');
const { detectDiceGameIntent, formatDiceGameReply } = require('./dice-games');
const { detectOcrControlIntent } = require('./ocr-control');
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

const DEFAULT_BATCH_OCR_MAX_IMAGES = 20;
const BATCH_PROCESSING_STALE_MS = 10 * 60 * 1000;

async function handle(event, client) {
  /* ── 画像メッセージ → OCR → 確認FlexMessage ── */
  if (event.type === 'message' && event.message.type === 'image') {
    return handleImage(event, client);
  }

  if (event.type === 'message' && event.message.type === 'text') {
    return handleText(event, client);
  }

  /* ── Postback（OK / キャンセル） ── */
  if (event.type === 'postback') {
    return handlePostback(event, client);
  }
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

  // Firebase に実名登録があれば優先する
  return resolveRealName(userId, lineName);
}

function withTimeout(promise, timeoutMs, fallback) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

async function handleText(event, client) {
  const text = event.message.text || '';
  const sourceId = event.source.groupId || event.source.roomId || event.source.userId || 'unknown';

  const senderName = await getSenderName(event, client, null);

  // 全メッセージを会話メモリに保存（話者名付き）
  saveConversationMessage(sourceId, senderName, text).catch(() => {});

  const intent = detectTextIntent(text);
  if (!intent) return;

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

  if (intent === 'noblesse') {
    const { withoutMention } = getSecretaryMentionInfo(text);
    const replyText = await formatNoblesseReply(withoutMention, senderName);
    return sendCasualReply(client, event, replyText, sourceId);
  }

  if (intent === 'casual') {
    const userId = event.source?.userId;
    const aiEnabled = shouldUseAiChat();
    const recentConversation = sourceId ? await getRecentConversation(sourceId, 15) : [];

    // メモを非同期で自動更新（返信をブロックしない）
    autoUpdateMemo(userId, senderName, recentConversation).catch(() => {});

    const aiReply = aiEnabled
      ? await formatAiChatReply(text, await buildAiConversationContext(year, month, senderName, sourceId, userId))
      : null;
    let replyText;
    if (aiReply) {
      replyText = aiReply;
    } else if (aiEnabled) {
      replyText = getTiredReply();
    } else {
      replyText = getCasualReplyWithContext(text, recentConversation, senderName);
    }
    return sendCasualReply(client, event, replyText, sourceId);
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
    const [monthResults, yearResults, diaries, recentConversation, senderProfile] = await Promise.all([
      getMonthResults(year, month),
      getYearResults(year),
      getRecentDiaries(3),
      sourceId ? getRecentConversation(sourceId, 20) : Promise.resolve([]),
      userId ? getMemberProfile(userId) : Promise.resolve(null),
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

function detectTextIntent(text) {
  const { compact, mentioned, withoutMention } = getSecretaryMentionInfo(text);
  if (!compact) return null;
  if (!mentioned) return null;

  if (!withoutMention || /(ヘルプ|help|使い方|何できる|なにできる|できること|ワード|一覧)/.test(withoutMention)) return 'help';
  if (/(まとめて|要約|最近の会話|会話まとめ|何話してた|なに話してた|みんな何|みんな何言)/.test(withoutMention)) return 'summary';
  const directSystemStatusKind = detectSystemStatusKind(withoutMention);
  if (directSystemStatusKind) return `system:${directSystemStatusKind}`;

  const targetText = withoutMention;

  const geoGameIntent = detectGeoGameIntent(targetText);
  if (geoGameIntent) return geoGameIntent;

  const diceGameIntent = detectDiceGameIntent(targetText);
  if (diceGameIntent) return diceGameIntent;

  const ocrControlIntent = detectOcrControlIntent(targetText);
  if (ocrControlIntent) return ocrControlIntent;

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

  if (/(状況|戦況|成績|調子|まとめ|誰が強い|だれが強い|勝ってる)/.test(targetText)) return 'status';

  if (detectNoblesseIntent(targetText)) return 'noblesse';

  return 'casual';
}

async function handlePostback(event, client) {
  const data = event.postback.data;

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

  const { first, second } = splitCasualReply(replyText);
  await client.replyMessage(event.replyToken, { type: 'text', text: first });

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

module.exports = { handle };
