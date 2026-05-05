'use strict';

const {
  calculateMonthlyStandings,
  calculateAnnualStandings,
  calculateMonthProgress,
} = require('./standings');
const { formatGemma4CouncilReply } = require('./ai-chat');

function detectCodexCouncilIntent(text) {
  const t = String(text || '').normalize('NFKC').replace(/\s+/g, '');
  if (!t) return null;
  if (/(Codex|codex|GPT-?5(\.5)?|gpt-?5(\.5)?|作戦会議|秘書会議|十人会議|10人会議|度肝|本気.*見せ|すごい.*見せ|ヤバい.*見せ|やばい.*見せ|全体.*分析|総合.*判断|全部.*見て.*次)/i.test(t)) {
    return { type: 'codexCouncil' };
  }
  return null;
}

function buildCodexCouncilMessages({
  year,
  month,
  senderName = '',
  isDirectChat = false,
  players = [],
  monthResults = {},
  yearResults = {},
  matchSchedule = null,
  recentConversation = [],
  reminders = [],
  wakeAlarm = null,
  ocrState = null,
  beastModeState = null,
  privateProfile = null,
} = {}) {
  const monthlyRows = safeArray(safeCall(() => calculateMonthlyStandings(players, monthResults), []));
  const annualRows = safeArray(safeCall(() => calculateAnnualStandings(players, yearResults), []));
  const progress = safeCall(() => calculateMonthProgress(players, monthResults, matchSchedule), null);
  const activeReminders = safeArray(reminders).filter(rem => rem?.status === 'active');
  const conversationSignals = extractConversationSignals(recentConversation);
  const decision = chooseDecision({
    monthlyRows,
    progress,
    activeReminders,
    wakeAlarm,
    ocrState,
    beastModeState,
    conversationSignals,
  });
  const privacyLine = isDirectChat
    ? buildPrivateProfileLine(privateProfile)
    : '本人用プロファイルはグループでは出さない。そこは会議でも満場一致で守る。';

  return [
    {
      type: 'text',
      text: buildExecutiveText({
        year,
        month,
        senderName,
        monthlyRows,
        annualRows,
        progress,
        activeReminders,
        wakeAlarm,
        ocrState,
        beastModeState,
        conversationSignals,
        privacyLine,
      }),
    },
    {
      type: 'text',
      text: buildMinutesText({
        monthlyRows,
        annualRows,
        progress,
        activeReminders,
        wakeAlarm,
        ocrState,
        beastModeState,
        conversationSignals,
        isDirectChat,
      }),
    },
    {
      type: 'text',
      text: buildResolutionText(decision),
      quickReply: buildCodexCouncilQuickReply(isDirectChat),
    },
  ];
}

async function buildCodexCouncilMessagesWithGemma4(options = {}) {
  const fixedMessages = buildCodexCouncilMessages(options);
  const aiContext = buildGemma4CouncilContext(options);
  const aiText = await formatGemma4CouncilReply(aiContext).catch(err => {
    console.error('[codex-council] Gemma4 council failed', err?.message || err);
    return null;
  });
  if (!aiText) return fixedMessages;
  return [
    {
      type: 'text',
      text: aiText,
    },
    ...fixedMessages,
  ].slice(0, 5);
}

function buildExecutiveText({
  year,
  month,
  senderName,
  monthlyRows,
  annualRows,
  progress,
  activeReminders,
  wakeAlarm,
  ocrState,
  beastModeState,
  conversationSignals,
  privacyLine,
}) {
  const caller = senderName ? `${senderName}、` : '';
  const leader = monthlyRows[0];
  const annualLeader = annualRows[0];
  const remaining = getRemainingMatches(progress);
  const lines = [
    `${caller}Codex作戦会議、10人で開いたよ。`,
    '今ある材料を横断して、次の一手まで議決するね。',
    '',
    '【現在地】',
    leader
      ? `今月首位: ${leader.name}さん / 試合Pt ${leader.matchPt} / 得失${formatSigned(leader.gd)}`
      : '今月順位: まだ結果が少ない。スクショ登録が最初の着火点。',
    annualLeader
      ? `年間先頭: ${annualLeader.name}さん / ${annualLeader.rankPt}pt`
      : '年間順位: まだ大きく動いていない。',
    progress
      ? `試合進捗: ${progress.done}/${progress.total} 完了 / 残り${remaining}試合`
      : '試合進捗: プレイヤー設定が足りず集計できない。',
    `リマインド: 稼働中${activeReminders.length}件${wakeAlarm?.status === 'active' ? ' / 起床セットあり' : ''}`,
    `OCR: ${ocrState?.autoEnabled === false ? '自動OFF。必要時に候補集計が安全。' : '自動ON。スクショが来たら通常処理。'}`,
    `ノブレス: ${beastModeState?.enabled ? 'ON。案件相談に入れる。' : 'OFF。必要なら起動してから深掘り。'}`,
    `会話の気配: ${conversationSignals.summary}`,
    privacyLine,
  ];
  return lines.join('\n');
}

