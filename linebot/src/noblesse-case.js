'use strict';

const {
  incrementNoblesseCaseCounter,
  saveNoblesseCase,
  getNoblesseCase,
  appendNoblesseCaseEvent,
} = require('./firebase-admin');

async function generateCaseId(dateStr) {
  try {
    const seq = await incrementNoblesseCaseCounter(dateStr);
    return `NB-${dateStr.replace(/-/g, '')}-${seq}`;
  } catch (err) {
    console.error('[noblesse-case] counter failed', err?.message || err);
    const fallback = String(Date.now()).slice(-4);
    return `NB-${dateStr.replace(/-/g, '')}-${fallback}`;
  }
}

async function createCase({ caseId, userId, sourceId, senderName, request, analysis }) {
  await saveNoblesseCase(caseId, {
    userId: userId || '',
    sourceId: sourceId || '',
    senderName: senderName || '',
    request,
    analysis,
    status: 'pending',
    executionPolicy: {
      maxLevel: 3,
      finalReservationAllowed: false,
      finalPurchaseAllowed: false,
    },
    createdAt: Date.now(),
  });
  await safeAppendCaseEvent(caseId, {
    kind: 'created',
    actorName: senderName || '',
    requestPreview: previewText(request, 60),
  });
}

async function approveCase(caseId, option, meta = {}) {
  const existing = await getNoblesseCase(caseId);
  if (!existing) return null;
  const updated = {
    ...existing,
    status: 'approved',
    approvedOption: option,
    approvedAt: Date.now(),
  };
  await saveNoblesseCase(caseId, updated);
  await safeAppendCaseEvent(caseId, {
    kind: 'approved',
    option: option || '',
    actorName: meta.actorName || '',
    note: previewText(meta.note, 80),
  });
  return updated;
}

async function cancelCase(caseId, meta = {}) {
  const existing = await getNoblesseCase(caseId);
  if (!existing) return null;
  await saveNoblesseCase(caseId, {
    ...existing,
    status: 'cancelled',
    cancelledAt: Date.now(),
  });
  await safeAppendCaseEvent(caseId, {
    kind: 'cancelled',
    actorName: meta.actorName || '',
    note: previewText(meta.note, 80),
  });
  return existing;
}

async function updateCase(caseId, patch) {
  if (!caseId || !patch || typeof patch !== 'object') return null;
  const existing = await getNoblesseCase(caseId);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  await saveNoblesseCase(caseId, updated);
  return updated;
}

async function rememberSelectionCandidates(caseId, type, items) {
  const safeItems = Array.isArray(items)
    ? items.slice(0, 5).map(item => ({
      name: String(item?.name || '').slice(0, 80),
      url: String(item?.url || '').slice(0, 500),
      phone: String(item?.phone || '').slice(0, 40),
      address: String(item?.address || '').slice(0, 120),
      budget: String(item?.budget || '').slice(0, 40),
      price: String(item?.price || '').slice(0, 40),
      review: String(item?.review || '').slice(0, 20),
    }))
    : [];
  return updateCase(caseId, {
    selectionCandidates: {
      type: String(type || '').slice(0, 20),
      items: safeItems,
      updatedAt: Date.now(),
    },
  });
}

async function rememberPreparedSend(caseId, payload) {
  const text = String(payload?.text || '').slice(0, 4000);
  if (!text) return null;
  return updateCase(caseId, {
    preparedSend: {
      kind: String(payload?.kind || 'note').slice(0, 40),
      title: String(payload?.title || '').slice(0, 80),
      text,
      allowImmediateSend: payload?.allowImmediateSend !== false,
      updatedAt: Date.now(),
    },
  });
}

async function rememberBookingForm(caseId, bookingForm) {
  if (!caseId || !bookingForm || typeof bookingForm !== 'object') return null;
  return updateCase(caseId, {
    bookingForm: {
      ...bookingForm,
      updatedAt: Date.now(),
    },
  });
}

async function updateBookingForm(caseId, patch) {
  if (!caseId || !patch || typeof patch !== 'object') return null;
  const existing = await getNoblesseCase(caseId);
  if (!existing) return null;
  const current = existing.bookingForm && typeof existing.bookingForm === 'object'
    ? existing.bookingForm
    : {};
  return updateCase(caseId, {
    bookingForm: {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    },
  });
}

async function rememberSearchIntake(caseId, searchIntake) {
  if (!caseId || !searchIntake || typeof searchIntake !== 'object') return null;
  return updateCase(caseId, {
    searchIntake: {
      ...searchIntake,
      updatedAt: Date.now(),
    },
  });
}

