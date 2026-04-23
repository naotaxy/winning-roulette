'use strict';

const CATEGORY_DEFS = [
  {
    key: 'schedule',
    label: '日程',
    matcher: /(日程|日時|いつ|何日|何時|候補日|空いて|空い|都合|来週|今週|週末|夜|昼|開始)/,
    nextAction: '候補日を2つまでに絞って、可否だけ返してもらう',
  },
  {
    key: 'attendance',
    label: '参加',
    matcher: /(参加|出欠|行ける|いける|来れる|これる|欠席|全員|人数|何人|集ま)/,
    nextAction: '参加可否の返事を先に集める',
  },
  {
    key: 'place',
    label: '場所',
    matcher: /(場所|どこ|店|会場|駅|エリア|吉祥寺|新宿|渋谷|池袋|予約|取れた|とれた)/,
    nextAction: '場所候補を2つまでに絞って、人数に合う方で確定する',
  },
  {
    key: 'budget',
    label: '予算',
    matcher: /(予算|料金|金額|会費|いくら|円|高い|安い)/,
    nextAction: '一人あたりの上限金額を一言で決める',
  },
  {
    key: 'owner',
    label: '担当',
    matcher: /(担当|誰が|予約する|やる|やります|任せて|買ってく|持ってく|準備|用意)/,
    nextAction: '予約か連絡の担当を1人だけ決める',
  },
  {
    key: 'deadline',
    label: '締切',
    matcher: /(締切|しめきり|期限|いつまで|までに|今日中|明日まで)/,
    nextAction: '返事期限を一言置いて、そこで締める',
  },
];

const DECISION_PATTERN = /(決定|決まり|決まった|確定|でいく|で行く|でいこ|でいこう|にする|にしよう|にしよ|それでいく|それで行く|それで|了解|了承|お願いします|予約した|取れた|とれた|やります|任せて|担当する|でok|でOK|okで|OKで|行ける人これで|これで確定)/i;
const PENDING_PATTERN = /(どうする|どうしよ|どうしよう|未定|保留|候補|返事待ち|待ち|募集|確認したい|決めたい|組みたい|調整したい|空いてる|空い|いける|行ける|来れる|これる|いつ|どこ|誰|いくら|何人|どうかな|どう？|\?|？)/i;