function buildMinutesText({
  monthlyRows,
  annualRows,
  progress,
  activeReminders,
  wakeAlarm,
  ocrState,
  beastModeState,
  conversationSignals,
  isDirectChat,
}) {
  const leader = monthlyRows[0];
  const second = monthlyRows[1];
  const remaining = getRemainingMatches(progress);
  const gap = leader && second ? leader.matchPt - second.matchPt : null;
  const annualLeader = annualRows[0];
  const minutes = [
    ['トラペル子本人', '長文で終わらせず、押せる次アクションまで置くべき。'],
    ['ウイコレ進行係', remaining > 0 ? `残り${remaining}試合。未対戦整理が一番順位を動かす。` : '今月の試合はかなり埋まっている。名場面化が向いている。'],
    ['順位参謀', leader ? `${leader.name}さんが先頭${gap == null ? '。単独データを育てたい。' : `、2位と${gap}pt差。煽りどころあり。`}` : 'まだ順位の物語が始まっていない。'],
    ['年間監査', annualLeader ? `年間は${annualLeader.name}さんが${annualLeader.rankPt}pt。月末の順位Ptが大事。` : '年間Ptはまだ薄い。今月の着地で流れを作れる。'],
    ['会話分析官', conversationSignals.topics.length ? `拾った空気は「${conversationSignals.topics.join('」「')}」。ここを会話の種にできる。` : '直近会話はまだ薄め。作戦会議を起点に話題を作れる。'],
    ['リマインド係', activeReminders.length ? `登録済み${activeReminders.length}件。漏れ防止は動いている。` : '予定が決まったら即リマインド化したい。'],
    ['朝の生活秘書', wakeAlarm?.status === 'active' ? '起床セットあり。天気・通勤・ニュース連動を育てられる。' : '1対1なら起床セットが刺さる。朝の導線は強い。'],
    ['特売料理研究家', '近くのチラシとレシピは生活感が強い。遊び以外でも使う理由になる。'],
    ['システム監査役', `OCRは${ocrState?.autoEnabled === false ? 'OFF運用中。候補集計が安心。' : 'ON運用中。誤反応したらOFFへ切替。'} ノブレスは${beastModeState?.enabled ? 'ON' : 'OFF'}。`],
    ['プライバシー番人', isDirectChat ? '1対1なので本人向けの生活情報を使ってよい。' : 'グループなので本人プロファイルは出さない。'],
  ];

  return [
    '【10人会議 議事録】',
    ...minutes.map(([name, note], index) => `${index + 1}. ${name}: ${note}`),
  ].join('\n');
}

function buildResolutionText(decision) {
  return [
    '【議決結果】',
    `最優先: ${decision.title}`,
    decision.reason,
    '',
    '【実行案】',
    `1. ${decision.actions[0]}`,
    `2. ${decision.actions[1]}`,
    `3. ${decision.actions[2]}`,
    '',
    '下のボタンで、そのまま私にやらせて。',
  ].join('\n');
}