async function updateSearchIntake(caseId, patch) {
  if (!caseId || !patch || typeof patch !== 'object') return null;
  const existing = await getNoblesseCase(caseId);
  if (!existing) return null;
  const current = existing.searchIntake && typeof existing.searchIntake === 'object'
    ? existing.searchIntake
    : {};
  return updateCase(caseId, {
    searchIntake: {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    },
  });
}

async function logCaseEvent(caseId, kind, details = {}) {
  await safeAppendCaseEvent(caseId, {
    kind,
    ...details,
  });
}

function parseOptions(analysisText) {
  const text = String(analysisText || '');
  const result = { A: null, B: null, C: null, recommended: null };
  const patterns = {
    A: /案A[（(][^）)]*[）)][:：]\s*(.+)/,
    B: /案B[（(][^）)]*[）)][:：]\s*(.+)/,
    C: /案C[（(][^）)]*[）)][:：]\s*(.+)/,
  };
  for (const [key, pat] of Object.entries(patterns)) {
    const m = text.match(pat);
    if (m) result[key] = m[1].trim().slice(0, 60);
  }
  const rec = text.match(/推奨(?:案)?[:：]\s*案([ABC])/);
  if (rec) result.recommended = rec[1];
  if (!result.recommended) {
    const selfRec = text.match(/私なら案([ABC])/);
    if (selfRec) result.recommended = selfRec[1];
  }
  return result;
}

function buildExecutionReport(caseId, option, caseData) {
  const opts = parseOptions(caseData?.analysis || '');
  const optionLabel = formatApprovalLabel(option);
  const chosen = opts[option] || optionLabel;
  const senderLabel = caseData?.senderName ? `${caseData.senderName}さん、` : '';
  return [
    `${senderLabel}${optionLabel}で進めるね。`,
    '',
    '▶ 実行内容',
    `${optionLabel}: ${chosen}`,
    '',
    '▶ 実行結果',
    '状態: 承認済み',
    `案件ID: ${caseId}`,
    '外部影響: 候補提示や下書き作成、共有送信まで。予約や購入の最終確定はまだしていないよ。',
    '次アクション: 必要に応じて詳細を追加で教えてね。私が整理する。',
  ].join('\n');
}

function buildApprovalFlex(caseId, analysis, request) {
  const opts = parseOptions(analysis);
  const rec = opts.recommended;

  const optionButton = (key, label) => ({
    type: 'button',
    action: {
      type: 'postback',
      label,
      data: `noblesse:approve:${caseId}:${key}`,
      displayText: `案${key}で進める`,
    },
    style: key === rec ? 'primary' : 'secondary',
    height: 'sm',
    margin: 'sm',
  });

  const reqPreview = String(request || '').slice(0, 40);

  return {
    type: 'flex',
    altText: `案件 ${caseId} — どの案で進める？`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#0d1b2a',
        contents: [
          { type: 'text', text: 'どの案で進める？', color: '#ffffff', size: 'sm', weight: 'bold' },
          { type: 'text', text: `案件 ${caseId}`, color: '#aaaaaa', size: 'xs', margin: 'xs' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: reqPreview, size: 'sm', color: '#444444', wrap: true },
          ...(rec ? [{
            type: 'text',
            text: `★ 私のおすすめは案${rec}だよ`,
            size: 'xs',
            color: '#888888',
            margin: 'sm',
          }] : []),
          {
            type: 'text',
            text: 'この承認で進むのは候補提示や下書き作成まで。予約・購入の最終確定は別で確認するよ。',
            size: 'xs',
            color: '#8a8a8a',
            margin: 'md',
            wrap: true,
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: 'sm',
        contents: [
          optionButton('A', '案A で進める'),
          optionButton('B', '案B で進める'),
          optionButton('C', '案C で進める'),
          {
            type: 'button',
            action: {
              type: 'postback',
              label: 'やっぱりやめる',
              data: `noblesse:cancel:${caseId}`,
              displayText: 'キャンセル',
            },
            style: 'link',
            height: 'sm',
            margin: 'sm',
            color: '#999999',
          },
        ],
      },
    },
  };
}

const GENERIC_WORDS = /^(穴場|おすすめ|人気|定番|有名|格安|高級|温泉|観光|旅行|国内|海外|近場|遠出|ベスト|プレミアム|スポット)[のでにはが\s]*/;

function extractSearchKeyword(optionText) {
  if (!optionText) return '';
  const first = optionText.split(/[。\n]/)[0].trim();
  const cleaned = first.replace(GENERIC_WORDS, '').trim();
  const segments = cleaned.split('・').slice(0, 2).join('・');
  return segments.slice(0, 20).trim();
}

