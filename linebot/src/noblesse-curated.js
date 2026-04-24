'use strict';

const { buildRouteFlex } = require('./transport');

const OUTING_PLACES = [
  {
    id: 'meiji-jingu',
    kind: 'outing',
    name: '明治神宮',
    area: '原宿',
    nearest: '原宿駅',
    zone: 'central',
    type: 'shrine',
    tags: ['神社', '自然', '森', '静か', '駅近'],
    walking: 'medium',
    indoor: 'medium',
    durationHours: 2.5,
    budgetYen: 1500,
    note: '参道の緑が深くて、都心でも気持ちが切り替わりやすい。',
    nearby: '代々木公園側へ抜ける散歩',
    mapQuery: '明治神宮',
  },
  {
    id: 'inokashira-park',
    kind: 'outing',
    name: '井の頭恩賜公園',
    area: '吉祥寺',
    nearest: '吉祥寺駅',
    zone: 'west',
    type: 'park',
    tags: ['公園', '自然', '池', '散歩', '近場'],
    walking: 'low',
    indoor: 'low',
    durationHours: 3,
    budgetYen: 2000,
    note: '池まわりをゆっくり回れて、寄り道の自由度も高い。',
    nearby: '吉祥寺の喫茶か井の頭自然文化園',
    mapQuery: '井の頭恩賜公園',
  },
  {
    id: 'shakujii-park',
    kind: 'outing',
    name: '石神井公園',
    area: '練馬',
    nearest: '石神井公園駅',
    zone: 'west',
    type: 'park',
    tags: ['公園', '自然', '池', '静か', '近場'],
    walking: 'low',
    indoor: 'low',
    durationHours: 3,
    budgetYen: 1500,
    note: '静けさ重視で、歩きすぎずに自然を感じやすい。',
    nearby: '三宝寺池周辺の散策',
    mapQuery: '石神井公園',
  },
  {
    id: 'jindaiji',
    kind: 'outing',
    name: '深大寺と神代植物公園',
    area: '調布',
    nearest: '調布駅または三鷹駅からバス',
    zone: 'west',
    type: 'shrine_park',
    tags: ['神社', '公園', '自然', '植物', '半日'],
    walking: 'medium',
    indoor: 'medium',
    durationHours: 4,
    budgetYen: 3000,
    note: '寺と植物の両方を一度に味わえて、休日の小旅感が強い。',
    nearby: '門前そば',
    mapQuery: '深大寺 神代植物公園',
  },
  {
    id: 'zenpukuji-park',
    kind: 'outing',
    name: '善福寺公園',
    area: '杉並',
    nearest: '上石神井駅または西荻窪駅方面',
    zone: 'west',
    type: 'park',
    tags: ['公園', '自然', '静か', '近場', '散歩'],
    walking: 'low',
    indoor: 'low',
    durationHours: 2.5,
    budgetYen: 1000,
    note: '近場で空気を変えたい時にちょうどいい、静かな公園。',
    nearby: '西荻窪の喫茶',
    mapQuery: '善福寺公園',
  },
  {
    id: 'koishikawa-korakuen',
    kind: 'outing',
    name: '小石川後楽園',
    area: '後楽園',
    nearest: '飯田橋駅または後楽園駅',
    zone: 'central',
    type: 'garden',
    tags: ['庭園', '自然', '和', '駅近', '雨に強め'],
    walking: 'low',
    indoor: 'medium',
    durationHours: 2,
    budgetYen: 2500,
    note: '駅近で整った和の景色。短時間でも満足度を作りやすい。',
    nearby: '飯田橋側の甘味かカフェ',
    mapQuery: '小石川後楽園',
  },
  {
    id: 'takao',
    kind: 'outing',
    name: '高尾山薬王院まわり',
    area: '高尾',
    nearest: '高尾山口駅',
    zone: 'west',
    type: 'mountain_shrine',
    tags: ['神社', '自然', '山', 'しっかり歩く', '半日'],
    walking: 'high',
    indoor: 'low',
    durationHours: 6,
    budgetYen: 4000,
    note: '自然感はかなり強いけど、体力を使う前提で組むと気持ちいい。',
    nearby: '温浴施設',
    mapQuery: '高尾山薬王院',
  },
];

