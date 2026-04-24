'use strict';

const { getTokyoDateParts } = require('./date-utils');

const FIELD_LABELS = {
  partySize: '人数',
  reservationDateTime: '日時',
  reserverName: '予約名',
  reserverPhone: '電話',
};

function createBookingForm(target = {}, actorName = '', ownerUserId = '') {
  return {
    kind: String(target.kind || '').slice(0, 20),
    targetName: String(target.name || '').slice(0, 80),
    targetUrl: String(target.url || '').slice(0, 500),
    targetPhone: String(target.phone || '').slice(0, 40),
    targetAddress: String(target.address || '').slice(0, 120),
    partySize: target.partySize || null,
    reservationDateTime: String(target.reservationDateTime || '').slice(0, 30),
    reserverName: String(target.reserverName || '').slice(0, 40),
    reserverPhone: String(target.reserverPhone || '').slice(0, 20),
    awaitingField: '',
    status: 'collecting',
    ownerUserId: String(ownerUserId || '').slice(0, 60),
    ownerName: String(actorName || '').slice(0, 50),
    updatedAt: Date.now(),
  };
}

function detectBookingCommand(text) {
  const t = String(text || '').trim();
  if (!t) return null;

  const partyMatch = t.match(/^予約人数[:：]?\s*(\d{1,2})(?:人)?$/);
  if (partyMatch) {
    return { type: 'booking', action: 'update', field: 'partySize', value: partyMatch[1] };
  }

  const dateMatch = t.match(/^(予約(?:日時|日程|時間))[:：]?\s*(.+)$/);
  if (dateMatch) {
    return { type: 'booking', action: 'update', field: 'reservationDateTime', value: dateMatch[2] };
  }

  const nameMatch = t.match(/^予約名(?:前)?[:：]?\s*(.+)$/);
  if (nameMatch) {
    return { type: 'booking', action: 'update', field: 'reserverName', value: nameMatch[1] };
  }

  const phoneMatch = t.match(/^予約電話[:：]?\s*([0-9０-９\-ー ]+)$/);
  if (phoneMatch) {
    return { type: 'booking', action: 'update', field: 'reserverPhone', value: phoneMatch[1] };
  }

  if (/^(予約(?:内容|確認|情報)|予約状況)$/.test(t)) {
    return { type: 'booking', action: 'summary' };
  }

  if (/^(予約入力|予約進めて|予約情報入れる|予約情報を入れる|予約手配)$/.test(t)) {
    return { type: 'booking', action: 'start' };
  }

  return null;
}

function getNextBookingField(form) {
  if (!form?.partySize) return 'partySize';
  if (!form?.reservationDateTime) return 'reservationDateTime';
  if (!form?.reserverName) return 'reserverName';
  if (!form?.reserverPhone) return 'reserverPhone';
  return '';
}

function isBookingFormComplete(form) {
  return !getNextBookingField(form);
}

function buildBookingPrompt(caseId, form) {
  const nextField = getNextBookingField(form);
  if (!nextField) {
    return {
      type: 'text',
      text: [
        `案件 ${caseId} の予約情報、必要なところまで揃ったよ。`,
        buildBookingSummaryLines(form).join('\n'),
        'このまま送信先を選ぶか、予約ページを開いて進められるよ。',
      ].join('\n\n'),
    };
  }

  if (nextField === 'partySize') {
    return {
      type: 'text',
      text: [
        `${displayTarget(form)}の予約人数を教えてね。`,
        '2人・4人・6人・8人はボタンで入れられるし、そのまま「5人」って送っても大丈夫。',
      ].join('\n'),
      quickReply: {
        items: [2, 4, 6, 8].map(count => ({
          type: 'action',
          action: {
            type: 'postback',
            label: `${count}人`,
            data: `noblesse:booking_party:${caseId}:${count}`,
            displayText: `${count}人`,
          },
        })),
      },
    };
  }

  if (nextField === 'reservationDateTime') {
    return {
      type: 'text',
      text: [
        '予約したい日時を次の1通で送ってね。',
        '例: 4/30 19:00',
        '例: 2026-05-02 18:30',
      ].join('\n'),
    };
  }

  if (nextField === 'reserverName') {
    return {
      type: 'text',
      text: '予約名を次の1通で送ってね。\n例: 米澤直人',
    };
  }

  return {
    type: 'text',
    text: '連絡先の電話番号を次の1通で送ってね。\n例: 090-1234-5678',
  };
}

