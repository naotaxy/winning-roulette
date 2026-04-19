'use strict';

const admin = require('firebase-admin');

let _db = null;

function getDb() {
  if (_db) return _db;
  if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential:  admin.credential.cert(sa),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }
  _db = admin.database();
  return _db;
}

/* プレイヤー設定を Firebase config から取得（5分キャッシュ） */
let _playersCache = null;
let _playersCacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function getPlayers() {
  if (_playersCache && Date.now() - _playersCacheTs < CACHE_TTL) return _playersCache;
  const snap = await getDb().ref('config/players').once('value');
  const raw = snap.val();
  console.log('[firebase] config/players raw:', JSON.stringify(raw)?.slice(0, 200));
  _playersCache = raw || [];
  _playersCacheTs = Date.now();
  return _playersCache;
}

/* OCR結果を一時保留（TTL: 1時間） */
async function savePending(msgId, data) {
  await getDb().ref(`pendingOcr/${msgId}`).set({
    ...data,
    expiresAt: Date.now() + 60 * 60 * 1000,
  });
}

async function getPending(msgId) {
  const snap = await getDb().ref(`pendingOcr/${msgId}`).once('value');
  const data = snap.val();
  if (!data) return null;
  if (data.expiresAt < Date.now()) { await deletePending(msgId); return null; }
  return data;
}

async function deletePending(msgId) {
  await getDb().ref(`pendingOcr/${msgId}`).remove();
}

/* matchResults に保存 */
async function saveResult(pending) {
  const { year, month, away, home, awayScore, homeScore, awayPK, homePK, date, addedBy } = pending;
  const ref = getDb().ref(`matchResults/${year}/${month}`);
  const entry = {
    date, away, home,
    awayScore, homeScore,
    addedBy: addedBy || 'LINE bot',
    addedAt: admin.database.ServerValue.TIMESTAMP,
  };
  if (awayPK != null && homePK != null) {
    entry.awayPK = awayPK;
    entry.homePK = homePK;
  }
  await ref.push(entry);
}

module.exports = { getPlayers, savePending, getPending, deletePending, saveResult };