const SCENARIOS = {
  drinks: {
    label: '飲み会',
    intro: '飲み会の段取りだね。まず何から投げる？',
    templates: {
      schedule: [
        '【飲み会の日程確認】',
        '候補を2つか3つだけ出すね。',
        '1. ○/○(○) 19:30',
        '2. ○/○(○) 20:00',
        '3. ○/○(○) 19:00',
        '行ける番号だけ返してもらえると、私が次を締めやすいよ。',
      ].join('\n'),
      place: [
        '【飲み会の場所候補】',
        'エリアだけ先に合わせたいです。',
        '1. 吉祥寺',
        '2. 新宿',
        '3. 渋谷',
        '希望が多いところで店を絞ります。',
      ].join('\n'),
      budget: [
        '【飲み会の予算確認】',
        '一人あたりの上限だけ先に合わせたいです。',
        '3,500円くらい / 5,000円くらい / もう少し上でもOK',
        'このへんで返してもらえるとお店を絞りやすいです。',
      ].join('\n'),
      attendance: [
        '【飲み会の参加確認】',
        '参加 / たぶん参加 / むずかしい',
        'だけ返してもらえたら人数を固めます。',
      ].join('\n'),
      summary: [
        '【飲み会の現時点まとめ】',
        '・日程: ○/○ 19:30 で仮',
        '・場所: 吉祥寺寄り',
        '・予算: 5,000円前後',
        '・未返事: ○人',
        'ここまででズレてたら教えてください。',
      ].join('\n'),
    },
  },
  meeting: {
    label: '打ち合わせ',
    intro: '打ち合わせの段取りだね。まず何を固める？',
    templates: {
      schedule: [
        '【打ち合わせ日程確認】',
        '候補を2つだけ出します。',
        '1. ○/○(○) 20:00',
        '2. ○/○(○) 21:00',
        '参加できる番号を返してください。',
      ].join('\n'),
      place: [
        '【打ち合わせ場所確認】',
        'オンライン / 吉祥寺 / 新宿',
        'どれが良さそうかだけ返してもらえると助かります。',
      ].join('\n'),
      budget: [
        '【打ち合わせ予算確認】',
        '今回は基本無料で行く / 交通費だけ / 会議室代あり',
        'このどれかで合わせたいです。',
      ].join('\n'),
      attendance: [
        '【打ち合わせ参加確認】',
        '出席 / 遅れて出席 / むずかしい',
        'で返してください。',
      ].join('\n'),
      summary: [
        '【打ち合わせまとめ】',
        '・日程: ○/○ 20:00 仮',
        '・場所: オンライン寄り',
        '・未決議: 出席者の最終確認',
        'ここまででOKなら進めます。',
      ].join('\n'),
    },
  },
  watch: {
    label: '観戦',
    intro: '観戦やイベントの段取りだね。まずどこから決める？',
    templates: {
      schedule: [
        '【観戦日程確認】',
        '候補日を2つだけ出します。',
        '1. ○/○(○)',
        '2. ○/○(○)',
        '行ける方だけ返してください。',
      ].join('\n'),
      place: [
        '【観戦場所確認】',
        '現地 / スポーツバー / 誰かの家 / オンライン',
        '希望だけ先にください。',
      ].join('\n'),
      budget: [
        '【観戦予算確認】',
        'チケットや飲食を含めて、ざっくりの上限だけ合わせたいです。',
        '低め / 普通 / ちょっと出せる',
      ].join('\n'),
      attendance: [
        '【観戦参加確認】',
        '参加 / たぶん参加 / むずかしい',
        'で返してください。',
      ].join('\n'),
      summary: [
        '【観戦まとめ】',
        '・日程: ○/○ 仮',
        '・場所: ○○寄り',
        '・未返事: ○人',
        'ここまででズレがあれば教えてください。',
      ].join('\n'),
    },
  },
  match: {
    label: '対戦調整',
    intro: '対戦調整だね。何から決めると締まりそう？',
    templates: {
      schedule: [
        '【対戦日程確認】',
        '候補は2つだけ出します。',
        '1. ○/○(○) 夜',
        '2. ○/○(○) 夜',
        '行ける方を返してください。',
      ].join('\n'),
      place: [
        '【対戦方法確認】',
        'オンライン / 現地集合 / あとで個別調整',
        'このどれかで合わせたいです。',
      ].join('\n'),
      budget: [
        '【対戦まわりの費用確認】',
        '参加費あり / なし / 別途相談',
        'だけ先に合わせたいです。',
      ].join('\n'),
      attendance: [
        '【対戦可否確認】',
        '今週いける / 来週ならいける / 今月むずかしい',
        'で返してください。',
      ].join('\n'),
      summary: [
        '【対戦調整まとめ】',
        '・候補日: ○/○ 夜',
        '・方式: オンライン寄り',
        '・未決議: 最終可否',
        'ここまででOKなら締めます。',
      ].join('\n'),
    },
  },
};

const STAGE_DEFS = [
  { key: 'schedule', label: '日程募集' },
  { key: 'place', label: '場所確認' },
  { key: 'budget', label: '予算確認' },
  { key: 'attendance', label: '参加確認' },
  { key: 'summary', label: 'まとめ文' },
];

