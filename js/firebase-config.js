/* ═══════════════════════════════════════════════════
   Firebase Configuration
   公開ソースにはAPIキーを置かず、Renderの公開設定エンドポイントから取得する。
   ═══════════════════════════════════════════════════ */
'use strict';

const FIREBASE_CONFIG = {};
const FIREBASE_CONFIG_URL = window.FIREBASE_CONFIG_URL || 'https://winning-roulette.onrender.com/public/firebase-config';
let FIREBASE_READY = false;

const FIREBASE_CONFIG_PROMISE = loadFirebaseConfig();

async function loadFirebaseConfig() {
  const inlineConfig = window.__FIREBASE_CONFIG__;
  if (isUsableFirebaseConfig(inlineConfig)) {
    Object.assign(FIREBASE_CONFIG, inlineConfig);
    FIREBASE_READY = true;
    return true;
  }

  if (!FIREBASE_CONFIG_URL || typeof fetch !== 'function') {
    FIREBASE_READY = false;
    return false;
  }

  try {
    const res = await fetch(FIREBASE_CONFIG_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const remoteConfig = data.firebaseConfig || data;
    if (!isUsableFirebaseConfig(remoteConfig)) throw new Error('Firebase config is incomplete');
    Object.assign(FIREBASE_CONFIG, remoteConfig);
    FIREBASE_READY = true;
    return true;
  } catch (err) {
    console.warn('[firebase-config] runtime config load failed:', err.message);
    FIREBASE_READY = false;
    return false;
  }
}

function isUsableFirebaseConfig(config) {
  return !!(
    config &&
    typeof config === 'object' &&
    config.apiKey &&
    config.authDomain &&
    config.databaseURL &&
    config.projectId
  );
}