function chooseDecision({ monthlyRows, progress, activeReminders, wakeAlarm, ocrState, beastModeState, conversationSignals }) {
  const remaining = getRemainingMatches(progress);
  if (!monthlyRows.length) {
    return {
      title: '今月の最初の結果を登録して、物語を発火させる',
      reason: '順位も煽りも名場面も、最初のスクショが入ると一気に動くから。',
      actions: ['ウイコレの試合結果スクショを登録する', 'OCRが怖ければ自動OCR OFFで候補集計にする', '登録後に順位と未対戦を確認する'],
    };
  }
  if (remaining > 0) {
    return {
      title: '未対戦を埋めて、順位が動く夜を作る',
      reason: `今月はあと${remaining}試合分残っている。ここを埋めると首位争いも年間Ptも動く。`,
      actions: ['未対戦ペアを出す', '今夜やるならリマインドを入れる', '終わったスクショをまとめて登録する'],
    };
  }
  if (!activeReminders.length) {
    return {
      title: '次の集合を先に押さえて、抜け漏れを消す',
      reason: '試合が揃っている時ほど、次回の集合と月末の段取りを先に固定すると強い。',
      actions: ['次のクラブ戦や集合時間をリマインド登録する', '今月の名場面を匿名でまとめる', '来月の縛りルールを確認する'],
    };
  }
  if (!beastModeState?.enabled) {
    return {
      title: 'ノブレスモードを起動して、遊び以外の秘書力を見せる',
      reason: '予定・店・買い物・しおりに入ると、LINE Bot感を超えてくる。',
      actions: ['ノブレスモードをONにする', '近場のおでかけか買い物を相談する', '候補が出たらしおりにする'],
    };
  }
  if (ocrState?.autoEnabled === false) {
    return {
      title: '候補集計型OCRで、誤反応なしの集計に寄せる',
      reason: '自動OCR OFF中なら、必要な時だけスクショ候補をまとめて集計できる。',
      actions: ['OCR候補を確認する', '集計してと呼んで今日の候補を処理する', '順位と未対戦を確認する'],
    };
  }
  if (wakeAlarm?.status !== 'active') {
    return {
      title: '1対1の起床セットを入れて、生活秘書として刺しに行く',
      reason: '天気、通勤、ニュース、レシピが朝にまとまると、毎日使う理由になる。',
      actions: ['1対1で平日毎朝6時半に起こしてと送る', '起床ニュースの種類を選ぶ', '起床レシピをほしいにする'],
    };
  }
  return {
    title: conversationSignals.topics.length ? '会話の熱を拾って、次の企画へ変換する' : '現在の全機能を横断して、次の遊びを組む',
    reason: '順位・予定・生活情報が揃っているので、今は会話から企画へつなぐのが一番強い。',
    actions: ['直近会話をまとめる', 'ノブレスでおでかけか店選びに進む', '月間名場面を匿名でまとめる'],
  };
}

function buildCodexCouncilQuickReply(isDirectChat) {
  const p = isDirectChat ? '' : '@秘書トラペル子 ';
  return {
    items: [
      { type: 'action', action: { type: 'message', label: '順位', text: `${p}順位` } },
      { type: 'action', action: { type: 'message', label: '未対戦', text: `${p}未対戦` } },
      { type: 'action', action: { type: 'message', label: 'リマインド一覧', text: `${p}リマインド一覧` } },
      { type: 'action', action: { type: 'message', label: '近くのチラシ', text: `${p}近くのチラシ` } },
      { type: 'action', action: { type: 'message', label: 'ノブレス', text: `${p}ノブレスモード` } },
      { type: 'action', action: { type: 'message', label: 'システム', text: `${p}システム` } },
    ],
  };
}

function extractConversationSignals(recentConversation) {
  const messages = safeArray(recentConversation)
    .map(message => String(message?.text || '').normalize('NFKC'))
    .filter(Boolean);
  if (!messages.length) {
    return { summary: 'まだ拾える直近会話は少なめ', topics: [] };
  }
  const joined = messages.join(' ');
  const topics = [
    [/ウイコレ|クラブ戦|ハード|試合|順位|未対戦/, 'ウイコレ'],
    [/ジオゲーム|場所当て|回答/, 'ジオゲーム'],
    [/ノブレス|予約|宿|旅行|店|しおり|おでかけ/, 'ノブレス'],
    [/チラシ|特売|レシピ|スーパー|材料|価格/, '特売レシピ'],
    [/起こして|起床|朝|天気|電車|通勤/, '朝の秘書'],
    [/システム|Render|レンダー|Firebase|GitHub|ギットハブ|課金|無料枠/, 'システム'],
    [/AI|Codex|GPT|Claude|MCP/, 'AI開発'],
  ]
    .filter(([pattern]) => pattern.test(joined))
    .map(([, label]) => label)
    .slice(0, 4);
  const speakerCount = new Set(safeArray(recentConversation).map(m => String(m?.senderName || '').trim()).filter(Boolean)).size;
  const summary = topics.length
    ? `${speakerCount || 1}人分の会話から、${topics.join('、')}の気配`
    : `${messages.length}件の会話あり。まだ強いテーマは薄め`;
  return { summary, topics };
}

function buildPrivateProfileLine(profile) {
  if (!profile) {
    return '1対1だけど本人用プロファイルはまだ薄め。プロフィール設定を足すともっと刺さる。';
  }
  const hints = [
    profile.defaultWakePlace ? `朝の基準地点あり` : '',
    profile.commuteMode ? `通勤手段あり` : '',
    profile.commuteRouteText || profile.roadRouteText ? `通勤ルートあり` : '',
  ].filter(Boolean);
  return hints.length
    ? `本人用プロファイル: ${hints.join(' / ')}。ここは1対1だけで使う。`
    : '本人用プロファイルはあるけど、朝の場所や通勤手段を足すともっと賢くなる。';
}

