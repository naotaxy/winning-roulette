'use strict';

const { detectDayPart } = require('./time-choice');

// ─── 検出 ───────────────────────────────────────────────────────────────────

function detectReminderIntent(text) {
  const t = normalize(text);
  if (!t) return null;

  if (/(リマインド.*(キャンセル|消して|削除|やめ|外して|いいや|不要|なし|けっこう)|通知.*(やめ|消して|キャンセル|外して|いいや|不要))/.test(t)) {
    return { type: 'eventReminder', action: 'cancel' };
  }
  if (/(リマインド.*(確認|状態|一覧|何|見せ|どんな|入って)|通知.*(確認|一覧|何時|見せ|入って))/.test(t)) {
    return { type: 'eventReminder', action: 'list' };
  }
  if (!/(リマインド|通知して|通知お願い|知らせて|声かけて|声かけ)/.test(t)) return null;

  const time = parseHourMinute(t);
  if (!time) {
    const title = extractReminderTitle(text);
    const dayPart = detectDayPart(t);
    if (dayPart) {
      return { type: 'eventReminder', action: 'timeBranch', title: title || '予定', dayPart, tags: extractTags(t) };
    }
    return { type: 'eventReminder', action: 'missingTime', title: title || '予定', tags: extractTags(t) };
  }

  const advanceMin = extractAdvanceMinutes(t);
  const dueAt = buildDueAt(time.hour, time.minute);
  const reminderAt = advanceMin ? dueAt - advanceMin * 60 * 1000 : dueAt;
  const title = extractReminderTitle(text);
  const tags = extractTags(t);
  const participantCount = extractParticipantCount(t);
  const detail = buildReminderDetail(text, title, tags, participantCount);

  return {
    type: 'eventReminder',
    action: 'set',
    title: title || '予定',
    hour: time.hour,
    minute: time.minute,
    dueAt,
    reminderAt,
    advanceMin: advanceMin || 0,
    tags,
    detail,
    participantCount,
  };
}

function detectReminderSuggestionIntent(text) {
  const t = normalize(text);
  if (!t) return null;
  if (detectReminderIntent(text)) return null;
  if (!detectNoblesseReminderHint(text)) return null;
  if (!/(決まった|やる|開催|集合|スタート|始める|今夜|今日|本日|ハード|ノーマル|クラブ戦)/.test(t)) return null;
  return {
    type: 'eventReminderSuggest',
    proposal: buildNoblesseReminderProposal(text),
  };
}

// ─── フォーマット ─────────────────────────────────────────────────────────────

function formatReminderSetReply(intent, senderName) {
  const when = formatJst(intent.reminderAt);
  const advLabel = intent.advanceMin ? `（${intent.title}の${intent.advanceMin}分前）` : '';
  const lines = [
    senderName ? `${senderName}さん、了解だよ。` : '了解だよ。',
    `${when}${advLabel}に「${intent.title}」をリマインドするね。`,
    '通知の仕組み上1〜5分くらい前後することはあるけど、ちゃんと声をかけに来るよ。',
  ];
  if (intent.detail) {
    lines.push(intent.detail);
  }
  if (intent.tags.includes('uicolle')) {
    lines.push('ウイコレの段取りは私が静かに預かっておくね。');
  }
  return lines.join('\n');
}

function formatReminderListReply(reminders, wakeAlarm = null, options = {}) {
  const active = (reminders || []).filter(r => r.status === 'active');
  const wakeSection = String(options.wakeSection || '').trim();
  const totalCount = active.length + (wakeSection ? 1 : 0);
  if (!totalCount) {
    return [
      'リマインドは今は何も入ってないよ。',
      '「〇〇を△時にリマインドして」で予定を足せるし、1対1なら「7時に起こして」で起床セットも入れられるよ。',
    ].join('\n');
  }
  const lines = [`リマインド一覧（${totalCount}件）`];
  for (const r of active) {
    const detail = r.detail ? ` (${String(r.detail).replace(/^補足:\s*/, '')})` : '';
    lines.push(`• ${formatJst(r.reminderAt)} — ${r.title}${detail}`);
  }
  if (wakeSection) {
    lines.push(wakeSection);
  }
  lines.push('');
  lines.push('「リマインドキャンセル」で予定リマインドを外せるよ。起床セットは「起床状態」「起こすのやめて」で確認や解除ができるの。');
  return lines.join('\n');
}

function formatReminderCancelReply(cancelled) {
  if (!cancelled) return '消せるリマインドが見つからなかったよ。';
  return `「${cancelled.title}」のリマインドを外したよ。`;
}

