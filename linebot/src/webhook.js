'use strict';

const { parseMatchResult } = require('./ocr-node');
const { getPlayers, savePending, saveResult, getPending, deletePending } = require('./firebase-admin');
const { buildConfirmFlex, buildCompleteFlex } = require('./flex-message');

async function handle(event, client) {
  /* ── 画像メッセージ → OCR → 確認FlexMessage ── */
  if (event.type === 'message' && event.message.type === 'image') {
    return handleImage(event, client);
  }

  /* ── Postback（OK / キャンセル） ── */
  if (event.type === 'postback') {
    return handlePostback(event, client);
  }
}

async function handleImage(event, client) {
  const msgId = event.message.id;
  console.log(`[webhook] image received msgId=${msgId}`);

  /* LINE Content API から画像バイナリを取得 */
  const stream  = await client.getMessageContent(msgId);
  const buffer  = await streamToBuffer(stream);

  /* プレイヤーマップを Firebase から取得 */
  const players   = await getPlayers();
  console.log(`[webhook] players count=${Array.isArray(players) ? players.length : Object.keys(players||{}).length} type=${Array.isArray(players)?'array':typeof players}`);
  const playerMap = {};
  (Array.isArray(players) ? players : Object.values(players || {})).forEach(p => {
    if (p?.charName) playerMap[p.charName] = p.name;
  });

  /* OCR */
  let ocrResult;
  try {
    ocrResult = await parseMatchResult(buffer, playerMap);
  } catch (err) {
    console.error('[webhook] OCR failed', err);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ごめん、うまく読み取れなかった...\nアプリから入力してくれたら、ちゃんと受け取るから。\nhttps://naotaxy.github.io/winning-roulette/',
    });
  }

  /* 送信者の表示名を取得（addedBy用） */
  let senderName = '(LINE bot)';
  try {
    const profile = await client.getProfile(event.source.userId);
    senderName = profile.displayName;
  } catch(_) {}

  /* 保留データを Firebase に保存 */
  const now = new Date();
  const pending = {
    ...ocrResult,
    away:     ocrResult.awayChar?.playerName || null,
    home:     ocrResult.homeChar?.playerName || null,
    addedBy:  senderName,
    year:     now.getFullYear(),
    month:    now.getMonth() + 1,
    date:     toDateStr(now),
    savedAt:  now.toISOString(),
  };
  await savePending(msgId, pending);

  /* 確認FlexMessageを送信 */
  const flex = buildConfirmFlex(ocrResult, msgId);
  return client.replyMessage(event.replyToken, flex);
}

async function handlePostback(event, client) {
  const data = event.postback.data;

  if (data.startsWith('ocr_ok:')) {
    const msgId = data.replace('ocr_ok:', '');
    const pending = await getPending(msgId);
    if (!pending) {
      return client.replyMessage(event.replyToken, { type: 'text', text: 'データが見つからなかった... ちょっと時間が経ちすぎちゃったかも。\nもう一回送ってくれたら、今度はちゃんとするよ。' });
    }
    await saveResult(pending);
    await deletePending(msgId);
    const flex = buildCompleteFlex(pending);
    return client.replyMessage(event.replyToken, flex);
  }

  if (data.startsWith('ocr_ng:')) {
    const msgId = data.replace('ocr_ng:', '');
    await deletePending(msgId);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'わかった、キャンセルにするね。\nもしよければアプリから入力してくれると、うれしいな。\nhttps://naotaxy.github.io/winning-roulette/',
    });
  }
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end',  () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

module.exports = { handle };
