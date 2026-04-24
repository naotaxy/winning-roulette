'use strict';

const { extractHotelParams } = require('./rakuten-travel');
const { extractRestaurantParams } = require('./hotpepper');

const GENERIC_KEYWORD_PATTERN = /(決める|探す|探して|比較|即決|条件|候補|優先|本命|エリアを|寄せる|比較する|整理|手配|ホテル|お店|宿)/;

function createSearchIntake({ kind, strategy, requestText, searchKeyword, option, actorName, ownerUserId }) {
  const request = String(requestText || '').trim();
  const normalizedKind = kind === 'restaurant' ? 'restaurant' : 'hotel';
  const normalizedStrategy = strategy === 'concierge' ? 'concierge' : 'guided';
  const hotel = normalizedKind === 'hotel' ? extractHotelParams(request) : null;
  const food = normalizedKind === 'restaurant' ? extractRestaurantParams(request) : null;
  const keyword = isSearchKeywordUsable(searchKeyword)
    ? sanitizeKeyword(searchKeyword)
    : '';

  return {
    kind: normalizedKind,
    strategy: normalizedStrategy,
    option: option || '',
    requestText: request.slice(0, 300),
    keyword,
    checkinDate: hotel?.checkinDate || '',
    checkoutDate: hotel?.checkoutDate || '',
    nights: hotel?.nights || 1,
    adultNum: hotel?.adultNum || null,
    partySize: food?.capacity || null,
    budgetYen: normalizedKind === 'hotel' ? (hotel?.maxCharge || null) : (food?.budgetYen || null),
    awaitingField: '',
    status: 'collecting',
    ownerUserId: String(ownerUserId || '').slice(0, 60),
    ownerName: String(actorName || '').slice(0, 50),
    updatedAt: Date.now(),
  };
}

function isSearchKeywordUsable(keyword) {
  const text = sanitizeKeyword(keyword);
  if (text.length < 2) return false;
  if (GENERIC_KEYWORD_PATTERN.test(text)) return false;
  return /[A-Za-z0-9\u3040-\u30ff\u3400-\u9fff]/.test(text);
}