function formatReminderPushText(reminder) {
  const tag = reminder.tags?.includes('uicolle') ? '🎮' : '📅';
  const lines = [
    `${tag} リマインドだよ！`,
    `「${reminder.title}」の時間が近づいてきたよ。`,
  ];
  if (reminder.detail) lines.push(reminder.detail);
  if (reminder.tags?.includes('uicolle')) {
    lines.push('');
    if (reminder.participantCount) {
      lines.push(`今夜は${reminder.participantCount}人の段取り、抜けないようにね。秘書はちゃんと見送ってるよ。`);
    } else {
      lines.push('クラブ戦、全力で行ってきてね。秘書は応援してるよ。');
    }
  }
  return lines.join('\n');
}

function formatReminderMissingTimeReply(intent) {
  const titlePart = intent?.title ? `「${intent.title}」` : 'その予定';
  return [
    `${titlePart}のリマインド、何時に送ればいい？`,
    '例: 21時 / 20時30分 / 集合30分前に知らせて',
  ].join('\n');
}

function inferReminderHintFromConversation(messages = []) {
  const recent = Array.isArray(messages) ? messages.slice(-10).reverse() : [];
  for (const item of recent) {
    const rawText = String(item?.text || '').trim();
    const text = normalize(rawText);
    if (!text || /^@?秘書/.test(rawText)) continue;

    if (detectNoblesseReminderHint(text)) {
      return buildNoblesseReminderProposal(rawText);
    }

    const title = inferGenericReminderTitle(rawText);
    if (title) {
      return {
        title,
        tags: extractTags(text),
        participantCount: extractParticipantCount(text),
        detail: buildReminderDetail(rawText, title, extractTags(text), extractParticipantCount(text)),
      };
    }
  }
  return null;
}

function inferGenericReminderTitle(text) {
  const normalized = normalize(text);
  if (/(飲み会|飲み|会食|ご飯)/.test(normalized)) return '飲み会';
  if (/(打ち合わせ|会議|ミーティング|mtg)/.test(normalized)) return '打ち合わせ';
  if (/(旅行|出発|集合)/.test(normalized)) return '移動予定';
  if (/(病院|診察)/.test(normalized)) return '通院';
  return '';
}

// ─── Noblesse用 ─────────────────────────────────────────────────────────────

function detectNoblesseReminderHint(text) {
  const t = normalize(text);
  // ウイコレ系の集合イベントを検知
  return (
    /(今夜|今日|本日).*(ウイコレ|クラブ戦|対戦|集合|やる|開催)/.test(t) ||
    /(ウイコレ|クラブ戦).*(今夜|今日|今から|スタート|始める|やる)/.test(t) ||
    /(集合|スタート|開始).*(何時|時間|リマインド)/.test(t) ||
    /(ウイコレ|クラブ戦).*(決まった|予定|今夜|ハード|ノーマル)/.test(t)
  );
}

function buildNoblesseReminderProposal(text) {
  const t = normalize(text);
  const time = parseHourMinute(t);
  const tags = extractTags(t);
  const title = extractReminderTitle(text) || 'ウイコレ クラブ戦';
  const participantCount = extractParticipantCount(t);
  const detail = buildReminderDetail(text, title, tags, participantCount);
  return {
    title,
    time,
    tags,
    hasTime: !!time,
    participantCount,
    detail,
  };
}

// ─── ユーティリティ ────────────────────────────────────────────────────────────

function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseHourMinute(t) {
  const colon = t.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  if (colon) return { hour: Number(colon[1]), minute: Number(colon[2]) };
  const half = t.match(/(\d{1,2})\s*時\s*半/);
  if (half) return { hour: Number(half[1]), minute: 30 };
  const hm = t.match(/(\d{1,2})\s*時(?:\s*(\d{1,2})\s*分?)?/);
  if (hm) return { hour: Number(hm[1]), minute: hm[2] ? Number(hm[2]) : 0 };
  return null;
}

function extractAdvanceMinutes(t) {
  const m = t.match(/(\d+)\s*分前/);
  if (m) return Number(m[1]);
  const h = t.match(/(\d+)\s*時間前/);
  if (h) return Number(h[1]) * 60;
  if (/直前/.test(t)) return 10;
  if (/少し前/.test(t)) return 15;
  return 0;
}

function extractReminderTitle(text) {
  const t = normalize(text);
  // ウイコレ関連
  if (/(ウイコレ|uicolle)/i.test(t)) {
    const parts = [];
    if (/(クラブ戦|clubbattle)/i.test(t)) parts.push('クラブ戦');
    if (/ハード/.test(t)) parts.push('ハードモード');
    if (/ノーマル/.test(t)) parts.push('ノーマルモード');
    if (parts.length) return `ウイコレ ${parts.join(' ')}`;
    return 'ウイコレ';
  }
  // 括弧・「」で囲まれたタイトル
  const quoted = t.match(/「([^」]{2,20})」/);
  if (quoted) return quoted[1];
  // 「テストを9:19にリマインドして」「9:19にテストとしてリマインド」形式
  const timeBoundTitle = extractTimeBoundReminderTitle(t);
  if (timeBoundTitle) return timeBoundTitle;
  // "〜のリマインド / 〜を通知" 形式
  const titled = t.match(/(.{2,15})(?:を?リマインド|を通知|を知らせ)/);
  if (titled) {
    return sanitizeReminderTitle(titled[1]);
  }
  return '';
}