function buildBookingSummaryText(caseId, form) {
  const lines = [
    `案件 ${caseId} の予約情報`,
    ...buildBookingSummaryLines(form),
  ];
  const nextField = getNextBookingField(form);
  if (nextField) {
    lines.push('');
    lines.push(`次に入れる項目: ${FIELD_LABELS[nextField]}`);
  }
  return lines.join('\n');
}

function buildBookingShareText(caseId, form) {
  return [
    form?.kind === 'hotel' ? '【宿の予約共有】' : '【お店の予約共有】',
    `案件: ${caseId}`,
    `候補: ${form?.targetName || '未設定'}`,
    form?.targetAddress ? `場所: ${form.targetAddress}` : '',
    form?.partySize ? `人数: ${form.partySize}人` : '',
    form?.reservationDateTime ? `日時: ${form.reservationDateTime}` : '',
    form?.reserverName ? `予約名: ${form.reserverName}` : '',
    form?.reserverPhone ? `電話: ${form.reserverPhone}` : '',
    form?.targetPhone ? `店舗電話: ${form.targetPhone}` : '',
    form?.targetUrl ? `予約導線: ${form.targetUrl}` : '',
    '最終確定は予約ページ側でお願いね。',
  ].filter(Boolean).join('\n');
}

function applyBookingFieldInput(field, rawText, now = new Date()) {
  const text = String(rawText || '').trim();
  if (!text) {
    return { ok: false, error: `${FIELD_LABELS[field] || 'その項目'}が空みたい。もう一度だけ送ってね。` };
  }

  if (field === 'partySize') {
    const match = text.match(/(\d{1,2})/);
    const partySize = match ? Number(match[1]) : 0;
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20) {
      return { ok: false, error: '人数は 1〜20人 くらいで送ってね。例: 4人' };
    }
    return { ok: true, value: partySize };
  }

  if (field === 'reservationDateTime') {
    const parsed = parseBookingDateTime(text, now);
    if (!parsed) {
      return { ok: false, error: '日時の読み取りが少し難しかったの。例みたいに「4/30 19:00」で送ってね。' };
    }
    return { ok: true, value: parsed };
  }

  if (field === 'reserverName') {
    const value = text.replace(/\s+/g, ' ').trim();
    if (value.length < 2) {
      return { ok: false, error: '予約名はもう少しだけ長く送ってね。' };
    }
    return { ok: true, value: value.slice(0, 40) };
  }

  if (field === 'reserverPhone') {
    const normalized = normalizePhone(text);
    if (!normalized) {
      return { ok: false, error: '電話番号は 090-1234-5678 みたいに送ってね。' };
    }
    return { ok: true, value: normalized };
  }

  return { ok: false, error: 'その項目はまだ受け取れないみたい。' };
}

function parseBookingDateTime(text, now = new Date()) {
  const normalized = String(text || '')
    .normalize('NFKC')
    .replace(/[年月]/g, '/')
    .replace(/[日]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  let match = normalized.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (match) {
    return formatDateTime(match[1], match[2], match[3], match[4], match[5]);
  }

  match = normalized.match(/^(\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (match) {
    const today = getTokyoDateParts(now);
    let year = today.year;
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month < today.month || (month === today.month && day < today.day)) {
      year += 1;
    }
    return formatDateTime(year, month, day, match[3], match[4]);
  }

  return '';
}

function formatDateTime(year, month, day, hour, minute) {
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d) || !Number.isInteger(h) || !Number.isInteger(mi)) return '';
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h < 0 || h > 23 || mi < 0 || mi > 59) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

function normalizePhone(text) {
  const digits = String(text || '').normalize('NFKC').replace(/[^\d]/g, '');
  if (digits.length < 10 || digits.length > 11) return '';
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
}

function buildBookingSummaryLines(form) {
  return [
    `候補: ${displayTarget(form)}`,
    `人数: ${form?.partySize ? `${form.partySize}人` : '未入力'}`,
    `日時: ${form?.reservationDateTime || '未入力'}`,
    `予約名: ${form?.reserverName || '未入力'}`,
    `電話: ${form?.reserverPhone || '未入力'}`,
  ];
}

function displayTarget(form) {
  return form?.targetName || '候補未設定';
}

module.exports = {
  createBookingForm,
  detectBookingCommand,
  getNextBookingField,
  isBookingFormComplete,
  buildBookingPrompt,
  buildBookingSummaryText,
  buildBookingShareText,
  applyBookingFieldInput,
};
