'use strict';

const DAY_PARTS = {
  morning: { label: '朝', words: /(朝|午前|朝方)/ },
  daytime: { label: '昼', words: /(昼|お昼|午後|日中)/ },
  night: { label: '夜', words: /(夜|今夜|夕方|夜中)/ },
};

const WAKE_TIME_OPTIONS = {
  morning: [
    { label: '6:30', command: '6時半に起こして' },
    { label: '7:00', command: '7時に起こして' },
    { label: '7:30', command: '7時半に起こして' },
    { label: '8:00', command: '8時に起こして' },
  ],
  daytime: [
    { label: '11:00', command: '11時に起こして' },
    { label: '12:00', command: '12時に起こして' },
    { label: '13:00', command: '13時に起こして' },
    { label: '14:00', command: '14時に起こして' },
  ],
  night: [
    { label: '20:00', command: '20時に起こして' },
    { label: '21:00', command: '21時に起こして' },
    { label: '22:00', command: '22時に起こして' },
    { label: '23:00', command: '23時に起こして' },
  ],
};

const REMINDER_TIME_OPTIONS = {
  morning: [
    { label: '8:00', command: '8時にリマインドして' },
    { label: '9:00', command: '9時にリマインドして' },
    { label: '10:00', command: '10時にリマインドして' },
    { label: '11:00', command: '11時にリマインドして' },
  ],
  daytime: [
    { label: '12:00', command: '12時にリマインドして' },
    { label: '13:00', command: '13時にリマインドして' },
    { label: '15:00', command: '15時にリマインドして' },
    { label: '17:00', command: '17時にリマインドして' },
  ],
  night: [
    { label: '19:00', command: '19時にリマインドして' },
    { label: '20:00', command: '20時にリマインドして' },
    { label: '21:00', command: '21時にリマインドして' },
    { label: '22:00', command: '22時にリマインドして' },
  ],
};

function detectDayPart(text) {
  const normalized = normalize(text);
  if (!normalized) return null;
  for (const [key, def] of Object.entries(DAY_PARTS)) {
    if (def.words.test(normalized)) return key;
  }
  return null;
}

function buildWakeTimeChoiceMessage(intent = {}) {
  const qualifier = buildWakeQualifier(intent);
  if (!intent.dayPart) {
    return buildQuickReplyText(
      '何時ごろが近い？ まずは朝・昼・夜だけ選んでくれたら、そのあとで時間を絞るね。',
      [
        { label: '朝', text: `${qualifier}朝に起こして` },
        { label: '昼', text: `${qualifier}昼に起こして` },
        { label: '夜', text: `${qualifier}夜に起こして` },
        { label: '具体的に言う', text: `${qualifier}7時に起こして` },
      ],
    );
  }

  const part = intent.dayPart;
  const options = WAKE_TIME_OPTIONS[part] || WAKE_TIME_OPTIONS.morning;
  return buildQuickReplyText(
    `${DAY_PARTS[part]?.label || 'その時間帯'}なら、このへんが選びやすいよ。`,
    options.map(option => ({
      label: option.label,
      text: `${qualifier}${option.command}`,
    })),
  );
}

function buildReminderTimeChoiceMessage(intent = {}) {
  const title = intent.title && intent.title !== '予定' ? `「${intent.title}」` : 'その予定';
  const qualifier = buildReminderQualifier(intent);
  if (!intent.dayPart) {
    return buildQuickReplyText(
      `${title}は、朝・昼・夜だとどれが近い？ そこまで決まれば、いい感じの時間候補を出すよ。`,
      [
        { label: '朝', text: `${qualifier}朝にリマインドして` },
        { label: '昼', text: `${qualifier}昼にリマインドして` },
        { label: '夜', text: `${qualifier}夜にリマインドして` },
        { label: '具体的に言う', text: `${qualifier}21時にリマインドして` },
      ],
    );
  }

  const part = intent.dayPart;
  const options = REMINDER_TIME_OPTIONS[part] || REMINDER_TIME_OPTIONS.morning;
  return buildQuickReplyText(
    `${title}なら、${DAY_PARTS[part]?.label || 'その時間帯'}はこのへんが使いやすいよ。`,
    options.map(option => ({
      label: option.label,
      text: `${qualifier}${option.command}`,
    })),
  );
}

function buildWakeQualifier(intent) {
  if (intent.weekdayOnly) return '平日 ';
  if (intent.recurring) return '毎朝 ';
  return '';
}

function buildReminderQualifier(intent) {
  const title = intent.title && intent.title !== '予定' ? `「${intent.title}」を` : '';
  return title ? `${title} ` : '';
}

function buildQuickReplyText(text, actions = []) {
  const items = actions.slice(0, 4).map(item => ({
    type: 'action',
    action: {
      type: 'message',
      label: item.label,
      text: `@秘書トラペル子 ${item.text}`.trim(),
    },
  }));

  return {
    type: 'text',
    text,
    quickReply: { items },
  };
}

function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .trim();
}

module.exports = {
  detectDayPart,
  buildWakeTimeChoiceMessage,
  buildReminderTimeChoiceMessage,
};
