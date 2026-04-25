'use strict';

const { detectDayPart } = require('./time-choice');

const WAKE_NEWS_MODE_LABELS = {
  all: 'WBSと大きめニュース',
  wbs: 'WBSだけ',
  major: '大きめニュースだけ',
  none: 'ニュースなし',
};

function detectWakeAlarmIntent(text) {
  const raw = String(text || '');
  const normalized = normalize(text);
  if (!normalized) return null;

  if (/(起床ニュース|朝ニュース|朝のニュース|起床セットニュース|ニュース設定)/.test(normalized)) {
    if (/(状態|確認|どう|何|見せ)/.test(normalized)) {
      return { type: 'wakeAlarm', action: 'newsStatus' };
    }
    const newsMode = extractWakeNewsMode(raw, normalized);
    if (newsMode) {
      return { type: 'wakeAlarm', action: 'setNewsMode', newsMode };
    }
    return { type: 'wakeAlarm', action: 'newsChoice' };
  }

  if (/(起こすのやめて|起こさなくていい|起床解除|アラーム解除|目覚まし解除|起こして解除|起こすの停止)/.test(normalized)) {
    return { type: 'wakeAlarm', action: 'cancel' };
  }

  if (/(起床状態|起床確認|アラーム状態|目覚まし状態|何時に起こして|起こしてる時間|アラーム確認)/.test(normalized)) {
    return { type: 'wakeAlarm', action: 'status' };
  }

  if (!/(起こして|起こしてね|起こしてほしい|起こしてください|目覚まし|アラーム)/.test(normalized)) {
    return null;
  }

  const recurring = /(毎朝|毎日|平日)/.test(normalized);
  const weekdayOnly = /(平日|月曜?から金曜?|月-?金|月〜金|月~金)/.test(normalized);
  const time = parseHourMinute(normalized);
  if (!time) {
    const dayPart = detectDayPart(normalized);
    if (dayPart) {
      return { type: 'wakeAlarm', action: 'timeBranch', recurring, weekdayOnly, dayPart };
    }
    return { type: 'wakeAlarm', action: 'missingTime', recurring, weekdayOnly };
  }
  if (time.hour < 0 || time.hour > 23 || time.minute < 0 || time.minute > 59) {
    return { type: 'wakeAlarm', action: 'invalidTime' };
  }

  const explicitTomorrow = /(明日|あした)/.test(normalized);
  const explicitToday = /(今日|きょう)/.test(normalized);
  const now = getTokyoDateTimeParts(new Date());
  const dueAt = computeWakeDueAt({
    hour: time.hour,
    minute: time.minute,
    recurring,
    weekdayOnly,
    explicitTomorrow,
    explicitToday,
    now,
  });

  return {
    type: 'wakeAlarm',
    action: 'set',
    hour: time.hour,
    minute: time.minute,
    recurring,
    weekdayOnly,
    explicitTomorrow,
    dueAt,
  };
}

function formatWakeAlarmSetReply(intent, senderName = null) {
  const when = formatDueLabel(intent?.dueAt, intent?.recurring);
  const title = senderName
    ? `${senderName}さん、${when}に起こすね。`
    : `${when}に起こすね。`;
  const cadence = intent?.recurring
    ? `${intent?.weekdayOnly ? '平日の朝' : '毎朝'} ${formatHourMinute(intent.hour, intent.minute)} ごろに声をかけるよ。`
    : `${formatHourMinute(intent.hour, intent.minute)} ごろに声をかけるよ。`;
  return [
    title,
    cadence,
    'GitHub Actions 経由だから、数分くらい前後することはあるけど、ちゃんと迎えに行くね。',
  ].join('\n');
}

function formatWakeAlarmStatusReply(alarm) {
  if (!alarm?.dueAt) {
    return [
      '今は起床セットは入ってないよ。',
      '1対1のトークで「朝7時に起こして」みたいに言ってくれたら、私が迎えに行くね。',
    ].join('\n');
  }
  return [
    alarm.recurring
      ? `今は${alarm.weekdayOnly ? '平日の朝' : '毎朝'} ${formatHourMinute(alarm.hour, alarm.minute)} ごろに起こす設定だよ。`
      : `次は ${formatDueLabel(alarm.dueAt, false)} に起こす予定だよ。`,
    alarm.recurring ? `次の予定は ${formatDateTime(alarm.dueAt)} ごろ。` : '',
    `朝のニュース設定は「${formatWakeNewsModeLabel(alarm?.newsMode)}」。`,
  ].filter(Boolean).join('\n');
}

function formatWakeAlarmCancelReply(alarm) {
  if (!alarm?.dueAt) {
    return '今は起床セットが入ってなかったよ。必要ならまた時間を言ってね。';
  }
  return 'わかった。起床セットは外しておいたよ。また必要になったら、時間だけ言ってくれたらすぐ入れるね。';
}

function formatWakeAlarmPushText(alarm) {
  const intro = alarm?.recurring ? 'おはよう。' : '起きる時間だよ。';
  return [
    intro,
    `${formatHourMinute(alarm?.hour, alarm?.minute)} になったから、そっと声をかけに来たよ。`,
  ].join('\n');
}

function formatWakeNewsModeReply(newsMode, senderName = null) {
  const label = formatWakeNewsModeLabel(newsMode);
  const title = senderName
    ? `${senderName}さん、朝のニュースは「${label}」にしておくね。`
    : `朝のニュースは「${label}」にしておくね。`;
  return [
    title,
    newsMode === 'none'
      ? '起きた時は、天気と通勤まわりを静かに持っていくね。'
      : '起きた時は、天気や通勤のあとに、その設定に合わせて小さく報告するよ。',
  ].join('\n');
}