function detectConciergeIntent(text) {
  const t = normalize(text);
  if (!t) return null;

  const scenario = detectScenario(t);
  if (scenario && /(段取り|手配|調整|決めたい|組みたい|まとめたい|仕切|相談したい)/.test(t)) {
    return { type: 'concierge', action: 'arrange', scenario };
  }
  if (/^(段取り|段取りして|段取りお願い|コンシェルジュ|コンシェルジュして|手配して|調整して|仕切って)$/.test(t)) {
    return { type: 'concierge', action: 'arrange', scenario: null };
  }
  if (/(段取り|手配|調整).*(して|したい|お願い)|(相談|話).*(整理|まとめ)/.test(t)) {
    return { type: 'concierge', action: 'arrange', scenario: scenario || null };
  }
  if (/(未決議|未確定|未定|決まってない|決めること|何が残|何が未決議|返事待ち|次に何すれば|次何すれば|やること整理|要点整理|決まったこと|整理して)/.test(t)) {
    return { type: 'concierge', action: 'pending' };
  }

  return null;
}

function formatPendingDecisionReply(messages = []) {
  if (!Array.isArray(messages) || !messages.length) {
    return [
      'まだ会話の材料が少ないみたい。',
      '少し話してから「@秘書トラペル子 何が未決議？」って呼んでくれたら、私が整理するね。',
    ].join('\n');
  }

  const analyzed = analyzeConversation(messages.slice(-120));
  if (!analyzed.resolved.length && !analyzed.pending.length) {
    return [
      '直近の会話を見たけど、今のところ大きな決めごとは薄そうだったよ。',
      '日程、場所、参加、予算みたいな話が出たあとなら、もっと秘書らしく拾えると思う。',
      '段取りを始めるなら「@秘書トラペル子 段取りして」で私が入口を作るね。',
    ].join('\n');
  }

  const lines = ['直近の会話から、私なりに整理したよ。'];

  if (analyzed.resolved.length) {
    lines.push('');
    lines.push('【決まったこと】');
    analyzed.resolved.forEach(item => {
      lines.push(`・${item.label}: ${item.summary}`);
    });
  }

  if (analyzed.pending.length) {
    lines.push('');
    lines.push('【まだ未決議っぽいこと】');
    analyzed.pending.forEach(item => {
      lines.push(`・${item.label}: ${item.summary}`);
    });
  }

  lines.push('');
  lines.push('【次にこれをやると締まりそう】');
  analyzed.nextActions.slice(0, 3).forEach((item, index) => {
    lines.push(`${index + 1}. ${item}`);
  });

  lines.push('');
  lines.push('あくまで会話から拾った範囲だけど、進行役の一言を作る時の下書きにはなるはず。');
  return lines.join('\n');
}

function buildArrangeStarterReply(scenarioKey = null) {
  if (scenarioKey && SCENARIOS[scenarioKey]) {
    const scenario = SCENARIOS[scenarioKey];
    return buildQuickReplyText(
      scenario.intro,
      STAGE_DEFS.map(stage => ({
        label: stage.label,
        data: `concierge:template:${scenarioKey}:${stage.key}`,
        displayText: `${scenario.label} ${stage.label}`,
      }))
    );
  }

  return buildQuickReplyText(
    '段取りの入口を作るね。何を決めたい？',
    Object.entries(SCENARIOS).map(([key, value]) => ({
      label: value.label,
      data: `concierge:scenario:${key}`,
      displayText: `${value.label}の段取り`,
    }))
  );
}

function handleConciergePostback(data) {
  const parts = String(data || '').split(':');
  const action = parts[1];
  if (action === 'start') return buildArrangeStarterReply();
  if (action === 'scenario') return buildArrangeStarterReply(parts[2] || null);
  if (action === 'template') {
    const scenarioKey = parts[2];
    const stageKey = parts[3];
    return buildArrangeTemplateReply(scenarioKey, stageKey);
  }
  return buildQuickReplyText(
    '秘書の段取りメニューを出すね。',
    [{ label: '段取りを始める', data: 'concierge:start', displayText: '段取りを始める' }]
  );
}

