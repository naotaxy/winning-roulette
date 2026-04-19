'use strict';

function buildConfirmFlex(ocr, msgId) {
  const away = ocr.awayChar?.playerName || '（未検出）';
  const home = ocr.homeChar?.playerName || '（未検出）';
  const awayScore = ocr.awayScore != null ? String(ocr.awayScore) : '?';
  const homeScore = ocr.homeScore != null ? String(ocr.homeScore) : '?';
  const hasMissing = away === '（未検出）' || home === '（未検出）'
                  || awayScore === '?' || homeScore === '?';
  const pkText = (ocr.awayPK != null && ocr.homePK != null)
    ? `PK ${ocr.awayPK} - ${ocr.homePK}` : null;

  const okLabel = hasMissing ? '⚠️ このまま登録' : '✅ OK 登録';

  return {
    type: 'flex',
    altText: `試合結果確認: ${away} ${awayScore}-${homeScore} ${home}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#0d1b2a',
        contents: [{
          type: 'text', text: '📊 試合結果 OCR確認',
          color: '#ffffff', size: 'sm', weight: 'bold',
        }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          /* チーム名行 */
          {
            type: 'box', layout: 'horizontal', spacing: 'md',
            contents: [
              teamBox('AWAY', away, away === '（未検出）'),
              { type: 'text', text: 'vs', align: 'center', gravity: 'center', size: 'sm', color: '#888888', flex: 1 },
              teamBox('HOME', home, home === '（未検出）'),
            ],
          },
          /* スコア */
          {
            type: 'box', layout: 'horizontal', spacing: 'md', justifyContent: 'center',
            contents: [
              scoreBox(awayScore, awayScore === '?'),
              { type: 'text', text: '-', align: 'center', gravity: 'center', size: 'xxl', weight: 'bold', color: '#333333', flex: 1 },
              scoreBox(homeScore, homeScore === '?'),
            ],
          },
          /* PK（あれば） */
          ...(pkText ? [{
            type: 'text', text: pkText, align: 'center', size: 'sm', color: '#555555',
          }] : []),
          /* 未検出警告 */
          ...(hasMissing ? [{
            type: 'text',
            text: '⚠️ 未検出の項目があります。このまま登録するかキャンセルしてアプリで修正してください。',
            wrap: true, size: 'xs', color: '#cc6600',
          }] : []),
        ],
      },
      footer: {
        type: 'box', layout: 'horizontal', spacing: 'md',
        contents: [
          {
            type: 'button', style: 'primary', color: hasMissing ? '#cc6600' : '#1a73e8',
            action: { type: 'postback', label: okLabel, data: `ocr_ok:${msgId}` },
            flex: 1,
          },
          {
            type: 'button', style: 'secondary',
            action: { type: 'postback', label: '❌ キャンセル', data: `ocr_ng:${msgId}` },
            flex: 1,
          },
        ],
      },
    },
  };
}

function buildCompleteFlex(pending) {
  const { away, home, awayScore, homeScore, awayPK, homePK, year, month } = pending;
  const pkText = (awayPK != null && homePK != null) ? ` (PK ${awayPK}-${homePK})` : '';
  return {
    type: 'flex',
    altText: `登録完了: ${away} ${awayScore}-${homeScore} ${home}`,
    contents: {
      type: 'bubble', size: 'kilo',
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: '✅ 登録完了', weight: 'bold', size: 'md', color: '#1a73e8' },
          { type: 'text', text: `${away} ${awayScore} - ${homeScore} ${home}${pkText}`, wrap: true, size: 'sm' },
          { type: 'text', text: `${year}年${month}月 に保存しました`, size: 'xs', color: '#888888' },
        ],
      },
    },
  };
}

function teamBox(label, name, missing) {
  return {
    type: 'box', layout: 'vertical', flex: 4,
    contents: [
      { type: 'text', text: label, size: 'xs', color: '#888888', align: 'center' },
      { type: 'text', text: name, size: 'sm', weight: 'bold', align: 'center', wrap: true,
        color: missing ? '#cc6600' : '#1a1a1a' },
    ],
  };
}

function scoreBox(score, missing) {
  return {
    type: 'text', text: score, align: 'center', gravity: 'center',
    size: 'xxl', weight: 'bold', flex: 4,
    color: missing ? '#cc0000' : '#1a1a1a',
  };
}

module.exports = { buildConfirmFlex, buildCompleteFlex };
