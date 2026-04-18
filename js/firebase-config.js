/* ═══════════════════════════════════════════════════
   Firebase Configuration
   console.firebase.google.com でプロジェクトを作成後、
   以下の値を実際のものに書き換えてください
   ═══════════════════════════════════════════════════ */

const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "YOUR_PROJECT",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

/* ── 設定済みかチェック ── */
const FIREBASE_READY = FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY";
