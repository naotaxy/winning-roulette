'use strict';

function buildPreparedSendFlex(caseId, title, enabled) {
  return {
    type: 'flex',
    altText: `案件 ${caseId} の送信確認`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#132238',
        contents: [
          { type: 'text', text: '送信する？', color: '#ffffff', size: 'sm', weight: 'bold' },
          { type: 'text', text: `案件 ${caseId}`, color: '#a7b0ba', size: 'xs', margin: 'xs' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: title || 'この文面', size: 'sm', wrap: true, color: '#444444' },
          {
            type: 'text',
            text: enabled
              ? '送信先を選んで、このトークか個人トークへ送れるよ。'
              : 'まだ未入力のところが残ってるから、そのままの自動送信は止めておくね。',
            size: 'xs',
            color: '#777777',
            wrap: true,
            margin: 'md',
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: 'sm',
        contents: enabled
          ? [{
            type: 'button',
            style: 'primary',
            height: 'sm',
            action: {
              type: 'postback',
              label: '送信先を選ぶ',
              data: `noblesse:select_send_target:${caseId}`,
              displayText: '送信先を選ぶ',
            },
          }]
          : [{
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: {
              type: 'postback',
              label: '未入力あり',
              data: `noblesse:noop:${caseId}:draft_incomplete`,
              displayText: 'まだ送れない',
            },
          }],
      },
    },
  };
}

function buildDecisionActionFlex(caseId, kind, item) {
  const title = kind === 'hotel' ? 'このホテルで進める？' : 'このお店で進める？';
  const note = kind === 'hotel'
    ? '最終予約の確定ボタンはまだ押さないけど、予約導線と共有送信まではここで進められるよ。'
    : '電話や予約ページへ進めるよ。必要なら、この内容をみんなに送るところまでやるね。';

  const footerButtons = [];
  if (kind === 'restaurant' && item?.phone) {
    footerButtons.push({
      type: 'button',
      style: 'secondary',
      height: 'sm',
      action: {
        type: 'uri',
        label: '電話する',
        uri: `tel:${item.phone}`,
      },
    });
  }
  if (item?.url) {
    const reserveButton = {
      type: 'button',
      style: 'primary',
      height: 'sm',
      action: {
        type: 'uri',
        label: kind === 'hotel' ? '予約ページを開く' : '予約ページを開く',
        uri: item.url,
      },
    };
    if (footerButtons.length) reserveButton.margin = 'sm';
    footerButtons.push(reserveButton);
  }
  footerButtons.push({
    type: 'button',
    style: 'link',
    height: 'sm',
    margin: 'sm',
    action: {
      type: 'postback',
      label: '送信先を選ぶ',
      data: `noblesse:select_send_target:${caseId}`,
      displayText: '送信先を選ぶ',
    },
  });

  return {
    type: 'flex',
    altText: `案件 ${caseId} の最終確認`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#132238',
        contents: [
          { type: 'text', text: title, color: '#ffffff', size: 'sm', weight: 'bold' },
          { type: 'text', text: `案件 ${caseId}`, color: '#a7b0ba', size: 'xs', margin: 'xs' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: item?.name || '候補', size: 'sm', weight: 'bold', wrap: true },
          ...(item?.address ? [{ type: 'text', text: item.address, size: 'xs', color: '#666666', margin: 'xs', wrap: true }] : []),
          ...(item?.budget ? [{ type: 'text', text: `予算: ${item.budget}`, size: 'xs', color: '#444444', margin: 'sm', wrap: true }] : []),
          ...(item?.price ? [{ type: 'text', text: `料金: ${item.price}`, size: 'xs', color: '#444444', margin: 'sm', wrap: true }] : []),
          ...(item?.review ? [{ type: 'text', text: item.review, size: 'xs', color: '#444444', margin: 'sm', wrap: true }] : []),
          { type: 'text', text: note, size: 'xs', color: '#777777', margin: 'md', wrap: true },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: 'sm',
        contents: footerButtons,
      },
    },
  };
}

function buildDecisionShareText(caseId, kind, item) {
  const heading = kind === 'hotel' ? '【宿の候補共有】' : '【お店の候補共有】';
  const lines = [
    heading,
    `案件: ${caseId}`,
    `${kind === 'hotel' ? '候補' : '候補'}: ${item?.name || '未設定'}`,
  ];
  if (item?.address) lines.push(`場所: ${item.address}`);
  if (item?.budget) lines.push(`予算目安: ${item.budget}`);
  if (item?.price) lines.push(`料金目安: ${item.price}`);
  if (item?.review) lines.push(`${item.review}`);
  if (item?.phone) lines.push(`電話: ${item.phone}`);
  if (item?.url) lines.push(`予約導線: ${item.url}`);
  lines.push('最終確定は各ページ側でお願いね。');
  return lines.join('\n');
}

function buildSendTargetFlex(caseId, title, targets = []) {
  const buttons = targets.slice(0, 3).map((target, index) => {
    const button = {
      type: 'button',
      style: index === 0 ? 'primary' : 'secondary',
      height: 'sm',
      action: {
        type: 'postback',
        label: target.label,
        data: `noblesse:send_prepared:${caseId}:${target.kind}`,
        displayText: `${target.label}で送る`,
      },
    };
    if (index) button.margin = 'sm';
    return button;
  });

  return {
    type: 'flex',
    altText: `案件 ${caseId} の送信先選択`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#132238',
        contents: [
          { type: 'text', text: 'どこへ送る？', color: '#ffffff', size: 'sm', weight: 'bold' },
          { type: 'text', text: `案件 ${caseId}`, color: '#a7b0ba', size: 'xs', margin: 'xs' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: title || 'この文面', size: 'sm', wrap: true, color: '#444444' },
          {
            type: 'text',
            text: '依頼者や管理者への個人送信は、Botとその相手が1対1でつながっている時に使えるよ。',
            size: 'xs',
            color: '#777777',
            wrap: true,
            margin: 'md',
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: 'sm',
        contents: buttons.length ? buttons : [{
          type: 'button',
          style: 'secondary',
          height: 'sm',
          action: {
            type: 'postback',
            label: '送れない',
            data: `noblesse:noop:${caseId}:send_target_unavailable`,
            displayText: '送信先なし',
          },
        }],
      },
    },
  };
}

module.exports = {
  buildPreparedSendFlex,
  buildDecisionActionFlex,
  buildDecisionShareText,
  buildSendTargetFlex,
};
