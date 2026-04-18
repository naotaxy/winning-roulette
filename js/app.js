/* ═══════════════════════════════════════════════════
   WINNING ROULETTE — Main Application
   Director: Claude / Frontend: Agent
   ═══════════════════════════════════════════════════ */

'use strict';

/* ── Defaults ── */
const DEFAULT_12 = [
  'スピード','スタミナ','パワー','テクニック','バランス',
  'レジェンド禁止','ナショナル限定','レギュラー限定',
  'キラ禁止','星5禁止','カスタム禁止','セレクトカスタム禁止'
];
const DEFAULT_6 = ['項目1','項目2','項目3','項目4','項目5','項目6'];

/* ── App state ── */
const STATE = {
  items12:  [...DEFAULT_12],
  items6:   [...DEFAULT_6],
  phase:    1,
  round1:   [],
  round2:   null,
  userName: '',
  avatarUrl: null,
  wheel:    null,
};

/* ── Storage ── */
const DB = {
  load() {
    try {
      const s12 = localStorage.getItem('wc_12');
      const s6  = localStorage.getItem('wc_6');
      if (s12) STATE.items12 = JSON.parse(s12);
      if (s6)  STATE.items6  = JSON.parse(s6);
    } catch(e) {}
  },
  saveItems() {
    localStorage.setItem('wc_12', JSON.stringify(STATE.items12));
    localStorage.setItem('wc_6',  JSON.stringify(STATE.items6));
  },
  getHistory() {
    try { return JSON.parse(localStorage.getItem('wc_hist') || '[]'); } catch(e) { return []; }
  },
  addHistory(entry) {
    const h = this.getHistory();
    h.unshift(entry);
    localStorage.setItem('wc_hist', JSON.stringify(h.slice(0, 100)));
  },
  clearHistory() { localStorage.removeItem('wc_hist'); }
};

/* ── Toast ── */
let _toastTimer;
function toast(msg, dur = 2400) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), dur);
}

/* ── Tab navigation ── */
function initNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-' + tab).classList.add('active');
      if (tab === 'history')  renderHistory();
      if (tab === 'settings') renderSettings();
    });
  });
}

/* ── Game panel ── */
function renderGame() {
  const panel = document.getElementById('panel-game');
  if (STATE.phase === 3) { renderFinal(panel); return; }

  const isP1   = STATE.phase === 1;
  const items  = isP1 ? STATE.items12 : STATE.items6;
  const colors = isP1 ? ROULETTE.PALETTE_12 : ROULETTE.PALETTE_6;
  const spinN  = isP1 ? STATE.round1.length + 1 : 1;

  panel.innerHTML = `
    <div class="phase-strip">
      <div class="phase-node ${STATE.phase > 1 ? 'done' : 'active'}">1st：12択×2</div>
      <div class="phase-node ${STATE.phase === 2 ? 'active' : STATE.phase > 2 ? 'done' : ''}">2nd：6択×1</div>
    </div>

    <div class="roulette-stage" id="roulette-stage">
      <div class="roulette-label">${isP1 ? `ROUND 1 — SPIN ${spinN}/2` : 'ROUND 2 — FINAL SPIN'}</div>
      <div class="wheel-wrap" id="wheel-wrap">
        <div class="wheel-pointer"></div>
      </div>
      <div class="spin-status" id="spin-status">PRESS SPIN TO START</div>
    </div>

    <div style="display:flex;justify-content:center;margin-bottom:12px;">
      <button class="btn-spin" id="btn-spin">🎯 SPIN</button>
    </div>

    <div id="partial-wrap"></div>
  `;

  /* Build wheel */
  const wrap = document.getElementById('wheel-wrap');
  STATE.wheel = ROULETTE.create(wrap, items, colors);

  renderPartial();
  document.getElementById('btn-spin').addEventListener('click', onSpin);
}

function renderPartial() {
  const el = document.getElementById('partial-wrap');
  if (!el || STATE.round1.length === 0) return;
  el.innerHTML = `
    <div class="partial-box">
      <div class="lbl">第1回 選択済み</div>
      ${STATE.round1.map(i => `<span class="chip">✅ ${STATE.items12[i]}</span>`).join('')}
    </div>`;
}