const SHOPPING_SPOTS = [
  {
    id: 'harajuku-sneaker',
    kind: 'shopping',
    category: 'sneaker',
    name: '原宿・表参道スニーカー巡り',
    area: '原宿',
    nearest: '原宿駅',
    zone: 'central',
    tags: ['スニーカー', '新作', '定番', '比較しやすい'],
    walking: 'medium',
    indoor: 'medium',
    budgetLow: 10000,
    budgetHigh: 30000,
    note: '大型店とセレクトをまとめて見やすく、最初の一手に向く。',
    nearby: 'キャットストリート',
    mapQuery: '原宿 スニーカーショップ',
  },
  {
    id: 'shinjuku-sneaker',
    kind: 'shopping',
    category: 'sneaker',
    name: '新宿南口〜東口スニーカー巡り',
    area: '新宿',
    nearest: '新宿駅',
    zone: 'central',
    tags: ['スニーカー', '駅近', '比較しやすい', '雨に強め'],
    walking: 'low',
    indoor: 'high',
    budgetLow: 9000,
    budgetHigh: 28000,
    note: '駅近で雨にも強く、時間がない日に回しやすい。',
    nearby: 'NEWoManやサザンテラス',
    mapQuery: '新宿 スニーカーショップ',
  },
  {
    id: 'ueno-sneaker',
    kind: 'shopping',
    category: 'sneaker',
    name: '上野アメ横スニーカー巡り',
    area: '上野',
    nearest: '上野御徒町駅',
    zone: 'east',
    tags: ['スニーカー', '価格重視', '掘り出し物'],
    walking: 'medium',
    indoor: 'low',
    budgetLow: 7000,
    budgetHigh: 22000,
    note: '価格比較で粘りたい時に向く。安さ寄り。',
    nearby: 'アメ横の軽食',
    mapQuery: 'アメ横 スニーカーショップ',
  },
  {
    id: 'kichijoji-sneaker',
    kind: 'shopping',
    category: 'sneaker',
    name: '吉祥寺スニーカー巡り',
    area: '吉祥寺',
    nearest: '吉祥寺駅',
    zone: 'west',
    tags: ['スニーカー', '街歩き', '落ち着く'],
    walking: 'medium',
    indoor: 'medium',
    budgetLow: 10000,
    budgetHigh: 25000,
    note: '街の温度感がやわらかく、買い物が気張りすぎない。',
    nearby: '中道通り',
    mapQuery: '吉祥寺 スニーカーショップ',
  },
  {
    id: 'kappabashi-utensils',
    kind: 'shopping',
    category: 'tableware',
    name: '合羽橋道具街の器巡り',
    area: '浅草',
    nearest: '田原町駅または浅草駅',
    zone: 'east',
    tags: ['器', '普段使い', '幅広い', '価格差が大きい'],
    walking: 'medium',
    indoor: 'medium',
    budgetLow: 1000,
    budgetHigh: 15000,
    note: '品数が広くて、料理道具も一緒に見やすい。',
    nearby: '浅草の喫茶',
    mapQuery: '合羽橋道具街 食器',
  },
  {
    id: 'kuramae-utensils',
    kind: 'shopping',
    category: 'tableware',
    name: '蔵前の作家もの器巡り',
    area: '蔵前',
    nearest: '蔵前駅',
    zone: 'east',
    tags: ['器', '作家もの', 'ギフト', '雰囲気重視'],
    walking: 'low',
    indoor: 'medium',
    budgetLow: 3000,
    budgetHigh: 20000,
    note: '少し背伸びしたい時や、贈り物を見たい時に強い。',
    nearby: '隅田川沿いのカフェ',
    mapQuery: '蔵前 うつわ',
  },
  {
    id: 'nihonbashi-utensils',
    kind: 'shopping',
    category: 'tableware',
    name: '日本橋の百貨店系うつわ巡り',
    area: '日本橋',
    nearest: '三越前駅または日本橋駅',
    zone: 'central',
    tags: ['器', '駅近', '雨に強め', '定番', 'ギフト'],
    walking: 'low',
    indoor: 'high',
    budgetLow: 3000,
    budgetHigh: 25000,
    note: '雨でも動きやすく、無難に外しにくい。',
    nearby: 'コレド室町',
    mapQuery: '日本橋 食器',
  },
  {
    id: 'kichijoji-utensils',
    kind: 'shopping',
    category: 'tableware',
    name: '吉祥寺の暮らし道具・器巡り',
    area: '吉祥寺',
    nearest: '吉祥寺駅',
    zone: 'west',
    tags: ['器', '普段使い', '街歩き', '落ち着く'],
    walking: 'medium',
    indoor: 'medium',
    budgetLow: 2000,
    budgetHigh: 15000,
    note: '日常使いの器を気持ちよく選びやすい街歩き型。',
    nearby: '中道通りの雑貨店',
    mapQuery: '吉祥寺 うつわ',
  },
];