function buildGemma4CouncilContext({
  year,
  month,
  senderName = '',
  isDirectChat = false,
  players = [],
  monthResults = {},
  yearResults = {},
  matchSchedule = null,
  recentConversation = [],
  reminders = [],
  wakeAlarm = null,
  ocrState = null,
  beastModeState = null,
  privateProfile = null,
} = {}) {
  const monthlyRows = safeArray(safeCall(() => calculateMonthlyStandings(players, monthResults), []));
  const annualRows = safeArray(safeCall(() => calculateAnnualStandings(players, yearResults), []));
  const progress = safeCall(() => calculateMonthProgress(players, monthResults, matchSchedule), null);
  const conversationSignals = extractConversationSignals(recentConversation);
  const activeReminders = safeArray(reminders).filter(rem => rem?.status === 'active');
  return {
    feature: 'Gemma4自由会話型作戦会議',
    year,
    month,
    caller: senderName || '',
    privacyScope: isDirectChat ? 'direct_chat' : 'group_chat',
    privacyRule: isDirectChat
      ? '本人向け要約だけ使ってよい。生のプロフィール全文は出さない。'
      : 'グループなので本人用プロファイルや生活情報を出さない。',
    monthlyStandingsTop: monthlyRows.slice(0, 5).map(row => ({
      rank: row.rank,
      name: row.name,
      matchPt: row.matchPt,
      rankPt: row.rankPt,
      wins: row.w,
      pkWins: row.pkw,
      draws: row.d,
      losses: row.l,
      goalDiff: row.gd,
    })),
    annualStandingsTop: annualRows.slice(0, 5).map(row => ({
      rank: row.rank,
      name: row.name,
      rankPt: row.rankPt,
    })),
    progress: progress ? {
      total: progress.total,
      done: progress.done,
      remaining: getRemainingMatches(progress),
      notStarted: safeArray(progress.notStarted).slice(0, 8).map(([a, b, target]) => ({ a, b, remaining: target })),
      half: safeArray(progress.half).slice(0, 8).map(([a, b, count, target]) => ({ a, b, done: count, target })),
      targetMatchesPerPair: progress.targetMatchesPerPair,
    } : null,
    reminders: activeReminders.slice(0, 8).map(rem => ({
      title: rem.title || '',
      detail: rem.detail || '',
      reminderAt: rem.reminderAt || rem.dueAt || null,
      tags: safeArray(rem.tags).slice(0, 4),
    })),
    wakeAlarm: wakeAlarm?.status === 'active' ? {
      active: true,
      hour: wakeAlarm.hour,
      minute: wakeAlarm.minute,
      recurring: wakeAlarm.recurring === true,
      weekdayOnly: wakeAlarm.weekdayOnly === true,
      newsMode: wakeAlarm.newsMode || '',
      recipeMode: wakeAlarm.recipeMode || '',
      commuteMode: wakeAlarm.commuteMode || '',
    } : { active: false },
    ocr: {
      autoEnabled: ocrState?.autoEnabled !== false,
    },
    noblesse: {
      enabled: beastModeState?.enabled === true,
    },
    conversation: {
      summary: conversationSignals.summary,
      topics: conversationSignals.topics,
      recent: safeArray(recentConversation).slice(-14).map(message => ({
        senderName: message?.senderName || '',
        text: String(message?.text || '').slice(0, 120),
      })),
    },
    directProfileSummary: isDirectChat ? summarizePrivateProfileForAi(privateProfile) : null,
  };
}

function summarizePrivateProfileForAi(profile) {
  if (!profile) return null;
  return {
    hasDefaultWakePlace: !!profile.defaultWakePlace,
    commuteMode: profile.commuteMode || '',
    hasCommuteRoute: !!(profile.commuteRouteText || profile.roadRouteText),
    summaryLines: safeArray(profile.summaryLines).slice(0, 3),
  };
}

function getRemainingMatches(progress) {
  if (!progress) return 0;
  return Math.max(0, Number(progress.total || 0) - Number(progress.done || 0));
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeCall(fn, fallback) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

function formatSigned(value) {
  const n = Number(value) || 0;
  return n > 0 ? `+${n}` : String(n);
}

module.exports = {
  detectCodexCouncilIntent,
  buildCodexCouncilMessages,
  buildCodexCouncilMessagesWithGemma4,
};