function onSpin() {
  const btn    = document.getElementById('btn-spin');
  const status = document.getElementById('spin-status');
  if (!STATE.wheel || STATE.wheel.spinning) return;

  btn.disabled = true;
  status.className = 'spin-status';
  status.textContent = 'SPINNING…';

  /* Read name from bar */
  const nameEl = document.getElementById('name-input');
  if (nameEl) STATE.userName = nameEl.value.trim() || STATE.userName;

  if (STATE.phase === 1) {
    STATE.wheel.spin(STATE.round1, idx => {
      STATE.round1.push(idx);
      status.className = 'spin-status hit';
      status.textContent = `「${STATE.items12[idx]}」 が選ばれました！`;
      renderPartial();
      setTimeout(() => {
        if (STATE.round1.length < 2) {
          renderGame();
        } else {
          STATE.phase = 2;
          renderGame();
        }
      }, 1900);
    });
  } else {
    STATE.wheel.spin([], idx => {
      STATE.round2 = idx;
      status.className = 'spin-status hit';
      status.textContent = `「${STATE.items6[idx]}」 が選ばれました！`;

      /* Save history */
      DB.addHistory({
        name:      STATE.userName || '名無し',
        avatarUrl: STATE.avatarUrl,
        timestamp: new Date().toISOString(),
        round1:    STATE.round1.map(i => STATE.items12[i]),
        round2:    STATE.items6[idx],
      });

      setTimeout(() => { STATE.phase = 3; renderGame(); }, 1900);
    });
  }
}

function renderFinal(panel) {
  const entry = DB.getHistory()[0];
  const name  = entry?.name || '名無し';

  panel.innerHTML = `
    <div class="phase-strip">
      <div class="phase-node done">1st：12択×2</div>
      <div class="phase-node done">2nd：6択×1</div>
    </div>
    <div class="final-card">
      <h2>🏆 RULE DECIDED</h2>
      <div class="final-section">
        <div class="lbl">【第1回】12択から2個</div>
        ${STATE.round1.map((i,d) =>
          `<span class="big-chip" style="animation-delay:${d*0.2}s">⚡ ${STATE.items12[i]}</span>`
        ).join('')}
      </div>
      <div class="final-section">
        <div class="lbl">【第2回】6択から1個</div>
        <span class="big-chip" style="animation-delay:0.4s">🎲 ${STATE.items6[STATE.round2]}</span>
      </div>
      <div class="action-row">
        <button class="btn-line" id="btn-share">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 0C3.6 0 0 3.1 0 6.9c0 2.4 1.4 4.5 3.5 5.8L3 15l3.2-1.7c.6.2 1.2.2 1.8.2 4.4 0 8-3.1 8-6.9S12.4 0 8 0z" fill="#fff"/>
          </svg>
          LINEで送る
        </button>
        <button class="btn-copy" id="btn-copy">📋 コピー</button>
        <button class="btn-reset" id="btn-reset">🔄 もう一度</button>
      </div>
    </div>`;

  const entry_ = entry;
  document.getElementById('btn-share').onclick = async () => {
    const result = await LIFF_WRAPPER.shareResult(entry_);
    if (result === 'fallback') {
      const txt = LIFF_WRAPPER.buildText(entry_);
      await copyToClipboard(txt);
      toast('📋 テキストをコピーしました。LINEに貼り付けてください。', 3000);
    } else if (result === 'shared') {
      toast('✅ シェアしました！');
    }
  };
  document.getElementById('btn-copy').onclick = async () => {
    await copyToClipboard(LIFF_WRAPPER.buildText(entry_));
    toast('📋 コピーしました！');
  };
  document.getElementById('btn-reset').onclick = resetGame;
}

function resetGame() {
  STATE.phase  = 1;
  STATE.round1 = [];
  STATE.round2 = null;
  STATE.wheel  = null;
  renderGame();
}

