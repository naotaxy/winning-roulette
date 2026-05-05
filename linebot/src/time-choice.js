'use strict';

const DAY_PARTS = {
  morning: { label: '朝', words: /(朝|午前|朝方)/ },
  daytime: { label: '昼', words: /(昼|お昼|午後|日中)/ },
  night: { label: '夜', words: /(夜|今夜|夕方|夜中)/ },
};

const WAKE_TIME_OPTIONS = {
  morning: [
    { label: '5:00', command: '5時に起こして' },
    { label: '6:00', command: '6時に起こして' },
    { label: '6:30', command: '6時半に起こして' },
    { label: '7:00', command: '7時に起こして' },
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
    { label: '5:00', command: '5時にリマインドして' },
    { label: '6:00', command: '6時にリマインドして' },
    { label: '6:30', command: '6時半にリマインドして' },
    { label: '7:00', command: '7時にリマインドして' },
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

const WAKE_NEWS_MODE_LABELS = {
  all: 'WBSと大きめニュース',
  wbs: 'WBSだけ',
  major: '大きめニュースだけ',
  none: 'ニュースなし',
};

const WAKE_RECIPE_MODE_LABELS = {
  flyer: 'チラシ発想の節約レシピあり',
  none: 'レシピなし',
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

function buildWakeNewsChoiceMessage(alarm = {}) {
  const currentMode = normalizeWakeNewsMode(alarm.newsMode);
  const currentLabel = WAKE_NEWS_MODE_LABELS[currentMode] || WAKE_NEWS_MODE_LABELS.all;
  return buildQuickReplyText(
    `朝のニュースはどう持っていこうか？ 今は「${currentLabel}」になってるよ。`,
    [
      { label: '全部', text: '起床ニュース 全部' },
      { label: 'WBSだけ', text: '起床ニュース WBSだけ' },
      { label: '大きいニュース', text: '起床ニュース 主要ニュースだけ' },
      { label: '天気だけ', text: '起床ニュース なし' },
    ],
  );
}

function buildWakeRecipeChoiceMessage(alarm = {}) {
  const currentMode = normalizeWakeRecipeMode(alarm.recipeMode);
  const currentLabel = WAKE_RECIPE_MODE_LABELS[currentMode] || WAKE_RECIPE_MODE_LABELS.none;
  return buildQuickReplyText(
    `朝のレシピ提案はどうしようか？ 今は「${currentLabel}」になってるよ。`,
    [
      { label: 'レシピあり', text: '起床レシピ ほしい' },
      { label: 'レシピなし', text: '起床レシピ なし' },
      { label: '設定確認', text: '起床レシピ 状態' },
    ],
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

function normalizeWakeNewsMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'wbs') return 'wbs';
  if (mode === 'major') return 'major';
  if (mode === 'none') return 'none';
  return 'all';
}

function normalizeWakeRecipeMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'flyer') return 'flyer';
  return 'none';
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
  buildWakeNewsChoiceMessage,
  buildWakeRecipeChoiceMessage,
};