function detectOutingRequest(text) {
  return /(神社|公園|自然|緑|庭園|散歩|日帰り|おでかけ|出かけ|森林|小旅)/.test(String(text || ''));
}

function detectShoppingRequest(text) {
  return /(スニーカー|靴|シューズ|器|うつわ|食器|皿|マグ|茶碗|鉢|プレート|花瓶)/.test(String(text || ''));
}

function detectCuratedPlanCommand(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (/^(旅のしおり|しおり|おでかけしおり|買い物しおり|今日のしおり)(を)?(見せて|作って|出して)?$/.test(t)) {
    return { type: 'curatedPlan', action: 'itinerary' };
  }
  if (/(途中変更|ルート変更|予定変更|再提案|別案|雨|屋内|歩くの減ら|疲れた|時間なくな|時間ない|もっと安|予算下げ|駅近|今ここ|現在地|黒系|白系|ギフト|普段使い|作家もの)/.test(t)) {
    return { type: 'curatedPlan', action: 'adjust', text: t };
  }
  return null;
}

function createCuratedPlanState({ kind, requestText, actorName, ownerUserId, option }) {
  const request = String(requestText || '').trim();
  const base = {
    kind,
    option: option || '',
    requestText: request.slice(0, 300),
    origin: extractOrigin(request),
    durationHours: extractDurationHours(request),
    budgetYen: extractBudgetYen(request),
    walkingLevel: extractWalkingLevel(request),
    weatherMode: extractWeatherMode(request),
    selectedIndex: null,
    itineraryText: '',
    candidates: [],
    awaitingField: '',
    status: 'collecting',
    ownerUserId: String(ownerUserId || '').slice(0, 60),
    ownerName: String(actorName || '').slice(0, 50),
    updatedAt: Date.now(),
  };

  if (kind === 'outing') {
    return {
      ...base,
      theme: extractOutingTheme(request),
    };
  }

  return {
    ...base,
    category: extractShoppingCategory(request),
    style: extractShoppingStyle(request),
  };
}

function getNextCuratedField(state) {
  if (!state?.origin) return 'origin';
  if (state.kind === 'outing') {
    if (!state.durationHours) return 'durationHours';
    return '';
  }
  if (!state.budgetYen) return 'budgetYen';
  return '';
}

function buildCuratedPrompt(caseId, state) {
  const field = getNextCuratedField(state);
  if (!field) {
    return {
      type: 'text',
      text: [
        buildCuratedSummary(caseId, state),
        state.kind === 'outing'
          ? 'この条件で候補を出すね。'
          : 'この条件で買い物候補を出すね。',
      ].join('\n\n'),
    };
  }

  if (field === 'origin') {
    return {
      type: 'text',
      text: state.kind === 'outing'
        ? 'どこから動き始めるか教えてね。\n例: 中野区の東橋バス停 / 新宿駅 / 今ここは吉祥寺'
        : 'どの街から回り始めたいか教えてね。\n例: 新宿駅 / 中野 / 今ここは渋谷',
    };
  }

  if (field === 'durationHours') {
    return {
      type: 'text',
      text: 'どのくらいの時間で回したいか教えてね。\n例: 2時間 / 半日 / 1日',
      quickReply: {
        items: buildMessageQuickReplies(['2時間', '3時間', '半日', '1日']),
      },
    };
  }

  return {
    type: 'text',
    text: state.category === 'sneaker'
      ? '予算を教えてね。\n例: 15000円 / 2万円'
      : '器の予算を教えてね。\n例: 5000円 / 1万円',
    quickReply: {
      items: buildMessageQuickReplies(state.category === 'sneaker'
        ? ['10000円', '15000円', '20000円', '30000円']
        : ['3000円', '5000円', '10000円', '15000円']),
    },
  };
}