function sanitizeReminderTitle(value) {
  const cleaned = String(value || '')
    .replace(/^\d{1,2}\s*:\s*\d{1,2}\s*に?\s*/u, '')
    .replace(/^\d{1,2}\s*時(?:\s*半|\s*\d{1,2}\s*分?)?\s*に?\s*/u, '')
    .replace(/^(今夜|今日|本日|明日|今朝|朝|昼|夜|午前|午後|夕方)\s*/u, '')
    .replace(/(?:として|用|ぶん|分)$/u, '')
    .replace(/[をはに]$/u, '')
    .replace(/(リマインド|通知|知らせ)(して|お願い)?$/u, '')
    .trim();
  if (!cleaned) return '';
  if (/^(今夜|今日|本日|明日|今朝|朝|昼|夜|午前|午後|夕方|朝に|昼に|夜に|予定)$/u.test(cleaned)) {
    return '';
  }
  return cleaned;
}

function extractTimeBoundReminderTitle(text) {
  const t = String(text || '');
  const timePattern = String.raw`(?:\d{1,2}\s*:\s*\d{1,2}|\d{1,2}\s*時(?:\s*半|\s*\d{1,2}\s*分?)?)`;
  const afterTime = new RegExp(`^${timePattern}\\s*に\\s*(.{1,24}?)(?:として|を)?\\s*(?:リマインド|通知|知らせ)(?:して|お願い)?$`, 'u');
  const beforeTime = new RegExp(`^(.{1,24}?)(?:を)?\\s*${timePattern}\\s*に\\s*(?:リマインド|通知|知らせ)(?:して|お願い)?$`, 'u');
  const after = t.match(afterTime);
  if (after) return sanitizeReminderTitle(after[1]);
  const before = t.match(beforeTime);
  if (before) return sanitizeReminderTitle(before[1]);
  return '';
}

function buildReminderDetail(text, title = '', tags = [], participantCount = null) {
  const t = normalize(text);
  const count = participantCount || extractParticipantCount(t);
  if (tags.includes('uicolle') || /ウイコレ|クラブ戦/.test(title)) {
    const parts = [];
    if (/(今夜|今日|本日)/.test(t)) parts.push('今夜の段取り');
    if (Number.isFinite(count) && count > 1) parts.push(`${count}人予定`);
    if (/ハード/.test(t)) parts.push('ハードモード');
    if (/ノーマル/.test(t)) parts.push('ノーマルモード');
    if (/クラブ戦/.test(t)) parts.push('クラブ戦');
    return parts.length ? `補足: ${parts.join(' / ')}` : '';
  }
  return '';
}

function extractParticipantCount(t) {
  const match = String(t || '').match(/(\d{1,2})\s*人/);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isFinite(count) && count > 0 ? count : null;
}

function extractTags(t) {
  const tags = [];
  if (/(ウイコレ|クラブ戦|対戦|uicolle)/i.test(t)) tags.push('uicolle');
  if (/(飲み|食事|ご飯|ランチ|ディナー)/.test(t)) tags.push('meal');
  if (/(会議|mtg|ミーティング)/.test(t)) tags.push('meeting');
  if (/(旅行|出発|集合)/.test(t)) tags.push('travel');
  return tags;
}

function buildDueAt(hour, minute) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now).reduce((a, p) => { if (p.type !== 'literal') a[p.type] = p.value; return a; }, {});

  const todayTs = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour - 9, minute || 0, 0, 0);
  if (Number(parts.hour) === Number(hour) && Number(parts.minute) === Number(minute || 0)) {
    return todayTs;
  }
  if (todayTs > Date.now()) return todayTs;
  // 翌日
  return todayTs + 24 * 60 * 60 * 1000;
}

function formatJst(timestamp) {
  if (!timestamp) return '不明';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(timestamp));
}

module.exports = {
  detectReminderIntent,
  detectReminderSuggestionIntent,
  detectNoblesseReminderHint,
  buildNoblesseReminderProposal,
  formatReminderSetReply,
  formatReminderListReply,
  formatReminderCancelReply,
  formatReminderPushText,
  formatReminderMissingTimeReply,
  parseHourMinute,
  extractReminderTitle,
  extractTags,
  inferReminderHintFromConversation,
  inferGenericReminderTitle,
};
