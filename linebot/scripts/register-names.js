'use strict';

// 一回だけ実行するLINE名→実名登録スクリプト
// Renderのシェルで: node scripts/register-names.js

const admin = require('firebase-admin');

const LINE_NAME_TO_REAL_NAME = {
  'ﾌﾟｷﾞｰ':              '柴田',
  '矢部智也':             '矢部智也',
  'うしおだ の だいすけ':  '潮田',
  'DKJPN':               '児玉取締役',
  '佐竹良友':             '佐竹良友',
};

async function main() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT || !process.env.FIREBASE_DATABASE_URL) {
    console.error('環境変数 FIREBASE_SERVICE_ACCOUNT と FIREBASE_DATABASE_URL が必要です');
    process.exit(1);
  }

  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });

  const db = admin.database();
  await db.ref('config/lineNameRealNames').set(LINE_NAME_TO_REAL_NAME);

  console.log('登録完了:');
  for (const [line, real] of Object.entries(LINE_NAME_TO_REAL_NAME)) {
    console.log(`  ${line} → ${real}`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('エラー:', err?.message || err);
  process.exit(1);
});