function sanitizeKeyword(keyword) {
  return String(keyword || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function buildSearchStrategyReply(caseId, intake) {
  const missing = getHumanMissingLabels(intake);
  const target = intake.kind === 'hotel' ? '宿探し' : '店探し';
  const lines = [
    `案件 ${caseId} の${target}、このままでも進められるけど${missing.length ? `「${missing.join(' / ')}」が少し曖昧なの` : 'まだ少し条件がゆるいの'}。`,
    'どっちで進める？',
    '・条件を埋める: 足りないところを私が順番に聞く',
    intake.kind === 'hotel'
      ? '・秘書に任せる: 日付だけ確定したら、口コミと写真が強い宿を優先して探す'
      : '・秘書に任せる: 場所だけ固めて、写真や予算帯がわかりやすい候補から寄せる',
  ];
  return {
    type: 'text',
    text: lines.join('\n'),
    quickReply: {
      items: [
        buildPostbackQuickReply('条件を埋める', `noblesse:search_mode:${caseId}:guided`, '条件を埋める'),
        buildPostbackQuickReply('秘書に任せる', `noblesse:search_mode:${caseId}:concierge`, '秘書に任せる'),
      ],
    },
  };
}

function buildPostbackQuickReply(label, data, displayText) {
  return {
    type: 'action',
    action: {
      type: 'postback',
      label,
      data,
      displayText,
    },
  };
}

function getHumanMissingLabels(intake) {
  const labels = [];
  if (!isSearchKeywordUsable(intake?.keyword)) labels.push(intake?.kind === 'hotel' ? 'エリア' : '場所');
  if (intake?.kind === 'hotel') {
    if (!intake?.checkinDate) labels.push('日付');
    if (!intake?.budgetYen) labels.push('予算');
    if (!intake?.adultNum) labels.push('人数');
  } else {
    if (!intake?.budgetYen) labels.push('予算');
    if (!intake?.partySize) labels.push('人数');
  }
  return labels;
}

function getNextSearchField(intake) {
  const form = intake || {};
  const guided = form.strategy !== 'concierge';

  if (!isSearchKeywordUsable(form.keyword)) return 'keyword';
  if (form.kind === 'hotel') {
    if (!form.checkinDate) return 'checkinDate';
    if (guided && !form.adultNum) return 'adultNum';
    if (guided && !form.budgetYen) return 'budgetYen';
    return '';
  }
  if (guided && !form.partySize) return 'partySize';
  if (guided && !form.budgetYen) return 'budgetYen';
  return '';
}

function isSearchIntakeComplete(intake) {
  return !getNextSearchField(intake);
}

function buildSearchIntakePrompt(caseId, intake) {
  const field = getNextSearchField(intake);
  if (!field) {
    return {
      type: 'text',
      text: [
        `案件 ${caseId} の条件、ここまで揃ったよ。`,
        buildSearchIntakeSummary(caseId, intake),
        'この条件で探しに行くね。',
      ].join('\n\n'),
    };
  }

  if (field === 'keyword') {
    return {
      type: 'text',
      text: intake.kind === 'hotel'
        ? 'まず泊まりたいエリアや駅名を1通で送ってね。\n例: 新宿 / 札幌駅 / 那覇国際通り'
        : 'まず行きたいエリアや駅名を1通で送ってね。\n例: 新宿 / 吉祥寺 / 恵比寿',
      quickReply: {
        items: buildMessageQuickReplies(intake.kind === 'hotel'
          ? ['新宿', '渋谷', '京都駅', '那覇']
          : ['新宿', '渋谷', '吉祥寺', '恵比寿']),
      },
    };
  }

  if (field === 'checkinDate') {
    return {
      type: 'text',
      text: '泊まりたい日付を1通で送ってね。\n例: 5/3\n例: 5/3-5/5\n例: 2026-05-03',
    };
  }

  if (field === 'adultNum') {
    return {
      type: 'text',
      text: '人数を教えてね。\n例: 2人',
      quickReply: {
        items: buildMessageQuickReplies(['1人', '2人', '3人', '4人']),
      },
    };
  }

  if (field === 'partySize') {
    return {
      type: 'text',
      text: '何人で行く予定か教えてね。\n例: 4人',
      quickReply: {
        items: buildMessageQuickReplies(['2人', '4人', '6人', '8人']),
      },
    };
  }

  const budgetChoices = intake.kind === 'hotel'
    ? ['10000円', '20000円', '30000円', '50000円', '80000円', '100000円']
    : ['3000円', '5000円', '8000円', '10000円'];

  return {
    type: 'text',
    text: intake.kind === 'hotel'
      ? '1人あたりの宿泊予算を教えてね。\n例: 30000円'
      : '1人あたりの予算を教えてね。\n例: 5000円',
    quickReply: {
      items: buildMessageQuickReplies(budgetChoices),
    },
  };
}

function buildMessageQuickReplies(items) {
  return items.map(text => ({
    type: 'action',
    action: {
      type: 'message',
      label: text,
      text,
    },
  }));
}

function applySearchFieldInput(intake, rawText) {
  const field = getNextSearchField(intake);
  const text = String(rawText || '').trim();
  if (!field || !text) {
    return { ok: false, error: 'その条件がまだうまく受け取れなかったの。もう一回だけ送ってね。' };
  }

  if (field === 'keyword') {
    const keyword = sanitizeKeyword(text);
    if (!isSearchKeywordUsable(keyword)) {
      return { ok: false, error: '場所や駅名がまだ少し曖昧かも。新宿、札幌駅、那覇みたいに送ってね。' };
    }
    return { ok: true, patch: { keyword } };
  }

  if (field === 'checkinDate') {
    const params = extractHotelParams(text);
    if (!params.checkinDate) {
      return { ok: false, error: '日付の読み取りが少し難しかったの。5/3 や 5/3-5/5 みたいに送ってね。' };
    }
    return {
      ok: true,
      patch: {
        checkinDate: params.checkinDate,
        checkoutDate: params.checkoutDate || '',
        nights: params.nights || intake.nights || 1,
      },
    };
  }

  if (field === 'adultNum' || field === 'partySize') {
    const match = text.match(/(\d{1,2})/);
    const value = match ? Number(match[1]) : 0;
    if (!Number.isInteger(value) || value < 1 || value > 20) {
      return { ok: false, error: '人数は 1〜20人 くらいで送ってね。例: 4人' };
    }
    return { ok: true, patch: { [field]: value } };
  }

  const budgetYen = parseBudgetYen(text);
  if (!budgetYen) {
    return { ok: false, error: '予算は 5000円 や 3万円 みたいに送ってね。' };
  }
  return { ok: true, patch: { budgetYen } };
}

function parseBudgetYen(text) {
  const match = String(text || '').normalize('NFKC').match(/([0-9]+(?:[.,][0-9]+)?)\s*(万円|万|円|k|K)/);
  if (!match) return null;
  const amount = Number(String(match[1]).replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2];
  if (unit === '万円' || unit === '万') return Math.round(amount * 10000);
  if (unit === 'k' || unit === 'K') return Math.round(amount * 1000);
  return Math.round(amount);
}

function buildSearchExecutionParams(intake) {
  const strategy = intake?.strategy === 'concierge' ? 'concierge' : 'guided';
  if (intake?.kind === 'hotel') {
    return {
      kind: 'hotel',
      keyword: sanitizeKeyword(intake.keyword),
      adultNum: intake.adultNum || (strategy === 'concierge' ? 2 : 1),
      nights: intake.nights || 1,
      checkinDate: intake.checkinDate || '',
      checkoutDate: intake.checkoutDate || '',
      maxCharge: intake.budgetYen || (strategy === 'concierge' ? 30000 : null),
      strategy,
      assumptionNote: buildHotelAssumptionNote(intake, strategy),
    };
  }
  return {
    kind: 'restaurant',
    keyword: sanitizeKeyword(intake.keyword),
    capacity: intake.partySize || null,
    budgetYen: intake.budgetYen || (strategy === 'concierge' ? 5000 : null),
    strategy,
    assumptionNote: buildRestaurantAssumptionNote(intake, strategy),
  };
}

function buildHotelAssumptionNote(intake, strategy) {
  if (strategy !== 'concierge') return '';
  const notes = [];
  if (!intake?.adultNum) notes.push('人数は2人想定');
  if (!intake?.budgetYen) notes.push('予算は3万円/人までで仮置き');
  if (!intake?.nights) notes.push('泊数は1泊想定');
  return notes.join(' / ');
}

function buildRestaurantAssumptionNote(intake, strategy) {
  if (strategy !== 'concierge') return '';
  const notes = [];
  if (!intake?.budgetYen) notes.push('予算は5,000円/人までで仮置き');
  if (!intake?.partySize) notes.push('人数条件なしで探す');
  return notes.join(' / ');
}

function buildSearchIntakeSummary(caseId, intake) {
  const lines = [`案件 ${caseId} の検索条件`];
  lines.push(`モード: ${intake?.strategy === 'concierge' ? '秘書に任せる' : '条件ヒアリング'}`);
  lines.push(`${intake?.kind === 'hotel' ? 'エリア' : '場所'}: ${intake?.keyword || '未入力'}`);
  if (intake?.kind === 'hotel') {
    lines.push(`日付: ${intake?.checkinDate || '未入力'}${intake?.checkoutDate ? ` 〜 ${intake.checkoutDate}` : ''}`);
    lines.push(`人数: ${intake?.adultNum ? `${intake.adultNum}人` : '未入力'}`);
    lines.push(`予算: ${intake?.budgetYen ? `${Number(intake.budgetYen).toLocaleString('ja-JP')}円/人まで` : '未入力'}`);
  } else {
    lines.push(`人数: ${intake?.partySize ? `${intake.partySize}人` : '未入力'}`);
    lines.push(`予算: ${intake?.budgetYen ? `${Number(intake.budgetYen).toLocaleString('ja-JP')}円/人まで` : '未入力'}`);
  }
  return lines.join('\n');
}

module.exports = {
  createSearchIntake,
  isSearchKeywordUsable,
  buildSearchStrategyReply,
  getNextSearchField,
  isSearchIntakeComplete,
  buildSearchIntakePrompt,
  applySearchFieldInput,
  buildSearchExecutionParams,
  buildSearchIntakeSummary,
};
