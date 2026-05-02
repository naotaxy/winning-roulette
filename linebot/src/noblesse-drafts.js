'use strict';

const MESSAGE_PATTERN = /(メール|返信|返事|文面|依頼文|案内文|招待文|見積|連絡|送る文章|送信文)/;
const SCHEDULE_PATTERN = /(日程|日時|予定|スケジュール|候補日|空いて|空き|何日|何時|都合|来週|今週|週末|調整|出欠|参加可否|集まれる)/;

const SCHEDULE_TEMPLATES = {
  drinks: [
    '【飲み会の日程確認】',
    '候補を2つだけ出すね。',
    '1. ○/○(○) 19:30',
    '2. ○/○(○) 20:00',
    '行ける番号だけ返してもらえたら、次を締めやすいよ。',
  ],
  meeting: [
    '【打ち合わせ日程確認】',
    '候補は2つだけ出します。',
    '1. ○/○(○) 20:00',
    '2. ○/○(○) 21:00',
    '参加できる番号を返してください。',
  ],
  watch: [
    '【観戦・イベント日程確認】',
    '候補日を2つだけ出します。',
    '1. ○/○(○)',
    '2. ○/○(○)',
    '行ける方だけ返してください。',
  ],
  match: [
    '【対戦日程確認】',
    '候補は2つだけ出します。',
    '1. ○/○(○) 夜',
    '2. ○/○(○) 夜',
    '行ける方を返してください。',
  ],
  general: [
    '【日程確認】',
    '候補は2つだけ出します。',
    '1. ○/○(○) ○○',
    '2. ○/○(○) ○○',
    '行ける番号だけ返してもらえたら、次を締めやすいです。',
  ],
};

function isMessageDraftRequest(text) {
  return MESSAGE_PATTERN.test(String(text || ''));
}

function isScheduleDraftRequest(text) {
  return SCHEDULE_PATTERN.test(String(text || ''));
}

function buildMessageDraft(caseId, caseData, option) {
  const request = String(caseData?.request || '').trim();
  const topic = extractTopic(request);
  const optionLabel = formatOptionLabel(option);

  if (/(見積|お見積)/.test(request)) {
    return [
      `案件 ${caseId} の文面草案`,
      `進め方: ${optionLabel}`,
      '',
      '件名: お見積りのお願い',
      '',
      '本文:',
      '[宛先名]',
      '',
      'お世話になっております。',
      `${topic}について検討しており、お見積りをお願いしたくご連絡しました。`,
      '差し支えなければ、以下の条件で概算をご案内いただけますでしょうか。',
      '・希望内容: [内容]',
      '・希望時期: [時期]',
      '・予算感: [予算]',
      '・回答希望日: [日付]',
      '',
      '難しければ代替案でも助かります。',
      'よろしくお願いいたします。',
      '',
      '未入力: 宛先名 / 希望内容 / 時期 / 予算 / 回答希望日',
    ].join('\n');
  }

  if (/(返信|返事|回答)/.test(request)) {
    return [
      `案件 ${caseId} の返信草案`,
      `進め方: ${optionLabel}`,
      '',
      '件名: Re: [元件名]',
      '',
      '本文:',
      '[宛先名]',
      '',
      'ご連絡ありがとうございます。',
      `${topic}の件、内容を確認しました。`,
      '[結論や返答内容]',
      '',
      '必要であれば追加の情報もお送りします。',
      'よろしくお願いいたします。',
      '',
      '未入力: 宛先名 / 結論 / 補足情報',
    ].join('\n');
  }

  return [
    `案件 ${caseId} の文面草案`,
    `進め方: ${optionLabel}`,
    '',
    `件名: ${topic}のご相談`,
    '',
    '本文:',
    '[宛先名]',
    '',
    'お疲れさまです。',
    `${topic}についてご相談したく、ご連絡しました。`,
    '・目的: [今回進めたいこと]',
    '・希望: [相手にお願いしたいこと]',
    '・期限: [いつまでに決めたいか]',
    '',
    'ご都合のよい形でご返信いただけると助かります。',
    'よろしくお願いいたします。',
    '',
    '未入力: 宛先名 / 目的 / 希望 / 期限',
  ].join('\n');
}

function buildScheduleDraft(caseId, caseData, option) {
  const request = String(caseData?.request || '').trim();
  const optionLabel = formatOptionLabel(option);
  const scenario = detectScheduleScenario(request);
  const template = SCHEDULE_TEMPLATES[scenario] || SCHEDULE_TEMPLATES.general;

  return [
    `案件 ${caseId} の日程募集たたき台`,
    `進め方: ${optionLabel}`,
    '',
    ...template,
    '',
    '補足: 候補日だけ埋めれば、そのまま流せる形にしてあるよ。',
  ].join('\n');
}

function detectScheduleScenario(text) {
  if (/(飲み会|会食|食事|居酒屋|店)/.test(text)) return 'drinks';
  if (/(打ち合わせ|会議|mtg|meeting|面談)/i.test(text)) return 'meeting';
  if (/(観戦|イベント|ライブ|試合を見る)/.test(text)) return 'watch';
  if (/(対戦|試合|マッチ|練習試合)/.test(text)) return 'match';
  return 'general';
}

function extractTopic(text) {
  const cleaned = String(text || '')
    .replace(/@秘書トラペル子/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'この件';

  const main = cleaned
    .replace(/(メール|返信|返事|文面|依頼文|案内文|招待文|見積|連絡|日程|日時|予定|スケジュール|調整)(を|の|で)?/g, '')
    .replace(/(したい|してほしい|作りたい|作って|考えて|お願い|相談したい|どうすれば|どうしたら).*/g, '')
    .replace(/[のをにはへとでからまで]+$/g, '')
    .replace(/[。！？!?]+$/g, '')
    .trim();

  return main || cleaned.slice(0, 24);
}

function formatOptionLabel(option) {
  if (/^[ABC]$/.test(String(option || ''))) return `案${option}`;
  if (option === 'hotel') return 'ホテル候補';
  if (option === 'restaurant') return 'お店候補';
  return String(option || 'この案');
}

module.exports = {
  isMessageDraftRequest,
  isScheduleDraftRequest,
  buildMessageDraft,
  buildScheduleDraft,
};