function buildCuratedSummary(caseId, state) {
  const lines = [`案件 ${caseId} の${state.kind === 'outing' ? 'おでかけ条件' : '買い物条件'}`];
  lines.push(`出発: ${state.origin || '未入力'}`);
  if (state.kind === 'outing') {
    lines.push(`雰囲気: ${formatOutingTheme(state.theme)}`);
    lines.push(`所要時間: ${state.durationHours ? `${state.durationHours}時間くらい` : '未入力'}`);
    lines.push(`歩く量: ${formatWalkingLevel(state.walkingLevel)}`);
  } else {
    lines.push(`探したい物: ${formatShoppingCategory(state.category)}`);
    if (state.style) lines.push(`寄せたい方向: ${state.style}`);
    lines.push(`予算: ${state.budgetYen ? `${Number(state.budgetYen).toLocaleString('ja-JP')}円くらい` : '未入力'}`);
  }
  if (state.weatherMode === 'indoor') lines.push('補正: 雨・屋内寄り');
  return lines.join('\n');
}

function applyCuratedFieldInput(state, rawText) {
  const field = getNextCuratedField(state);
  const text = String(rawText || '').trim();
  if (!field || !text) {
    return { ok: false, error: 'その条件、もう一回だけ教えてね。' };
  }

  if (field === 'origin') {
    const origin = extractOrigin(text) || text.slice(0, 40);
    if (origin.length < 2) {
      return { ok: false, error: '出発地は、駅名やバス停名くらいまで入れてくれると助かるの。' };
    }
    return { ok: true, patch: { origin } };
  }

  if (field === 'durationHours') {
    const hours = extractDurationHours(text);
    if (!hours) {
      return { ok: false, error: '時間は「2時間」「半日」「1日」みたいに送ってね。' };
    }
    return { ok: true, patch: { durationHours: hours } };
  }

  const budgetYen = extractBudgetYen(text);
  if (!budgetYen) {
    return { ok: false, error: '予算は「5000円」や「2万円」みたいに送ってね。' };
  }
  return { ok: true, patch: { budgetYen } };
}

