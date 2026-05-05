/* ═══════════════════════════════════════════════════
   SYNC — Firebase Realtime Database ラッパー
   ・全員リアルタイム共有
   ・スピン結果を先にコミット（不正防止）
   ・LocalStorage フォールバック（Firebase未設定時）
   ═══════════════════════════════════════════════════ */
'use strict';

const SYNC = (() => {
  let _db       = null;
  let _refs     = {};
  let _handlers = {};   // event → callback[]
  let _isReady  = false;
  let _sessionId = null;
  const PUBLIC_CONFIG_KEYS = ['items12', 'items6', 'players', 'restrictMonths', 'matchSchedule'];

  /* ── Firebase 初期化 ── */
  async function init() {
    if (typeof FIREBASE_CONFIG_PROMISE !== 'undefined') {
      await FIREBASE_CONFIG_PROMISE;
    }
    if (!FIREBASE_READY) {
      console.info('[SYNC] Firebase未設定 — LocalStorageモードで動作');
      _isReady = false;
      return false;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      if (firebase.auth) {
        await firebase.auth().signInAnonymously();
      } else {
        throw new Error('Firebase Auth SDK is not loaded');
      }
      _db      = firebase.database();
      _isReady = true;
      console.info('[SYNC] Firebase接続OK');
      return true;
    } catch (e) {
      console.warn('[SYNC] Firebase初期化失敗:', e.message);
      _isReady = false;
      return false;
    }
  }

  function on(event, fn) {
    (_handlers[event] = _handlers[event] || []).push(fn);
  }
  function emit(event, data) {
    (_handlers[event] || []).forEach(fn => fn(data));
  }

  /* ─────────────────────────────────────────────
     セッション管理
  ───────────────────────────────────────────── */

  /* 新規セッション作成（敗者がルーレットを開始） */
  async function createSession(spinnerName) {
    const id = _isReady
      ? _db.ref('sessions').push().key
      : 'local-' + Date.now();
    _sessionId = id;

    const data = {
      phase:       1,
      spinning:    false,
      round1:      [],
      round2:      null,
      spinnerName: spinnerName || '不明',
      createdAt:   _isReady ? firebase.database.ServerValue.TIMESTAMP : Date.now(),
    };

    if (_isReady) {
      await _db.ref(`sessions/${id}`).set(data);
      _watchSession(id);
    } else {
      _localSave('session', data);
    }
    return id;
  }

  /* 既存セッションに参加（URLのセッションIDで） */
  function joinSession(id) {
    _sessionId = id;
    if (_isReady) _watchSession(id);
    else emit('session', _localLoad('session') || {});
  }

  function _watchSession(id) {
    if (!_db) return;
    if (_refs.session) _refs.session.off();
    _refs.session = _db.ref(`sessions/${id}`);
    _refs.session.on('value', snap => {
      const v = snap.val();
      if (v) emit('session', v);
    });
  }

  /* ─────────────────────────────────────────────
     スピン — 結果を先にコミット（不正防止）
     アニメーション前に Firebase に保存 → 変更不能
  ───────────────────────────────────────────── */
  async function commitSpin(phase, resultIdx, items12, items6) {
    if (!_sessionId) return;

    let update = { spinning: true };

    if (phase === 1) {
      /* 現在の round1 を読んでから追記 */
      let round1 = [];
      if (_isReady) {
        const snap = await _db.ref(`sessions/${_sessionId}/round1`).once('value');
        round1 = snap.val() || [];
      } else {
        round1 = (_localLoad('session') || {}).round1 || [];
      }
      round1 = [...round1, resultIdx];
      update.round1 = round1;
      update.phase  = round1.length >= 2 ? 2 : 1;
    } else {
      update.round2 = resultIdx;
      update.phase  = 3;
    }

    if (_isReady) {
      await _db.ref(`sessions/${_sessionId}`).update(update);
    } else {
      const cur = _localLoad('session') || {};
      _localSave('session', { ...cur, ...update });
      emit('session', { ...cur, ...update });
    }
  }

  /* スピンアニメーション完了通知 */
  async function finishSpin() {
    if (!_sessionId) return;
    const update = { spinning: false };
    if (_isReady) {
      await _db.ref(`sessions/${_sessionId}`).update(update);
    } else {
      const cur = _localLoad('session') || {};
      _localSave('session', { ...cur, ...update });
    }
  }

  /* セッションリセット */
  async function resetSession(spinnerName) {
    if (!_sessionId) return;
    const data = {
      phase: 1, spinning: false, round1: [], round2: null,
      spinnerName: spinnerName || '不明',
      createdAt: _isReady ? firebase.database.ServerValue.TIMESTAMP : Date.now(),
    };
    if (_isReady) {
      await _db.ref(`sessions/${_sessionId}`).set(data);
    } else {
      _localSave('session', data);
      emit('session', data);
    }
  }

  /* ─────────────────────────────────────────────
     設定（12択/6択リスト・プレイヤー情報）
  ───────────────────────────────────────────── */
  function watchConfig(cb) {
    if (_isReady) {
      const config = {};
      PUBLIC_CONFIG_KEYS.forEach(key => {
        const ref = _db.ref(`config/${key}`);
        ref.on('value', snap => {
          if (snap.exists()) config[key] = snap.val();
          else delete config[key];
          cb({ ...config });
        });
      });
    } else {
      cb(_localLoad('config') || {});
    }
  }

  async function saveConfig(data) {
    if (_isReady) {
      const safe = {};
      PUBLIC_CONFIG_KEYS.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(data || {}, key)) safe[key] = data[key];
      });
      if (Object.keys(safe).length) await _db.ref('config').update(safe);
    } else {
      const cur = _localLoad('config') || {};
      _localSave('config', { ...cur, ...data });
    }
  }

  /* ─────────────────────────────────────────────
     月次ルール（カレンダー）
  ───────────────────────────────────────────── */
  function watchMonthlyRules(cb) {
    if (_isReady) {
      _db.ref('monthlyRules').on('value', snap => cb(snap.val() || {}));
    } else {
      cb(_localLoad('monthlyRules') || {});
    }
  }

  async function saveMonthlyRule(year, month, ruleText, decidedBy) {
    const key  = `${year}/${month}`;
    const data = { rule: ruleText, decidedBy, decidedAt: Date.now() };
    if (_isReady) {
      await _db.ref(`monthlyRules/${key}`).set(data);
    } else {
      const cur = _localLoad('monthlyRules') || {};
      cur[year] = cur[year] || {};
      cur[year][month] = data;
      _localSave('monthlyRules', cur);
    }
  }

  /* ─────────────────────────────────────────────
     試合結果（集計）
  ───────────────────────────────────────────── */
  function watchResults(year, month, cb) {
    const key = `${year}/${month}`;
    if (_isReady) {
      _db.ref(`matchResults/${key}`).on('value', snap => cb(snap.val() || {}));
    } else {
      const all = _localLoad('matchResults') || {};
      cb((all[year] || {})[month] || {});
    }
  }

  async function saveResult(year, month, matchData) {
    const key    = `${year}/${month}`;
    const id     = Date.now().toString(36);
    const record = { ...matchData, addedAt: Date.now() };
    if (_isReady) {
      await _db.ref(`matchResults/${key}/${id}`).set(record);
    } else {
      const all = _localLoad('matchResults') || {};
      all[year]         = all[year] || {};
      all[year][month]  = all[year][month] || {};
      all[year][month][id] = record;
      _localSave('matchResults', all);
    }
    return id;
  }

  async function deleteResult(year, month, id) {
    const key = `${year}/${month}`;
    if (_isReady) {
      await _db.ref(`matchResults/${key}/${id}`).remove();
    } else {
      const all = _localLoad('matchResults') || {};
      delete ((all[year] || {})[month] || {})[id];
      _localSave('matchResults', all);
    }
  }

  /* 月次ルール削除（誰が削除したか記録） */
  async function deleteMonthlyRule(year, month, deletedBy) {
    const key = `${year}/${month}`;
    if (_isReady) {
      await _db.ref(`monthlyRules/${key}`).remove();
      await _db.ref(`deletionLog/monthlyRules/${year}_${month}`).set({
        deletedBy, deletedAt: Date.now()
      });
    } else {
      const cur = _localLoad('monthlyRules') || {};
      if (cur[year]) delete cur[year][month];
      _localSave('monthlyRules', cur);
    }
  }

  /* スピン履歴（Firebase保存） */
  async function saveSpinHistory(entry) {
    const id = Date.now().toString(36);
    if (_isReady) {
      await _db.ref(`spinHistory/${id}`).set({ ...entry, savedAt: Date.now() });
    }
    try {
      const h = JSON.parse(localStorage.getItem('wc_hist') || '[]');
      h.unshift(entry);
      localStorage.setItem('wc_hist', JSON.stringify(h.slice(0, 100)));
    } catch(_) {}
    return id;
  }

  function watchSpinHistory(callback) {
    if (_isReady) {
      _db.ref('spinHistory').on('value', snap => {
        const data = snap.val() || {};
        const entries = Object.values(data).sort((a,b) => (b.savedAt||0) - (a.savedAt||0)).slice(0, 100);
        callback(entries);
      });
    } else {
      callback(getLegacyHistory());
    }
  }

  /* 年間全月の結果を一括監視 */
  function watchAnnualResults(year, callback) {
    if (_isReady) {
      _db.ref(`matchResults/${year}`).on('value', snap => callback(snap.val() || {}));
    } else {
      const all = _localLoad('matchResults') || {};
      callback(all[year] || {});
    }
  }

  /* プレイヤーアバターURL保存・監視 */
  async function savePlayerAvatar(playerName, avatarUrl) {
    if (_isReady) {
      await _db.ref(`playerAvatars/${playerName.replace(/[.#$/[\]]/g,'_')}`).set(avatarUrl);
    }
  }

  function watchPlayerAvatars(callback) {
    if (_isReady) {
      _db.ref('playerAvatars').on('value', snap => callback(snap.val() || {}));
    } else {
      callback({});
    }
  }

  /* ─────────────────────────────────────────────
     LocalStorage フォールバック
  ───────────────────────────────────────────── */
  function _localSave(key, val) {
    try { localStorage.setItem('wc_' + key, JSON.stringify(val)); } catch(_) {}
  }
  function _localLoad(key) {
    try { return JSON.parse(localStorage.getItem('wc_' + key)); } catch(_) { return null; }
  }

  /* 旧localStorage履歴を読む（移行用） */
  function getLegacyHistory() {
    try { return JSON.parse(localStorage.getItem('wc_hist') || '[]'); } catch(_) { return []; }
  }

  async function saveOcrLog(log) {
    const id = new Date().toISOString().replace(/[:.]/g, '-');
    if (_isReady) {
      await _db.ref(`ocr_logs/${id}`).set(log);
    }
  }

  return {
    init, on, isReady: () => _isReady,
    createSession, joinSession, commitSpin, finishSpin, resetSession,
    watchConfig, saveConfig,
    watchMonthlyRules, saveMonthlyRule, deleteMonthlyRule,
    watchResults, saveResult, deleteResult,
    saveSpinHistory, watchSpinHistory,
    watchAnnualResults,
    savePlayerAvatar, watchPlayerAvatars,
    getLegacyHistory,
    saveOcrLog,
    sessionId: () => _sessionId,
  };
})();