function buildArrangeTemplateReply(scenarioKey, stageKey) {
  const scenario = SCENARIOS[scenarioKey];
  const template = scenario?.templates?.[stageKey];
  if (!scenario || !template) {
    return buildQuickReplyText(
      'ごめんね、その段取りは見失っちゃった。もう一回入口から出すね。',
      [{ label: '段取りを始める', data: 'concierge:start', displayText: '段取りを始める' }]
    );
  }

  const nextButtons = STAGE_DEFS
    .filter(stage => stage.key !== stageKey)
    .slice(0, 4)
    .map(stage => ({
      label: stage.label,
      data: `concierge:template:${scenarioKey}:${stage.key}`,
      displayText: `${scenario.label} ${stage.label}`,
    }));

  return buildQuickReplyText(
    `${scenario.label}のたたき台を作ったよ。必要ならそのまま投げて使って。\n\n${template}`,
    nextButtons
  );
}

function analyzeConversation(messages) {
  const latestByCategory = new Map();

  messages.forEach((message, index) => {
    const raw = String(message?.text || '').trim();
    if (!raw) return;
    const normalized = normalize(raw);

    CATEGORY_DEFS.forEach(def => {
      if (!def.matcher.test(normalized)) return;
      const event = classifyConversationEvent(raw, normalized);
      if (!event) return;

      latestByCategory.set(def.key, {
        type: event,
        label: def.label,
        sender: String(message?.senderName || '誰か').slice(0, 20),
        text: raw,
        index,
        nextAction: def.nextAction,
      });
    });
  });

  const resolved = [];
  const pending = [];

  CATEGORY_DEFS.forEach(def => {
    const item = latestByCategory.get(def.key);
    if (!item) return;
    const summary = summarizeConversationItem(item);
    if (item.type === 'resolved') resolved.push({ label: def.label, summary, nextAction: def.nextAction });
    if (item.type === 'pending') pending.push({ label: def.label, summary, nextAction: def.nextAction, sender: item.sender });
  });

  const nextActions = pending.length
    ? pending.map(item => item.sender && item.sender !== '誰か'
      ? `${item.label}は${item.sender}さん周りの返事を先に固める`
      : item.nextAction)
    : resolved.length
      ? ['今の決定事項を1本のまとめ文で流して固定する']
      : ['まずは日程か参加可否のどちらかを先に聞く'];

  return { resolved, pending, nextActions };
}

function classifyConversationEvent(raw, normalized) {
  if (DECISION_PATTERN.test(raw) || DECISION_PATTERN.test(normalized)) return 'resolved';
  if (PENDING_PATTERN.test(raw) || PENDING_PATTERN.test(normalized)) return 'pending';
  return null;
}

function summarizeConversationItem(item) {
  const snippet = trimText(item.text.replace(/\s+/g, ' '), 42);
  if (item.type === 'resolved') {
    return `${item.sender}さんの「${snippet}」が今はいちばん固そう`;
  }
  return `${item.sender}さん発の「${snippet}」がまだ浮いてそう`;
}

function detectScenario(text) {
  if (/(飲み会|飲み|店決め|店探し)/.test(text)) return 'drinks';
  if (/(打ち合わせ|会議|ミーティング|mtg)/.test(text)) return 'meeting';
  if (/(観戦|イベント|ライブ|試合観|見に行)/.test(text)) return 'watch';
  if (/(対戦調整|対戦|日程調整|マッチング)/.test(text)) return 'match';
  return null;
}

function buildQuickReplyText(text, actions = []) {
  const items = actions.slice(0, 13).map(item => ({
    type: 'action',
    action: {
      type: 'postback',
      label: item.label,
      data: item.data,
      displayText: item.displayText || item.label,
    },
  }));

  const message = { type: 'text', text };
  if (items.length) {
    message.quickReply = { items };
  }
  return message;
}

function trimText(text, max = 42) {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
}

module.exports = {
  detectConciergeIntent,
  formatPendingDecisionReply,
  buildArrangeStarterReply,
  handleConciergePostback,
};