function rankCuratedCandidates(state) {
  const items = state.kind === 'outing' ? OUTING_PLACES : SHOPPING_SPOTS.filter(item => item.category === state.category);
  const avoidIds = Array.isArray(state?.avoidIds) ? new Set(state.avoidIds) : new Set();
  return items
    .map(item => ({ ...item, score: scoreCuratedItem(item, state) - (avoidIds.has(item.id) ? 25 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function buildCuratedCandidatesFlex(caseId, state, candidates) {
  const bubbles = (candidates || []).map((item, index) => ({
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#14324a',
      contents: [
        { type: 'text', text: item.name, color: '#ffffff', size: 'sm', weight: 'bold', wrap: true },
        { type: 'text', text: `${item.area} / ${item.nearest}`, color: '#b7c3cd', size: 'xs', margin: 'xs', wrap: true },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: 'md',
      contents: [
        { type: 'text', text: item.note, size: 'xs', color: '#444444', wrap: true },
        { type: 'text', text: buildCandidateMeta(item, state), size: 'xs', color: '#555555', margin: 'sm', wrap: true },
        ...(item.nearby ? [{ type: 'text', text: `寄り道: ${item.nearby}`, size: 'xs', color: '#666666', margin: 'sm', wrap: true }] : []),
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: 'sm',
      contents: [
        {
          type: 'button',
          style: 'secondary',
          height: 'sm',
          action: {
            type: 'uri',
            label: '地図で見る',
            uri: buildSearchMapUrl(item.mapQuery),
          },
        },
        {
          type: 'button',
          style: 'primary',
          height: 'sm',
          margin: 'sm',
          action: {
            type: 'postback',
            label: state.kind === 'outing' ? 'ここでしおりを作る' : 'ここを軸に回る',
            data: `noblesse:curated_pick:${caseId}:${index}`,
            displayText: state.kind === 'outing' ? `${item.name} でしおりを作る` : `${item.name} を見に行く`,
          },
        },
      ],
    },
  }));

  return {
    type: 'flex',
    altText: state.kind === 'outing' ? 'おでかけ候補をまとめたよ。' : '買い物候補をまとめたよ。',
    contents: { type: 'carousel', contents: bubbles },
  };
}

function buildCuratedGuideText(caseId, state, candidates) {
  const top = candidates?.[0];
  if (!top) {
    return state.kind === 'outing'
      ? `案件 ${caseId} の条件だと、まだいいおでかけ先を出し切れなかったの。条件を少し変えようか。`
      : `案件 ${caseId} の条件だと、まだいい買い物先を出し切れなかったの。条件を少し変えようか。`;
  }

  return [
    state.kind === 'outing'
      ? `案件 ${caseId} の候補、今の条件ならまずは「${top.name}」がきれい。`
      : `案件 ${caseId} の候補、今の条件ならまずは「${top.name}」がきれい。`,
    state.kind === 'outing'
      ? '気になる場所を押すと、そのまま旅のしおりまで作るよ。'
      : '気になる候補を押すと、そのまま買い物の回り方まで作るよ。',
  ].join('\n');
}

function buildCuratedItinerary(caseId, state, candidate) {
  const origin = state.origin || 'いまいる場所';
  if (state.kind === 'outing') {
    return [
      `【旅のしおり】`,
      `案件: ${caseId}`,
      `出発: ${origin}`,
      `目的地: ${candidate.name}（${candidate.nearest}）`,
      '',
      '流れ',
      `1. ${origin} から ${candidate.nearest} 方面へバスと電車で移動`,
      `2. ${candidate.name} を ${Math.max(1, Math.round(candidate.durationHours))}〜${Math.max(2, Math.round(candidate.durationHours + 1))}時間くらいで回る`,
      `3. 余裕があれば ${candidate.nearby || '周辺の喫茶'} に寄る`,
      '',
      '見どころ',
      candidate.note,
      '',
      '予算感',
      `${Number(candidate.budgetYen || state.budgetYen || 0).toLocaleString('ja-JP')}円前後`,
      '',
      '変更したくなった時',
      '「雨だから屋内寄り」「歩くの減らしたい」「時間なくなった」「今ここは○○」で組み直せるよ。',
    ].join('\n');
  }

  return [
    `【買い物しおり】`,
    `案件: ${caseId}`,
    `出発: ${origin}`,
    `目的地: ${candidate.name}（${candidate.nearest}）`,
    '',
    '回り方',
    `1. ${origin} から ${candidate.area} へ移動`,
    `2. ${candidate.name} を軸に、${candidate.nearby || '周辺の店'} を軽く回る`,
    `3. 迷ったら予算と履き心地 / 持ちやすさを優先して絞る`,
    '',
    '選び方メモ',
    candidate.category === 'sneaker'
      ? 'サイズ感、履いた時の甲まわり、ソールの硬さ、普段の服との合わせやすさを先に見る'
      : '重さ、口当たり、電子レンジ・食洗機の扱いやすさ、料理を盛った時の余白を先に見る',
    '',
    '変更したくなった時',
    '「もっと安く」「駅近で」「黒系に寄せて」「ギフト向けに」で組み直せるよ。',
  ].join('\n');
}

function buildCuratedAdjustmentReply(caseId, currentState, text) {
  const next = { ...currentState };
  const notices = [];

  if (/今ここ|現在地/.test(text)) {
    const origin = extractOrigin(text.replace(/^(今ここは?|現在地は?)/, '')) || text.replace(/^(今ここは?|現在地は?)/, '').trim();
    if (origin) {
      next.origin = origin.slice(0, 40);
      notices.push(`出発地を「${next.origin}」に更新`);
    }
  }
  if (/雨|屋内/.test(text)) {
    next.weatherMode = 'indoor';
    notices.push('雨・屋内寄りに補正');
  }
  if (/歩くの減ら|疲れた|駅近/.test(text)) {
    next.walkingLevel = 'low';
    notices.push('歩く量を少なめに補正');
  }
  if (/時間なくな|時間ない/.test(text)) {
    next.durationHours = Math.max(1, Math.min(next.durationHours || 3, 2));
    notices.push('所要時間を短めに補正');
  }
  if (/もっと安|予算下げ/.test(text)) {
    next.budgetYen = next.budgetYen ? Math.max(1000, Math.round(next.budgetYen * 0.75)) : (next.kind === 'outing' ? 1500 : 5000);
    notices.push('予算を下げて再計算');
  }
  if (/別案|再提案/.test(text)) {
    const current = Number.isInteger(next.selectedIndex) && Array.isArray(next.candidates)
      ? next.candidates[next.selectedIndex]
      : null;
    next.avoidIds = Array.isArray(next.avoidIds) ? [...next.avoidIds] : [];
    if (current?.id && !next.avoidIds.includes(current.id)) next.avoidIds.push(current.id);
    notices.push('今の本命を外して別案を前に出す');
  }
  if (next.kind === 'shopping') {
    const style = extractShoppingStyle(text);
    if (style) {
      next.style = style;
      notices.push(`寄せ方を「${style}」に補正`);
    }
  }

  if (!notices.length) {
    return {
      ok: false,
      error: '変えたい方向がまだ少し曖昧だったの。「雨だから屋内寄り」「歩くの減らしたい」「もっと安く」みたいに言ってくれると組み直しやすいよ。',
    };
  }

  return { ok: true, state: next, note: notices.join(' / ') };
}

function buildCuratedRouteFlex(state, candidate) {
  return buildRouteFlex(state.origin || '現在地', candidate.name);
}

function buildCuratedShareText(caseId, state, candidate, itineraryText) {
  return [
    state.kind === 'outing' ? '【おでかけ共有】' : '【買い物共有】',
    `案件: ${caseId}`,
    `候補: ${candidate.name}`,
    `出発: ${state.origin || '未設定'}`,
    itineraryText,
  ].join('\n\n');
}

function buildSearchMapUrl(query) {
  return `https://www.google.com/maps/search/${encodeURIComponent(query || '')}`;
}

function scoreCuratedItem(item, state) {
  let score = 0;

  if (state.kind === 'outing') {
    if (state.theme === 'shrine' && /神社/.test(item.tags.join(' '))) score += 30;
    if (state.theme === 'park' && /公園|庭園/.test(item.tags.join(' '))) score += 30;
    if (state.theme === 'nature') score += 20;
    if (state.durationHours) score += 18 - Math.min(12, Math.abs((item.durationHours || 3) - state.durationHours) * 5);
    if (state.budgetYen) score += (item.budgetYen || 0) <= state.budgetYen ? 12 : -8;
  } else {
    if (item.category === state.category) score += 35;
    if (state.budgetYen) {
      if (state.budgetYen >= item.budgetLow && state.budgetYen <= item.budgetHigh) score += 18;
      else if (state.budgetYen > item.budgetHigh) score += 8;
      else score -= 10;
    }
    if (state.style && item.tags.some(tag => state.style.includes(tag) || tag.includes(state.style))) score += 12;
    if (state.style === 'ギフト' && /ギフト/.test(item.tags.join(' '))) score += 10;
    if (state.style === '作家もの' && /作家もの/.test(item.tags.join(' '))) score += 14;
    if (state.style === '普段使い' && /普段使い/.test(item.tags.join(' '))) score += 14;
    if ((state.style === '黒系' || state.style === '白系') && /比較しやすい|定番|新作/.test(item.tags.join(' '))) score += 8;
  }

  if (state.walkingLevel === 'low' && item.walking === 'low') score += 18;
  if (state.walkingLevel === 'high' && item.walking === 'high') score += 10;
  if (state.weatherMode === 'indoor') {
    score += item.indoor === 'high' ? 18 : item.indoor === 'medium' ? 8 : -8;
  }

  const originZone = inferZoneFromOrigin(state.origin || '');
  if (originZone && item.zone === originZone) score += 15;
  if (state.origin && item.area && state.origin.includes(item.area)) score += 24;
  if (state.origin && item.nearest && state.origin.includes(item.nearest.replace(/駅$/, ''))) score += 20;

  return score;
}

function inferZoneFromOrigin(origin) {
  const t = String(origin || '');
  if (!t) return '';
  if (/(中野|杉並|新宿|吉祥寺|高尾|西荻|阿佐ヶ谷|荻窪|練馬|中野区)/.test(t)) return 'west';
  if (/(上野|浅草|蔵前|錦糸町|押上|東陽|江東|墨田|台東)/.test(t)) return 'east';
  if (/(渋谷|原宿|表参道|飯田橋|後楽園|新橋|日本橋|東京駅)/.test(t)) return 'central';
  return '';
}

function buildCandidateMeta(item, state) {
  if (state.kind === 'outing') {
    return `雰囲気: ${item.tags.slice(0, 3).join(' / ')}\n歩く量: ${formatWalkingLevel(item.walking)}\n目安: ${item.durationHours}時間 / ${Number(item.budgetYen).toLocaleString('ja-JP')}円前後`;
  }
  return `得意: ${item.tags.slice(0, 3).join(' / ')}\n歩きやすさ: ${formatWalkingLevel(item.walking)}\n価格感: ${Number(item.budgetLow).toLocaleString('ja-JP')}〜${Number(item.budgetHigh).toLocaleString('ja-JP')}円`;
}

function extractOrigin(text) {
  const source = String(text || '').trim();
  const nowHere = source.match(/(?:今ここは?|現在地は?)\s*(.{2,30})$/);
  if (nowHere) return nowHere[1].trim();
  const m = source.match(/(.{2,30}?)(?:から|発)/);
  return m ? m[1].trim() : '';
}

function extractDurationHours(text) {
  const t = String(text || '');
  if (/1日|丸1日|丸一日/.test(t)) return 6;
  if (/半日|午後だけ|午前だけ/.test(t)) return 4;
  const m = t.match(/(\d{1,2})\s*時間/);
  return m ? Number(m[1]) : null;
}

function extractBudgetYen(text) {
  const m = String(text || '').normalize('NFKC').match(/([0-9]+(?:[.,][0-9]+)?)\s*(万円|万|円|k|K)/);
  if (!m) return null;
  const amount = Number(String(m[1]).replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (m[2] === '万円' || m[2] === '万') return Math.round(amount * 10000);
  if (m[2] === 'k' || m[2] === 'K') return Math.round(amount * 1000);
  return Math.round(amount);
}

function extractWalkingLevel(text) {
  const t = String(text || '');
  if (/歩くの減ら|疲れた|楽に|駅近|近場/.test(t)) return 'low';
  if (/たくさん歩|散策したい|がっつり歩/.test(t)) return 'high';
  return 'medium';
}

function extractWeatherMode(text) {
  return /(雨|屋内)/.test(String(text || '')) ? 'indoor' : 'normal';
}

function extractOutingTheme(text) {
  const t = String(text || '');
  if (/神社/.test(t) && !/公園/.test(t)) return 'shrine';
  if (/公園|庭園/.test(t) && !/神社/.test(t)) return 'park';
  return 'nature';
}

function extractShoppingCategory(text) {
  return /(器|うつわ|食器|皿|マグ|茶碗|鉢|プレート|花瓶)/.test(String(text || '')) ? 'tableware' : 'sneaker';
}

function extractShoppingStyle(text) {
  const t = String(text || '');
  if (/黒系|黒め|モノトーン/.test(t)) return '黒系';
  if (/白系|白め/.test(t)) return '白系';
  if (/ギフト|贈り物/.test(t)) return 'ギフト';
  if (/普段使い|日常使い/.test(t)) return '普段使い';
  if (/作家もの|一点もの/.test(t)) return '作家もの';
  return '';
}

function formatOutingTheme(theme) {
  switch (theme) {
    case 'shrine':
      return '神社寄り';
    case 'park':
      return '公園寄り';
    default:
      return '自然を感じる寄り';
  }
}

function formatShoppingCategory(category) {
  return category === 'tableware' ? '器・食器' : 'スニーカー';
}

function formatWalkingLevel(level) {
  switch (level) {
    case 'low':
      return '少なめ';
    case 'high':
      return 'しっかり歩く';
    default:
      return 'ふつう';
  }
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

module.exports = {
  detectOutingRequest,
  detectShoppingRequest,
  detectCuratedPlanCommand,
  createCuratedPlanState,
  getNextCuratedField,
  buildCuratedPrompt,
  buildCuratedSummary,
  applyCuratedFieldInput,
  rankCuratedCandidates,
  buildCuratedCandidatesFlex,
  buildCuratedGuideText,
  buildCuratedItinerary,
  buildCuratedAdjustmentReply,
  buildCuratedRouteFlex,
  buildCuratedShareText,
};
