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
} = require('./firebase-admin');
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
const { detectSystemStatusKind, formatSystemStatusReply } = require('./system-status');
const { detectBillingRiskIntent, formatBillingRiskReply } = require('./billing-risk');
const { formatMemberFlavorReply, formatAnonymousDiaryHighlights } = require('./group-insights');
const { detectGeoGameIntent, handleGeoGameIntent } = require('./geo-game');
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
    if (queued.skipped) return;
    ocrResult = queued.value;
  } catch (err) {
    console.error('[webhook] OCR failed', err);
    return sendImageResponse(event, client, {
      type: 'text',
      text: 'ごめんね、うまく読み取れなかったの。\nあなたの試合、ちゃんと受け取りたかったから少し悔しいな。\nアプリから入れてくれたら、私が大事に預かるね。\nhttps://naotaxy.github.io/winning-roulette/',
    });
  }

  const ocrClass = classifyOcrResult(ocrResult);
  if (!ocrClass.isMaybeMatch) {
    console.log(`[webhook] ignored non-uicolle image msgId=${msgId} scores=${ocrClass.hasScores} matchedTeams=${ocrClass.matchedTeams}`);
    return;
  }
  if (!ocrClass.isCompleteMatch) {
    console.log(`[webhook] uicolle-like image incomplete msgId=${msgId} scores=${ocrClass.hasScores} matchedTeams=${ocrClass.matchedTeams}`);
    return sendImageResponse(event, client, {
      type: 'text',
      text: '試合結果っぽいところまでは見えたんだけど、チーム名かスコアを片方見失っちゃった。\nもう一回送って。次はちゃんと見つけたいの。',
    });
  }

  /* 送信者の表示名を取得（addedBy用） */
  const senderName = await getSenderName(event, client, '(LINE bot)');

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
  return sendImageResponse(event, client, flex);
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

  try {
    let profile;
    if (event.source.groupId && typeof client.getGroupMemberProfile === 'function') {
      profile = await client.getGroupMemberProfile(event.source.groupId, userId);
    } else if (event.source.roomId && typeof client.getRoomMemberProfile === 'function') {
      profile = await client.getRoomMemberProfile(event.source.roomId, userId);
    } else {
      profile = await client.getProfile(userId);
    }
    return profile?.displayName || fallback;
  } catch (_) {
    try {
      const profile = await client.getProfile(userId);
      return profile?.displayName || fallback;
    } catch (_) {
      return fallback;
    }
  }
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
    return handleGeoGameIntent({ event, client, sourceId, senderName, intent });
  }

  if (intent === 'casual') {
    const aiEnabled = shouldUseAiChat();
    const aiReply = aiEnabled
      ? await formatAiChatReply(text, await buildAiConversationContext(year, month, senderName, sourceId))
      : null;
    let replyText;
    if (aiReply) {
      replyText = aiReply;
    } else if (aiEnabled) {
      replyText = getTiredReply();
    } else {
      const recentConversation = sourceId ? await getRecentConversation(sourceId, 15) : [];
      replyText = getCasualReplyWithContext(text, recentConversation, senderName);
    }
    return client.replyMessage(event.replyToken, { type: 'text', text: replyText });
  }

  if (intent.startsWith('system:')) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: await formatSystemStatusReply(intent.replace('system:', '')),
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

async function buildAiConversationContext(year, month, senderName = null, sourceId = null) {
  try {
    const players = await getPlayers();
    const [monthResults, yearResults, diaries, recentConversation] = await Promise.all([
      getMonthResults(year, month),
      getYearResults(year),
      getRecentDiaries(3),
      sourceId ? getRecentConversation(sourceId, 20) : Promise.resolve([]),
    ]);
    const monthlyRows = calculateMonthlyStandings(players, monthResults);
    const annualRows = calculateAnnualStandings(players, yearResults);
    const playerNames = (Array.isArray(players) ? players : Object.values(players || {}))
      .map(p => p?.name)
      .filter(Boolean);
    return {
      year,
      month,
      senderName,
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
    return { year, month, senderName };
  }
}

function detectTextIntent(text) {
  const { compact, mentioned, withoutMention } = getSecretaryMentionInfo(text);
  if (!compact) return null;
  if (!mentioned) return null;

  if (!withoutMention || /(ヘルプ|help|使い方|何できる|なにできる|できること|ワード|一覧)/.test(withoutMention)) return 'help';
  if (/(まとめて|要約|最近の会話|会話まとめ|何話してた|なに話してた|みんな何|みんな何言)/.test(withoutMention)) return 'summary';

  const targetText = withoutMention;

  const geoGameIntent = detectGeoGameIntent(targetText);
  if (geoGameIntent) return geoGameIntent;

  if (detectBillingRiskIntent(targetText)) return 'billing';

  const uicolleKind = detectUicolleIntent(targetText);
  if (uicolleKind) return `uicolle:${uicolleKind}`;
  if (/(今のイベント|開催中のイベント|今のガチャ|開催中.*ガチャ|ガチャ.*今|最新情報|ウイコレ.*情報)/.test(targetText)) return 'uicolle:news';
  if (/(名場面|名シーン|ハイライト|月間まとめ|今月まとめ|日記連動|日記.*名場面|日記.*ハイライト)/.test(targetText)) return 'monthlyHighlights';
  if (/(口癖|因縁|相性|ライバル|メンバー.*煽|みんな.*煽|各メンバー|人物メモ|メンバー分析|キャラ分析)/.test(targetText)) return 'memberFlavor';
  if (/(未対戦|未消化ペア|あと誰.*誰|誰と誰|対戦.*残|残り.*対戦|対戦残り|やってない.*ペア)/.test(targetText)) return 'missingMatchups';
  if (/(日記|読んで|ブログ|最近書いた|最新の日記|何書いた)/.test(targetText)) return 'diary';

  const systemStatusKind = detectSystemStatusKind(targetText);
  if (systemStatusKind) return `system:${systemStatusKind}`;

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
  return 'casual';

  return null;
}

async function handlePostback(event, client) {
  const data = event.postback.data;

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

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end',  () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

module.exports = { handle };