const STATUS_LABEL = {
  pending: '⏳ 承認待ち',
  approved: '✅ 承認済み',
  cancelled: '❌ キャンセル',
};

function buildStatusText(cases) {
  if (!cases.length) {
    return '案件の記録はまだないみたい。何か依頼があれば言って。';
  }
  const lines = [`直近${cases.length}件の案件状況だよ。`, ''];
  for (const c of cases) {
    const label = STATUS_LABEL[c.status] || c.status;
    const option = c.approvedOption ? `（${formatApprovalLabel(c.approvedOption)}）` : '';
    const req = String(c.request || '').slice(0, 28);
    const reqLabel = req ? `「${req}${req.length >= 28 ? '…' : ''}」` : '';
    lines.push(`${c.caseId}  ${label}${option}`);
    if (reqLabel) lines.push(reqLabel);
    lines.push('');
  }
  return lines.join('\n').trim();
}

function buildSingleCaseText(caseId, c, events = [], executions = []) {
  if (!c) return `案件 ${caseId} は見つからなかったよ。IDを確認して。`;
  const label = STATUS_LABEL[c.status] || c.status;
  const option = c.approvedOption ? `\n承認案: ${formatApprovalLabel(c.approvedOption)}` : '';
  const req = String(c.request || '').slice(0, 80);
  const createdAt = c.createdAt
    ? new Date(c.createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
    : '不明';
  return [
    `案件 ${caseId} の詳細`,
    '',
    `状態: ${label}${option}`,
    `依頼: ${req}`,
    `作成: ${createdAt}`,
    c.senderName ? `依頼者: ${c.senderName}` : '',
    ...(executions.length ? ['最近の実行:', ...executions.map(execution => `・${formatCaseExecution(execution)}`)] : []),
    ...(events.length ? ['最近の動き:', ...events.map(event => `・${formatCaseEvent(event)}`)] : []),
  ].filter(Boolean).join('\n');
}

function getSelectionCandidate(caseData, index) {
  const items = caseData?.selectionCandidates?.items;
  if (!Array.isArray(items)) return null;
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) return null;
  return items[idx];
}

function getPreparedSend(caseData) {
  if (!caseData?.preparedSend?.text) return null;
  return caseData.preparedSend;
}

function getBookingForm(caseData) {
  if (!caseData?.bookingForm?.targetName) return null;
  return caseData.bookingForm;
}

function getSearchIntake(caseData) {
  if (!caseData?.searchIntake?.kind) return null;
  return caseData.searchIntake;
}