function computeNextRecurringDueAt(alarm, fromDate = new Date()) {
  if (!alarm) return null;
  return computeWakeDueAt({
    hour: Number(alarm.hour) || 0,
    minute: Number(alarm.minute) || 0,
    recurring: true,
    weekdayOnly: alarm.weekdayOnly === true,
    explicitTomorrow: false,
    explicitToday: false,
    now: getTokyoDateTimeParts(fromDate),
  });
}

function parseHourMinute(text) {
  const colon = text.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  if (colon) return { hour: Number(colon[1]), minute: Number(colon[2]) };

  const half = text.match(/(\d{1,2})\s*時\s*半/);
  if (half) return { hour: Number(half[1]), minute: 30 };

  const hourMinute = text.match(/(\d{1,2})\s*時(?:\s*(\d{1,2})\s*分?)?/);
  if (hourMinute) return { hour: Number(hourMinute[1]), minute: hourMinute[2] ? Number(hourMinute[2]) : 0 };

  return null;
}

function extractWakeNewsMode(rawText, normalizedText) {
  if (/(なし|いらない|不要|オフ|off|天気だけ)/i.test(rawText)) return 'none';
  if (/(wbs|経済|マーケット)/i.test(rawText)) return 'wbs';
  if (/(大きいニュース|主要ニュース|大事なニュース|一般ニュース|nhk)/i.test(rawText)) return 'major';
  if (/(全部|全部入り|両方|おまかせ|通常|フル)/.test(normalizedText)) return 'all';
  return null;
}

function normalizeWakeNewsMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'wbs') return 'wbs';
  if (mode === 'major') return 'major';
  if (mode === 'none') return 'none';
  return 'all';
}

function formatWakeNewsModeLabel(value) {
  return WAKE_NEWS_MODE_LABELS[normalizeWakeNewsMode(value)] || WAKE_NEWS_MODE_LABELS.all;
}

function computeWakeDueAt({ hour, minute, recurring, weekdayOnly, explicitTomorrow, explicitToday, now }) {
  const todayTs = buildTokyoTimestamp(now.year, now.month, now.day, hour, minute);
  if (recurring) {
    if (weekdayOnly) {
      return findNextWeekdayTimestamp(now, hour, minute, todayTs > now.timestamp ? 0 : 1);
    }
    return todayTs > now.timestamp ? todayTs : buildShiftedDayTimestamp(now.year, now.month, now.day, 1, hour, minute);
  }
  if (explicitTomorrow) {
    return weekdayOnly
      ? findNextWeekdayTimestamp(now, hour, minute, 1)
      : buildShiftedDayTimestamp(now.year, now.month, now.day, 1, hour, minute);
  }
  if (explicitToday) {
    if (weekdayOnly) {
      return findNextWeekdayTimestamp(now, hour, minute, todayTs > now.timestamp ? 0 : 1);
    }
    return todayTs > now.timestamp ? todayTs : buildShiftedDayTimestamp(now.year, now.month, now.day, 1, hour, minute);
  }
  if (weekdayOnly) {
    return findNextWeekdayTimestamp(now, hour, minute, todayTs > now.timestamp ? 0 : 1);
  }
  return todayTs > now.timestamp ? todayTs : buildShiftedDayTimestamp(now.year, now.month, now.day, 1, hour, minute);
}

function buildShiftedDayTimestamp(year, month, day, deltaDays, hour, minute) {
  const base = buildTokyoTimestamp(year, month, day, 12, 0) + (deltaDays * 24 * 60 * 60 * 1000);
  const shifted = getTokyoDateTimeParts(new Date(base));
  return buildTokyoTimestamp(shifted.year, shifted.month, shifted.day, hour, minute);
}

function findNextWeekdayTimestamp(now, hour, minute, startOffsetDays) {
  for (let offset = startOffsetDays; offset < startOffsetDays + 8; offset++) {
    const base = buildShiftedDayTimestamp(now.year, now.month, now.day, offset, 12, 0);
    const candidate = getTokyoDateTimeParts(new Date(base));
    if (isWeekend(candidate.year, candidate.month, candidate.day)) continue;
    return buildTokyoTimestamp(candidate.year, candidate.month, candidate.day, hour, minute);
  }
  return buildShiftedDayTimestamp(now.year, now.month, now.day, startOffsetDays || 1, hour, minute);
}

function isWeekend(year, month, day) {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function getTokyoDateTimeParts(date) {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    timestamp: date.getTime(),
  };
}

function buildTokyoTimestamp(year, month, day, hour, minute) {
  return Date.UTC(year, month - 1, day, hour - 9, minute || 0, 0, 0);
}

function formatDueLabel(dueAt, recurring) {
  if (!dueAt) return '次の朝';
  const when = formatDateTime(dueAt);
  return recurring ? `${when} から` : when;
}

function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

function formatHourMinute(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute || 0).padStart(2, '0')}`;
}

function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .trim();
}

module.exports = {
  detectWakeAlarmIntent,
  formatWakeAlarmSetReply,
  formatWakeAlarmStatusReply,
  formatWakeAlarmCancelReply,
  formatWakeAlarmPushText,
  formatWakeNewsModeReply,
  formatWakeNewsModeLabel,
  normalizeWakeNewsMode,
  computeNextRecurringDueAt,
};
