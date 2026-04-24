'use strict';

// Phase 2: ノブレス案件ID + 承認フロー + 実行ログ

const { incrementNoblesseCaseCounter, saveNoblesseCase, getNoblesseCase } = require('./firebase-admin');

// ── 案件ID生成 ───────────────────────────────────────────────────────────────
async function generateCaseId(dateStr) {
  try {
    const seq = await incrementNoblesseCaseCounter(dateStr);
    return `NB-${dateStr.replace(/-/g, '')}-${seq}`;
  } catch (err) {
    console.error('[noblesse-case] counter failed', err?.message || err);
    // フォールバック: タイムスタンプ末尾4桁
    const fallback = String(Date.now()).slice(-4);
    return `NB-${dateStr.replace(/-/g, '')}-${fallback}`;
  }
}

// ── 案件保存 ─────────────────────────────────────────────────────────────────
async function createCase({ caseId, userId, sourceId, senderName, request, analysis }) {
  await saveNoblesseCase(caseId, {
    userId: userId || '',
    sourceId: sourceId || '',
    senderName: senderName || '',
    request,
    analysis,
    status: 'pending',
    createdAt: Date.now(),
  });
}

async function approveCase(caseId, option) {
  const existing = await getNoblesseCase(caseId);
  if (!existing) return null;
  const updated = {
    ...existing,
    status: 'approved',
    approvedOption: option,
    approvedAt: Date.now(),
  };
  await saveNoblesseCase(caseId, updated);
  return updated;
}

async function cancelCase(caseId) {
  const existing = await getNoblesseCase(caseId);
  if (!existing) return null;
  await saveNoblesseCase(caseId, { ...existing, status: 'cancelled', cancelledAt: Date.now() });
  return existing;
}

// ── 分析テキストからオプション抽出 ──────────────────────────────────────────
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
  const rec = text.match(/推奨[:：]\s*案([ABC])/);
  if (rec) result.recommended = rec[1];
  if (!result.recommended) {
    const selfRec = text.match(/私なら案([ABC])/);
    if (selfRec) result.recommended = selfRec[1];
  }
  return result;
}

// ── 承認後の実行レポートテキスト ─────────────────────────────────────────────
function buildExecutionReport(caseId, option, caseData) {
  const opts = parseOptions(caseData?.analysis || '');
  const chosen = opts[option] || `案${option}`;
  const senderLabel = caseData?.senderName ? `${caseData.senderName}さん、` : '';
  return [
    `${senderLabel}案${option}で進めるね。`,
    '',
    `▶ 実行内容`,
    `案${option}: ${chosen}`,
    '',
    `▶ 実行結果`,
    `状態: 承認済み`,
    `案件ID: ${caseId}`,
    `次アクション: 必要に応じて詳細を追加で教えてね。私が整理する。`,
  ].join('\n');
}

// ── 承認Flexメッセージ ────────────────────────────────────────────────────────
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
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: 'sm',
        contents: [
          optionButton('A', `案A で進める`),
          optionButton('B', `案B で進める`),
          optionButton('C', `案C で進める`),
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

// ── 承認案からキーワード抽出 ─────────────────────────────────────────────────
function extractSearchKeyword(optionText) {
  if (!optionText) return '';
  // 最初の句読点・改行の前だけ取る（場所名が先頭にくることが多い）
  const first = optionText.split(/[。、・\n]/)[0];
  return first.slice(0, 20).trim();
}

// ── 案件ステータス表示 ────────────────────────────────────────────────────────
const STATUS_LABEL = {
  pending:   '⏳ 承認待ち',
  approved:  '✅ 承認済み',
  cancelled: '❌ キャンセル',
};

function buildStatusText(cases) {
  if (!cases.length) {
    return '案件の記録はまだないみたい。何か依頼があれば言って。';
  }
  const lines = [`直近${cases.length}件の案件状況だよ。`, ''];
  for (const c of cases) {
    const label = STATUS_LABEL[c.status] || c.status;
    const option = c.approvedOption ? `（案${c.approvedOption}）` : '';
    const req = String(c.request || '').slice(0, 28);
    const reqLabel = req ? `「${req}${req.length >= 28 ? '…' : ''}」` : '';
    lines.push(`${c.caseId}  ${label}${option}`);
    if (reqLabel) lines.push(reqLabel);
    lines.push('');
  }
  return lines.join('\n').trim();
}

function buildSingleCaseText(caseId, c) {
  if (!c) return `案件 ${caseId} は見つからなかったよ。IDを確認して。`;
  const label = STATUS_LABEL[c.status] || c.status;
  const option = c.approvedOption ? `\n承認案: 案${c.approvedOption}` : '';
  const req = String(c.request || '').slice(0, 80);
  const createdAt = c.createdAt ? new Date(c.createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '不明';
  return [
    `案件 ${caseId} の詳細`,
    '',
    `状態: ${label}${option}`,
    `依頼: ${req}`,
    `作成: ${createdAt}`,
    c.senderName ? `依頼者: ${c.senderName}` : '',
  ].filter(Boolean).join('\n');
}

module.exports = { generateCaseId, createCase, approveCase, cancelCase, buildApprovalFlex, buildExecutionReport, parseOptions, buildStatusText, buildSingleCaseText, extractSearchKeyword };