function previewText(text, maxLen) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen)}…` : normalized;
}

async function safeAppendCaseEvent(caseId, data) {
  try {
    await appendNoblesseCaseEvent(caseId, data);
  } catch (err) {
    console.error('[noblesse-case] append event failed', err?.message || err);
  }
}

function formatApprovalLabel(option) {
  if (!option) return '選択肢';
  if (/^[ABC]$/.test(option)) return `案${option}`;
  if (option === 'hotel') return 'ホテル候補';
  if (option === 'restaurant') return 'お店候補';
  if (option === 'draft') return '文面候補';
  return option;
}

function formatCaseEvent(event) {
  const ts = event?.createdAt
    ? new Date(event.createdAt).toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    : '時刻不明';
  const actor = event?.actorName ? `${event.actorName} / ` : '';

  switch (event?.kind) {
    case 'created':
      return `${ts} ${actor}案件作成${event.requestPreview ? ` (${event.requestPreview})` : ''}`;
    case 'approved':
      return `${ts} ${actor}${formatApprovalLabel(event.option)}で承認${event.note ? ` (${event.note})` : ''}`;
    case 'cancelled':
      return `${ts} ${actor}案件をキャンセル${event.note ? ` (${event.note})` : ''}`;
    case 'report_sent':
      return `${ts} ${actor}実行レポート送信`;
    case 'message_draft_ready':
      return `${ts} ${actor}文面草案を作成`;
    case 'message_sent':
      return `${ts} ${actor}文面を送信`;
    case 'schedule_sent':
      return `${ts} ${actor}日程文面を送信`;
    case 'decision_sent':
      return `${ts} ${actor}共有内容を送信${event.note ? ` (${event.note})` : ''}`;
    case 'schedule_draft_ready':
      return `${ts} ${actor}日程文面を作成`;
    case 'decision_ready':
      return `${ts} ${actor}共有文面を準備${event.note ? ` (${event.note})` : ''}`;
    case 'booking_form_started':
      return `${ts} ${actor}予約情報の入力を開始${event.note ? ` (${event.note})` : ''}`;
    case 'booking_field_updated':
      return `${ts} ${actor}予約情報を更新${event.field ? ` (${event.field})` : ''}`;
    case 'booking_form_completed':
      return `${ts} ${actor}予約情報が揃った`;
    case 'search_strategy_selected':
      return `${ts} ${actor}検索の進め方を選択${event.mode ? ` (${event.mode})` : ''}`;
    case 'search_intake_started':
      return `${ts} ${actor}検索条件のヒアリング開始${event.kind ? ` (${event.kind})` : ''}`;
    case 'search_intake_updated':
      return `${ts} ${actor}検索条件を更新${event.field ? ` (${event.field})` : ''}`;
    case 'search_intake_completed':
      return `${ts} ${actor}検索条件が揃った`;
    case 'restaurant_search':
      return `${ts} ${actor}お店候補を検索${buildSearchSuffix(event)}`;
    case 'hotel_search':
      return `${ts} ${actor}ホテル候補を検索${buildSearchSuffix(event)}`;
    case 'restaurant_selected':
      return `${ts} ${actor}お店を選択${event.name ? ` (${event.name})` : ''}`;
    case 'hotel_selected':
      return `${ts} ${actor}ホテルを選択${event.name ? ` (${event.name})` : ''}`;
    case 'transport_info':
      return `${ts} ${actor}${buildTransportLabel(event)}`;
    default:
      return `${ts} ${actor}${event?.kind || '更新'}`;
  }
}

function formatCaseExecution(execution) {
  const ts = execution?.updatedAt || execution?.createdAt
    ? new Date(execution.updatedAt || execution.createdAt).toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    : '時刻不明';
  const label = formatExecutionType(execution?.type);
  const status = formatExecutionStatus(execution?.status);
  const provider = execution?.provider ? ` / ${execution.provider}` : '';
  const note = execution?.blockedReason
    ? ` (${formatBlockedReason(execution.blockedReason)})`
    : execution?.payload?.title
      ? ` (${execution.payload.title})`
      : execution?.payload?.name
        ? ` (${execution.payload.name})`
        : '';
  return `${ts} ${label}${provider} ${status}${note}`;
}

function buildSearchSuffix(event) {
  const parts = [];
  if (event?.keyword) parts.push(event.keyword);
  if (Number.isFinite(event?.count)) parts.push(`${event.count}件`);
  if (Number.isFinite(event?.budgetYen) && event.budgetYen > 0) {
    parts.push(`${Number(event.budgetYen).toLocaleString('ja-JP')}円`);
  }
  return parts.length ? ` (${parts.join(' / ')})` : '';
}

function buildTransportLabel(event) {
  const mode = event?.mode === 'taxi'
    ? 'タクシー情報を提示'
    : event?.mode === 'flight'
      ? 'フライト情報を提示'
      : '経路情報を提示';
  const route = [event?.from, event?.to].filter(Boolean).join(' → ');
  return route ? `${mode} (${route})` : mode;
}

function formatExecutionType(type) {
  switch (type) {
    case 'line_send':
      return 'LINE送信';
    case 'booking_handoff':
      return '予約導線準備';
    case 'mail_send':
      return 'メール送信';
    case 'booking_finalize':
      return '予約確定';
    case 'purchase_attempt':
      return '購入処理';
    default:
      return type || '実行';
  }
}

function formatExecutionStatus(status) {
  switch (status) {
    case 'planned':
      return '準備済み';
    case 'running':
      return '実行中';
    case 'done':
      return '完了';
    case 'failed':
      return '失敗';
    case 'blocked':
      return '停止';
    case 'cancelled':
      return '取消';
    default:
      return status || '不明';
  }
}

function formatBlockedReason(reason) {
  switch (reason) {
    case 'policy_max_level':
      return '実行レベル上限';
    case 'reservation_final_confirmation_required':
      return '最終予約は別確認';
    case 'purchase_final_confirmation_required':
      return '購入は別系統';
    default:
      return reason || '制限あり';
  }
}

module.exports = {
  generateCaseId,
  createCase,
  approveCase,
  cancelCase,
  updateCase,
  rememberSelectionCandidates,
  rememberPreparedSend,
  rememberBookingForm,
  rememberSearchIntake,
  updateBookingForm,
  updateSearchIntake,
  getPreparedSend,
  getBookingForm,
  getSearchIntake,
  getSelectionCandidate,
  logCaseEvent,
  buildApprovalFlex,
  buildExecutionReport,
  parseOptions,
  buildStatusText,
  buildSingleCaseText,
  extractSearchKeyword,
};