/* ── History panel ── */
function renderHistory() {
  const panel = document.getElementById('panel-history');
  const hist  = DB.getHistory();

  panel.innerHTML = `
    <div class="history-toolbar">
      <h2>📜 スピン履歴</h2>
      ${hist.length ? '<button class="btn-danger-sm" id="btn-clear">全削除</button>' : ''}
    </div>
    ${hist.length === 0
      ? '<div class="history-empty">まだ履歴がありません</div>'
      : hist.map(h => {
          const dt = new Date(h.timestamp);
          const ts = `${dt.getMonth()+1}/${dt.getDate()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
          const avatar = h.avatarUrl
            ? `<img class="hist-avatar" src="${h.avatarUrl}" alt="">`
            : `<div class="hist-avatar" style="display:flex;align-items:center;justify-content:center;font-size:0.8em;">👤</div>`;
          return `
            <div class="hist-item">
              <div class="hist-meta">
                <div class="hist-who">
                  ${avatar}
                  <span class="hist-name">${h.name}</span>
                </div>
                <span class="hist-time">${ts}</span>
              </div>
              <div class="hist-results">
                <span class="hchip r1">⚡ ${h.round1[0]}</span>
                <span class="hchip r1">⚡ ${h.round1[1]}</span>
                <span class="hdiv">｜</span>
                <span class="hchip r2">🎲 ${h.round2}</span>
              </div>
            </div>`;
        }).join('')
    }`;

  document.getElementById('btn-clear')?.addEventListener('click', () => {
    if (confirm('履歴をすべて削除しますか？')) { DB.clearHistory(); renderHistory(); }
  });
}

/* ── Settings panel ── */
function renderSettings() {
  const panel = document.getElementById('panel-settings');

  const rows = (arr, pfx, count) =>
    Array.from({length: count}, (_, i) =>
      `<div class="item-row">
        <span class="item-num">${i+1}</span>
        <input type="text" id="${pfx}${i}" value="${arr[i] ?? ''}">
      </div>`).join('');

  panel.innerHTML = `
    <div class="settings-grid">
      <div class="settings-card">
        <h3>🎯 12択リスト</h3>
        ${rows(STATE.items12,'a',12)}
        <button class="btn-save" id="sv12">保存</button>
      </div>
      <div class="settings-card">
        <h3>🎲 6択リスト</h3>
        ${rows(STATE.items6,'b',6)}
        <button class="btn-save" id="sv6">保存</button>
      </div>
    </div>`;

  document.getElementById('sv12').onclick = () => {
    STATE.items12 = Array.from({length:12},(_,i) =>
      document.getElementById(`a${i}`)?.value.trim() || DEFAULT_12[i]);
    DB.saveItems(); toast('✅ 12択リストを保存しました');
  };
  document.getElementById('sv6').onclick = () => {
    STATE.items6 = Array.from({length:6},(_,i) =>
      document.getElementById(`b${i}`)?.value.trim() || DEFAULT_6[i]);
    DB.saveItems(); toast('✅ 6択リストを保存しました');
  };
}

/* ── Header profile ── */
function updateHeader(profile) {
  const nameEl   = document.getElementById('profile-name');
  const avatarEl = document.getElementById('profile-avatar');

  if (profile) {
    STATE.userName  = profile.displayName;
    STATE.avatarUrl = profile.pictureUrl;
    if (nameEl)   nameEl.textContent = profile.displayName;
    if (avatarEl && profile.pictureUrl) {
      avatarEl.src = profile.pictureUrl;
      avatarEl.style.display = 'block';
    }
  }

  /* Sync name input */
  const ni = document.getElementById('name-input');
  if (ni && STATE.userName) ni.value = STATE.userName;
}

/* ── Help modal ── */
function initHelp() {
  const ITEMS_12 = [
    ['スピード',           'チーム全体のスピード属性を重視。足の速い選手でビルドアップ。'],
    ['スタミナ',           'スタミナ属性が高い選手中心。後半でも衰えない持続力を重視。'],
    ['パワー',             'パワー属性優先。フィジカル重視の力強い直線的プレー。'],
    ['テクニック',         '技術属性でドリブル・パス精度重視のチーム構成。'],
    ['バランス',           '全属性がバランスよい選手のみ使用可。偏りなし縛り。'],
    ['レジェンド禁止',     'レジェンドレア選手の使用禁止。現役世代のみ。'],
    ['ナショナル限定',     '1カ国の代表チームの選手のみ使用可。'],
    ['レギュラー限定',     'レギュラーレアリティ（基本カード）のみ使用可。'],
    ['キラ禁止',           'キラ（ホログラフィック）カードの使用禁止。通常版のみ。'],
    ['星5禁止',            '★5評価カードの使用禁止。★4以下のみで構成。'],
    ['カスタム禁止',       'カスタマイズ強化したカード全面禁止。ベース状態のみ。'],
    ['セレクトカスタム禁止','プレミアム選択カスタム禁止。基本カスタムのみ許可。'],
  ];

  const ITEMS_6_DEFAULT = [
    ['項目1','説明文を設定タブで入力してください。'],
    ['項目2','説明文を設定タブで入力してください。'],
    ['項目3','説明文を設定タブで入力してください。'],
    ['項目4','説明文を設定タブで入力してください。'],
    ['項目5','説明文を設定タブで入力してください。'],
    ['項目6','説明文を設定タブで入力してください。'],
  ];

  const modal = document.getElementById('help-modal');

  document.getElementById('btn-help').onclick = () => modal.classList.add('open');
  document.getElementById('btn-modal-close').onclick  = () => modal.classList.remove('open');
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });

  /* Build help content */
  const body = document.getElementById('help-body');
  body.innerHTML = `
    <div class="help-section">
      <h3>このアプリについて</h3>
      <p class="help-intro">
        ウイニングコレクション（ウイコレ）の対戦ルールをルーレットで公平に決定するアプリです。<br><br>
        <b>使い方</b><br>
        ① 名前を入力（LINEで開くと自動取得）<br>
        ② 第1回：12択ルーレットを2回スピン<br>
        ③ 第2回：6択ルーレットを1回スピン<br>
        ④ 「LINEで送る」でグループに結果を投稿
      </p>
    </div>
    <div class="help-section">
      <h3>12択ルール説明</h3>
      ${ITEMS_12.map(([n,d]) => `
        <div class="help-item">
          <div class="help-item-name">${n}</div>
          <div class="help-item-desc">${d}</div>
        </div>`).join('')}
    </div>
    <div class="help-section">
      <h3>6択ルール説明</h3>
      <p class="help-intro" style="font-size:0.8em">「設定」タブから6択の項目名を自由に設定できます。</p>
      ${ITEMS_6_DEFAULT.map(([n,d]) => `
        <div class="help-item">
          <div class="help-item-name">${n}</div>
          <div class="help-item-desc">${d}</div>
        </div>`).join('')}
    </div>
    <div class="help-section">
      <h3>LINEで送る 設定手順</h3>
      <p class="help-intro">
        LIFF IDを設定することでLINE上から名前自動取得・シェアが可能になります。<br><br>
        1. <b>LINE Developersコンソール</b> (developers.line.biz) にアクセス<br>
        2. プロバイダー作成 → <b>LINEログインチャネル</b>を作成<br>
        3. 「LIFF」タブ → 「追加」<br>
        4. サイズ: <b>Full</b>、スコープ: <b>profile</b> にチェック<br>
        5. エンドポイントURL: GitHub Pages の URL (https必須)<br>
        6. 発行されたLIFF IDを <b>js/liff.js</b> の <code>LIFF_ID</code> に設定
      </p>
    </div>`;
}

/* ── Clipboard helper ── */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch(e) {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
}

/* ── LIFF setup notice ── */
function showLiffNotice(needsSetup) {
  const el = document.getElementById('liff-notice');
  if (el && needsSetup) el.classList.add('show');
}

/* ── Boot ── */
async function boot() {
  DB.load();
  initNav();
  initHelp();
  renderGame();
  renderSettings();

  /* Try LIFF init */
  try {
    const { profile, needsSetup } = await LIFF_WRAPPER.init();
    if (profile) updateHeader(profile);
    if (needsSetup) showLiffNotice(true);
  } catch(e) {
    console.warn('LIFF boot error:', e);
  }
}

document.addEventListener('DOMContentLoaded', boot);
