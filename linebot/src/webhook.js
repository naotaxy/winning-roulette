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
} = require('./firebase-admin');
const { buildConfirmFlex, buildCompleteFlex } = require('./flex-message');
const { getTokyoDateParts, shiftMonth } = require('./date-utils');
const { inspectImage, looksLikePhoneScreenshot, classifyOcrResult } = require('./image-guard');
const {
  calculateMonthlyStandings,
  calculateAnnualStandings,
  formatMonthlyStandings,
  formatAnnualStandings,
  formatSecretaryStatus,
} = require('./standings');
const { formatRuleReply } = require('./rule-message');
const { formatSecretaryHelp } = require('./help-message');
const { getSecretaryMentionInfo, getCasualReply } = require('./secretary-chat');
const { detectSystemStatusKind, formatSystemStatusReply } = require('./system-status');

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
    ocrResult = await parseMatchResult(buffer, playerMap);
  } catch (err) {
    console.error('[webhook] OCR failed', err);
    return client.replyMessage(event.replyToken, {
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
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '試合結果っぽいところまでは見えたんだけど、チーム名かスコアを片方見失っちゃった。\nもう一回送って。次はちゃんと見つけたいの。',
    });
  }

  /* 送信者の表示名を取得（addedBy用） */
  let senderName = '(LINE bot)';
  try {
    const profile = await client.getProfile(event.source.userId);
    senderName = profile.displayName;
  } catch(_) {}

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
  return client.replyMessage(event.replyToken, flex);
}

async function handleText(event, client) {
  const intent = detectTextIntent(event.message.text || '');
  if (!intent) return;

  const { year, month } = getTokyoDateParts();

  if (intent === 'help') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: formatSecretaryHelp(),
    });
  }

  if (intent === 'casual') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: getCasualReply(event.message.text || ''),
    });
  }

  if (intent.startsWith('system:')) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: await formatSystemStatusReply(intent.replace('system:', '')),
    });
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

function detectTextIntent(text) {
  const { compact, mentioned, withoutMention } = getSecretaryMentionInfo(text);
  if (!compact) return null;

  if (mentioned && (!withoutMention || /(ヘルプ|help|使い方|何できる|なにできる|できること|ワード|一覧)/.test(withoutMention))) return 'help';

  const targetText = mentioned ? withoutMention : compact;

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

  if (/(状況|戦況|成績|調子|まとめ|誰が強い|だれが強い|勝ってる)/.test(targetText)) return 'status';
  if (!mentioned && /(秘書|bot|ぼっと|ウイコレちゃん|お話|話そ|相談)/.test(targetText)) return 'status';
  if (mentioned) return 'casual';

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
