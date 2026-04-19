/* ═══════════════════════════════════════════════════
   WINNING ROULETTE — Main Application v4
   ・Firebase リアルタイム共有
   ・タイミングゲージ
   ・カレンダー / 集計 / OCR
   ・不正防止（スピン結果を先行コミット）
   ═══════════════════════════════════════════════════ */
'use strict';

/* ── デフォルト値 ── */
const DEFAULT_12 = [
  'スピード','スタミナ','パワー','テクニック','バランス',
  'レジェンド禁止','ナショナル限定','レギュラー限定',
  'キラ禁止','星5禁止','カスタム禁止','セレクトカスタム禁止'
];
const DEFAULT_6 = [
  '後半得点2倍','黄カード即負','赤カード即負',
  '黄カードx2得点マイナス','先制点勝ち','選手交代負け'
];

/* 縛り月（5,6,8,9,11月） */
const RESTRICT_MONTHS = [5, 6, 8, 9, 11];

/* デフォルトプレイヤー */
const DEFAULT_PLAYERS = [
  { name: '児玉',   lineId: 'DKJPN',    charName: 'D XIII'          },
  { name: '柴田',   lineId: 'ﾌﾟｷﾞｰ',    charName: 'カラキソングシティ' },
  { name: '米澤',   lineId: 'ヨ',        charName: 'トラペルソ'       },
  { name: '矢部',   lineId: '矢部智也',  charName: 'ガパオFC'         },
  { name: '潮田',   lineId: 'うしおだ',  charName: 'LOVE BEER?'      },
];

/* ── アプリ状態 ── */
const STATE = {
  items12:        [...DEFAULT_12],
  items6:         [...DEFAULT_6],
  players:        DEFAULT_PLAYERS.map(p => ({ ...p })),
  restrictMonths: [...RESTRICT_MONTHS],
  phase:          1,
  round1:         [],
  round2:         null,
  wheel:          null,
  userName:       '',
  avatarUrl:      null,
  gaugeVal:       50,
  isSpinner:      false,
  sessionId:      null,
  playerAvatars:  {},
  statsYear:      new Date().getFullYear(),
  statsMonth:     new Date().getMonth() + 1,
};

const ICON = Object.freeze({
  game:     '<span class="pxi pxi-game" aria-hidden="true"></span>',
  calendar: '<span class="pxi pxi-calendar" aria-hidden="true"></span>',
  stats:    '<span class="pxi pxi-stats" aria-hidden="true"></span>',
  history:  '<span class="pxi pxi-history" aria-hidden="true"></span>',
  settings: '<span class="pxi pxi-settings" aria-hidden="true"></span>',
  spin:     '<span class="pxi pxi-spin" aria-hidden="true"></span>',
  check:    '<span class="pxi pxi-check" aria-hidden="true"></span>',
  rule:     '<span class="pxi pxi-rule" aria-hidden="true"></span>',
  bolt:     '<span class="pxi pxi-bolt" aria-hidden="true"></span>',
  dice:     '<span class="pxi pxi-dice" aria-hidden="true"></span>',
  copy:     '<span class="pxi pxi-copy" aria-hidden="true"></span>',
  reset:    '<span class="pxi pxi-reset" aria-hidden="true"></span>',
  edit:     '<span class="pxi pxi-edit" aria-hidden="true"></span>',
  delete:   '<span class="pxi pxi-delete" aria-hidden="true"></span>',
  image:    '<span class="pxi pxi-image" aria-hidden="true"></span>',
  upload:   '<span class="pxi pxi-upload" aria-hidden="true"></span>',
  swap:     '<span class="pxi pxi-swap" aria-hidden="true"></span>',
  save:     '<span class="pxi pxi-save" aria-hidden="true"></span>',
  player:   '<span class="pxi pxi-player" aria-hidden="true"></span>',
  group:    '<span class="pxi pxi-group" aria-hidden="true"></span>',
  lock:     '<span class="pxi pxi-lock" aria-hidden="true"></span>',
  free:     '<span class="pxi pxi-free" aria-hidden="true"></span>',
  eye:      '<span class="pxi pxi-eye" aria-hidden="true"></span>',
});

/* ── Toast ── */
let _toastTimer;
function toast(msg, dur = 2600) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), dur);
}

/* ── タブナビ ── */
function initNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-' + tab)?.classList.add('active');
      if (tab === 'history')  renderHistory();
      if (tab === 'settings') renderSettings();
      if (tab === 'calendar') renderCalendar();
      if (tab === 'stats')    renderStats();
    });
  });
}

/* ══════════════════════════════════════════════
   GAME PANEL
══════════════════════════════════════════════ */
function renderGame() {
  const panel = document.getElementById('panel-game');
  if (!panel) return;
  if (STATE.phase === 3) { renderFinal(panel); return; }

  const isP1    = STATE.phase === 1;
  const items   = isP1 ? STATE.items12 : STATE.items6;
  const colors  = isP1 ? ROULETTE.PALETTE_12 : ROULETTE.PALETTE_6;
  const spinN   = isP1 ? STATE.round1.length + 1 : 1;

  panel.innerHTML = `
    <div class="phase-strip">
      <div class="phase-node ${STATE.phase > 1 ? 'done' : 'active'}">1st: 12択×2</div>
      <div class="phase-node ${STATE.phase === 2 ? 'active' : STATE.phase > 2 ? 'done' : ''}">2nd: 6択×1</div>
    </div>

    <div class="roulette-stage" id="roulette-stage">
      <div class="roulette-label">${isP1 ? `ROUND&nbsp;1 &mdash; SPIN&nbsp;${spinN}/2` : 'ROUND&nbsp;2 &mdash; FINAL&nbsp;SPIN'}</div>
      <div class="wheel-wrap" id="wheel-wrap">
        <div class="wheel-pointer"></div>
      </div>
      <div class="spin-status" id="spin-status">ゲージを合わせてSPINを押してください</div>
    </div>

    <!-- タイミングゲージ -->
    <div class="gauge-wrap" id="gauge-wrap">
      <div class="gauge-label">SPIN POWER</div>
      <div class="gauge-track">
        <div class="gauge-bar" id="gauge-bar"></div>
      </div>
      <div class="gauge-value" id="gauge-value">0%</div>
    </div>

    <div style="display:flex;justify-content:center;margin-bottom:14px;">
      <button class="btn-spin" id="btn-spin">${ICON.spin}SPIN</button>
    </div>

    <div id="partial-wrap"></div>

    <!-- 観戦モード時の注意 -->
    ${!STATE.isSpinner ? `<div class="watch-notice">${ICON.eye}観戦中 — 敗者がスピンします</div>` : ''}
  `;

  const wrap = document.getElementById('wheel-wrap');
  STATE.wheel = ROULETTE.create(wrap, items, colors);

  /* ゲージ開始 */
  if (STATE.isSpinner) {
    ROULETTE.GAUGE.start(
      document.getElementById('gauge-bar'),
      document.getElementById('gauge-value')
    );
  } else {
    /* 観戦者はゲージ操作不可 */
    const gw = document.getElementById('gauge-wrap');
    if (gw) gw.classList.add('gauge-disabled');
  }

  renderPartial();

  const btn = document.getElementById('btn-spin');
  if (btn) {
    if (!STATE.isSpinner) { btn.disabled = true; }
    else btn.addEventListener('click', onSpin);
  }
}

function renderPartial() {
  const el = document.getElementById('partial-wrap');
  if (!el || STATE.round1.length === 0) return;
  el.innerHTML = `
    <div class="partial-box">
      <div class="lbl">第1回 選択済み</div>
      ${STATE.round1.map(i => `<span class="chip">${ICON.check}${STATE.items12[i]}</span>`).join('')}
    </div>`;
}

async function onSpin() {
  if (!STATE.wheel || STATE.wheel.spinning) return;
  if (!STATE.isSpinner) return;

  const btn    = document.getElementById('btn-spin');
  const status = document.getElementById('spin-status');

  /* ゲージ値を確定 */
  const power = ROULETTE.GAUGE.capture();
  STATE.gaugeVal = power;

  btn.disabled = true;
  if (status) { status.className = 'spin-status'; status.textContent = `POWER ${power}% でスピン中…`; }

  /* ─ 不正防止: 結果を先にFirebaseにコミット ─ */
  const n      = (STATE.phase === 1 ? STATE.items12 : STATE.items6).length;
  const exclude = STATE.phase === 1 ? STATE.round1 : [];
  let tgtIdx;
  do { tgtIdx = Math.floor(Math.random() * n); }
  while (exclude.includes(tgtIdx));

  if (SYNC) await SYNC.commitSpin(STATE.phase, tgtIdx);

  /* アニメーション（既に結果はロック済み） */
  STATE.wheel.spin(exclude, async idx => {
    const item = STATE.phase === 1 ? STATE.items12[idx] : STATE.items6[idx];
    if (status) { status.className = 'spin-status hit'; status.textContent = `「${item}」が選ばれました！`; }

    if (STATE.phase === 1) {
      STATE.round1.push(idx);
      renderPartial();
      setTimeout(() => {
        STATE.phase = STATE.round1.length < 2 ? 1 : 2;
        if (SYNC) SYNC.finishSpin();
        renderGame();
      }, 2000);
    } else {
      STATE.round2 = idx;
      const entry  = buildEntry();
      if (SYNC) SYNC.saveSpinHistory(entry);
      else addLegacyHistory(entry);
      setTimeout(() => {
        STATE.phase = 3;
        if (SYNC) SYNC.finishSpin();
        renderGame();
      }, 2000);
    }
  }, power);
}

function buildEntry() {
  return {
    name:      STATE.userName || '名無し',
    avatarUrl: STATE.avatarUrl,
    timestamp: new Date().toISOString(),
    round1:    STATE.round1.map(i => STATE.items12[i]),
    round2:    STATE.items6[STATE.round2],
  };
}

/* レガシー履歴（LocalStorage互換） */
function addLegacyHistory(entry) {
  try {
    const h = JSON.parse(localStorage.getItem('wc_hist') || '[]');
    h.unshift(entry);
    localStorage.setItem('wc_hist', JSON.stringify(h.slice(0, 100)));
  } catch(_) {}
}

function renderFinal(panel) {
  const entry = buildEntry();
  const now   = new Date();
  const yr    = now.getFullYear();
  const curM  = now.getMonth() + 1;

  /* 来月以降の縛り月を選択肢に（当月含む） */
  const monthOptions = [];
  for (let m = 1; m <= 12; m++) {
    if (RESTRICT_MONTHS.includes(m)) {
      const y = (m < curM) ? yr + 1 : yr;
      monthOptions.push({ y, m, label: `${y}年${m}月` });
    }
  }
  /* デフォルト: 当月が縛り月なら当月、そうでなければ次の縛り月 */
  const defaultOpt = monthOptions.find(o => o.y === yr && o.m >= curM) || monthOptions[0];

  const optHtml = monthOptions.map(o =>
    `<option value="${o.y}_${o.m}" ${(o.y === defaultOpt.y && o.m === defaultOpt.m) ? 'selected' : ''}>${o.label}</option>`
  ).join('');

  panel.innerHTML = `
    <div class="phase-strip">
      <div class="phase-node done">1st：12択×2</div>
      <div class="phase-node done">2nd：6択×1</div>
    </div>
    <div class="final-card">
      <h2>${ICON.rule}RULE DECIDED</h2>
      <div class="final-section">
        <div class="lbl">【第1回】12択から2個</div>
        ${STATE.round1.map((i,d) =>
          `<span class="big-chip" style="animation-delay:${d*0.2}s">${ICON.bolt}${STATE.items12[i]}</span>`
        ).join('')}
      </div>
      <div class="final-section">
        <div class="lbl">【第2回】6択から1個</div>
        <span class="big-chip" style="animation-delay:0.4s">${ICON.dice}${STATE.items6[STATE.round2]}</span>
      </div>

      <!-- 月選択 & カレンダー保存 -->
      <div class="save-month-row">
        <label class="save-month-label">${ICON.calendar}何月のルールとして保存？</label>
        <select class="save-month-select" id="sel-month">${optHtml}</select>
        <button class="btn-save-month" id="btn-save-month">カレンダーに保存</button>
        <div class="save-month-status" id="save-month-status"></div>
      </div>

      <div class="action-row">
        <button class="btn-line" id="btn-share">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 0C3.6 0 0 3.1 0 6.9c0 2.4 1.4 4.5 3.5 5.8L3 15l3.2-1.7c.6.2 1.2.2 1.8.2 4.4 0 8-3.1 8-6.9S12.4 0 8 0z" fill="#fff"/></svg>
          LINEで送る
        </button>
        <button class="btn-copy" id="btn-copy">${ICON.copy}コピー</button>
        <button class="btn-reset" id="btn-reset">${ICON.reset}もう一度</button>
      </div>
    </div>`;

  document.getElementById('btn-save-month').onclick = async () => {
    const sel = document.getElementById('sel-month').value;
    const [y, m] = sel.split('_').map(Number);
    const statusEl = document.getElementById('save-month-status');
    const rule = `${entry.round1.join(' / ')} ／ ${entry.round2}`;
    try {
      if (SYNC) await SYNC.saveMonthlyRule(y, m, rule, STATE.userName || '不明');
      statusEl.textContent = `${y}年${m}月のルールとして保存しました`;
      statusEl.style.color = '#4caf50';
      document.getElementById('btn-save-month').disabled = true;
    } catch(e) {
      statusEl.textContent = '保存に失敗しました';
      statusEl.style.color = '#f44';
    }
  };

  document.getElementById('btn-share').onclick = async () => {
    const result = await LIFF_WRAPPER.shareResult(entry);
    if (result === 'fallback') {
      await copyToClipboard(LIFF_WRAPPER.buildText(entry));
      toast('コピーしました。LINEに貼り付けてください。', 3000);
    } else if (result === 'shared') toast('シェアしました');
  };
  document.getElementById('btn-copy').onclick = async () => {
    await copyToClipboard(LIFF_WRAPPER.buildText(entry));
    toast('コピーしました');
  };
  document.getElementById('btn-reset').onclick = resetGame;
}

function resetGame() {
  STATE.phase  = 1;
  STATE.round1 = [];
  STATE.round2 = null;
  STATE.wheel  = null;
  ROULETTE.GAUGE.stop();
  if (SYNC && STATE.sessionId) SYNC.resetSession(STATE.userName);
  renderGame();
}

/* ══════════════════════════════════════════════
   CALENDAR PANEL
══════════════════════════════════════════════ */
function renderCalendar() {
  const panel = document.getElementById('panel-calendar');
  if (!panel) return;

  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;

  const MONTH_NAMES = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const isRestrict  = m => STATE.restrictMonths.includes(m);

  panel.innerHTML = `
    <div class="cal-header">
      <h2 class="cal-title">${ICON.calendar}${year}年 縛りカレンダー</h2>
      <p class="cal-note">縛り月: 5・6・8・9・11月 ／ 編集ボタンで全月編集可</p>
    </div>
    <div class="cal-grid" id="cal-grid">
      ${MONTH_NAMES.map((mn, i) => {
        const m = i + 1;
        const cls = isRestrict(m) ? 'cal-cell restrict' : 'cal-cell free';
        return `<div class="${cls}${m === month ? ' current' : ''}" id="cal-cell-${m}" data-month="${m}">
          <div class="cal-month-num">${m}月</div>
          <button class="btn-cal-toggle ${isRestrict(m) ? 'restrict' : 'free'}" id="cal-toggle-${m}">${isRestrict(m) ? ICON.lock + '縛り' : ICON.free + 'フリー'}</button>
          <div class="cal-rule-text" id="cal-rule-${m}">読み込み中…</div>
          <div class="cal-rule-meta" id="cal-meta-${m}"></div>
          <div class="cal-btn-row">
            <button class="btn-cal-edit" id="cal-edit-${m}">${ICON.edit}編集</button>
            <button class="btn-cal-del"  id="cal-del-${m}"  style="display:none">${ICON.delete}</button>
          </div>
          <div class="cal-edit-form" id="cal-form-${m}" style="display:none">
            <input class="cal-edit-input" id="cal-input-${m}" type="text" placeholder="ルールを入力" maxlength="40">
            <div class="cal-edit-actions">
              <button class="cal-edit-save" id="cal-save-${m}">保存</button>
              <button class="cal-edit-cancel" id="cal-cancel-${m}">×</button>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`;

  if (!SYNC) return;

  /* 縛り/フリー トグル */
  MONTH_NAMES.forEach((_, i) => {
    const m = i + 1;
    document.getElementById(`cal-toggle-${m}`)?.addEventListener('click', async () => {
      const newList = STATE.restrictMonths.includes(m)
        ? STATE.restrictMonths.filter(x => x !== m)
        : [...STATE.restrictMonths, m].sort((a, b) => a - b);
      STATE.restrictMonths = newList;
      if (SYNC) await SYNC.saveConfig({ restrictMonths: newList });
      renderCalendar();
    });
  });

  /* 編集・削除ボタンのイベント設定 */
  MONTH_NAMES.forEach((_, i) => {
    const m = i + 1;
    document.getElementById(`cal-edit-${m}`)?.addEventListener('click', () => {
      const form = document.getElementById(`cal-form-${m}`);
      const inp  = document.getElementById(`cal-input-${m}`);
      const cur  = document.getElementById(`cal-rule-${m}`)?.textContent || '';
      inp.value = (cur === '未決定' || cur === '縛りなし' || cur === '読み込み中…') ? '' : cur;
      form.style.display = 'block';
      inp.focus();
    });
    document.getElementById(`cal-cancel-${m}`)?.addEventListener('click', () => {
      document.getElementById(`cal-form-${m}`).style.display = 'none';
    });
    document.getElementById(`cal-save-${m}`)?.addEventListener('click', async () => {
      const val = document.getElementById(`cal-input-${m}`)?.value.trim();
      if (!val) return;
      const who = STATE.userName || '不明';
      await SYNC.saveMonthlyRule(year, m, val, who);
      document.getElementById(`cal-form-${m}`).style.display = 'none';
      toast(`${m}月のルールを保存しました（by ${who}）`);
    });
    document.getElementById(`cal-del-${m}`)?.addEventListener('click', async () => {
      if (!confirm(`${m}月のルールを削除しますか？`)) return;
      const who = STATE.userName || '不明';
      await SYNC.deleteMonthlyRule(year, m, who);
      toast(`${m}月のルールを削除しました（by ${who}）`);
    });
  });

  SYNC.watchMonthlyRules(rules => {
    const yr = rules[year] || {};
    MONTH_NAMES.forEach((_, i) => {
      const m      = i + 1;
      const textEl = document.getElementById(`cal-rule-${m}`);
      const metaEl = document.getElementById(`cal-meta-${m}`);
      const delBtn = document.getElementById(`cal-del-${m}`);
      if (!textEl) return;
      const r = yr[m];
      if (r) {
        textEl.textContent = r.rule;
        if (metaEl) metaEl.textContent = `by ${r.decidedBy || ''}`;
        if (delBtn) delBtn.style.display = 'inline-block';
      } else {
        textEl.textContent = isRestrict(m) ? '未決定' : '縛りなし';
        if (metaEl) metaEl.textContent = '';
        if (delBtn) delBtn.style.display = 'none';
      }
    });
  });
}

/* ══════════════════════════════════════════════
   STATS / OCR PANEL
══════════════════════════════════════════════ */
function renderStats() {
  const panel = document.getElementById('panel-stats');
  if (!panel) return;

  const now = new Date();
  /* 月ナビ用: STATE に保持 */
  if (!STATE.statsYear)  STATE.statsYear  = now.getFullYear();
  if (!STATE.statsMonth) STATE.statsMonth = now.getMonth() + 1;

  /* 登録月選択肢（1〜12月） */
  const regMonthOpts = Array.from({length:12},(_,i) =>
    `<option value="${i+1}" ${i+1===STATE.statsMonth?'selected':''}>${i+1}月</option>`).join('');

  panel.innerHTML = `
    <!-- 月ナビ -->
    <div class="stats-month-nav">
      <button class="stats-nav-btn" id="stats-prev">&lt;</button>
      <span class="stats-nav-label" id="stats-month-label">${STATE.statsYear}年${STATE.statsMonth}月</span>
      <button class="stats-nav-btn" id="stats-next">&gt;</button>
    </div>

    <!-- OCR アップロード -->
    <div class="ocr-card">
      <div class="ocr-card-title">${ICON.image}試合結果を取り込む</div>
      <p class="ocr-desc">ウイコレの試合終了画面のスクリーンショットをアップロードしてください</p>
      <label class="btn-upload" for="ocr-input">
        ${ICON.upload}スクリーンショット選択
        <input type="file" id="ocr-input" accept="image/*" style="display:none">
      </label>
      <div id="ocr-preview-wrap" style="display:none">
        <img id="ocr-preview" class="ocr-preview-img" alt="preview">
        <div id="ocr-progress" class="ocr-progress-bar"><div id="ocr-bar-fill" class="ocr-bar-fill" style="width:0%"></div></div>
        <div id="ocr-status" class="ocr-status">解析中…</div>
      </div>
      <div id="ocr-result-form" style="display:none" class="ocr-result-form">
        <div class="ocr-teams" id="ocr-teams-div">
          <div class="ocr-team-col">
            <div class="ocr-label">AWAY</div>
            <select id="ocr-away" class="ocr-select"></select>
            <input type="number" id="ocr-away-score" class="ocr-score-input" min="0" max="99" placeholder="点">
          </div>
          <div class="ocr-vs">VS<button class="btn-swap-sides" id="btn-swap-sides" title="左右を画像に合わせて入れ替え">${ICON.swap}</button></div>
          <div class="ocr-team-col">
            <div class="ocr-label">HOME</div>
            <select id="ocr-home" class="ocr-select"></select>
            <input type="number" id="ocr-home-score" class="ocr-score-input" min="0" max="99" placeholder="点">
          </div>
        </div>
        <div class="pk-row">
          <label class="pk-toggle-label">
            <input type="checkbox" id="pk-check"> PK戦あり
          </label>
          <div class="pk-inputs" id="pk-inputs" style="display:none">
            <input type="number" id="ocr-away-pk" class="ocr-score-input" min="0" max="99" placeholder="AWAY PK">
            <span class="pk-label-center">PK</span>
            <input type="number" id="ocr-home-pk" class="ocr-score-input" min="0" max="99" placeholder="HOME PK">
          </div>
        </div>
        <div class="ocr-date-row">
          <label class="ocr-label">試合日</label>
          <input type="date" id="ocr-date" class="ocr-date-input" value="${toDateStr(now)}">
        </div>
        <div class="ocr-date-row">
          <label class="ocr-label">登録月</label>
          <div class="reg-month-wrap">
            <select id="ocr-reg-year" class="save-month-select" style="width:auto">
              <option value="${STATE.statsYear}" selected>${STATE.statsYear}年</option>
              <option value="${STATE.statsYear+1}">${STATE.statsYear+1}年</option>
            </select>
            <select id="ocr-reg-month" class="save-month-select" style="width:auto">${regMonthOpts}</select>
          </div>
        </div>
        <div class="action-row">
          <button class="btn-save" id="ocr-save-btn" style="flex:1">${ICON.save}登録</button>
          <button class="btn-reset" id="ocr-cancel-btn">キャンセル</button>
        </div>
      </div>
    </div>

    <!-- 結果一覧 -->
    <div class="stats-table-wrap">
      <div class="stats-section-title" id="results-title">${STATE.statsYear}年${STATE.statsMonth}月の対戦結果</div>
      <div id="results-list">読み込み中…</div>
    </div>

    <!-- 月次順位表 -->
    <div class="standings-wrap">
      <div class="stats-section-title" id="standings-title">${STATE.statsYear}年${STATE.statsMonth}月の順位表</div>
      <div id="standings-table">読み込み中…</div>
    </div>

    <!-- 年間総合順位表 -->
    <div class="standings-wrap">
      <div class="stats-section-title">${ICON.calendar}${STATE.statsYear}年 年間総合順位</div>
      <div id="annual-standings">読み込み中…</div>
    </div>
  `;

  /* 月ナビ */
  document.getElementById('stats-prev')?.addEventListener('click', () => {
    STATE.statsMonth--;
    if (STATE.statsMonth < 1) { STATE.statsMonth = 12; STATE.statsYear--; }
    _loadStatsData();
  });
  document.getElementById('stats-next')?.addEventListener('click', () => {
    STATE.statsMonth++;
    if (STATE.statsMonth > 12) { STATE.statsMonth = 1; STATE.statsYear++; }
    _loadStatsData();
  });

  /* プレイヤーセレクト（先頭に空欄を追加してOCR未検出を明示） */
  const playerOptions =
    '<option value="">-- 選択してください --</option>' +
    STATE.players.map(p =>
      `<option value="${p.name}">${p.name}（${p.charName}）</option>`).join('');
  ['ocr-away','ocr-home'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) sel.innerHTML = playerOptions;
  });

  /* OCR */
  document.getElementById('ocr-input')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const previewWrap = document.getElementById('ocr-preview-wrap');
    const preview     = document.getElementById('ocr-preview');
    const status      = document.getElementById('ocr-status');
    const barFill     = document.getElementById('ocr-bar-fill');
    preview.src = URL.createObjectURL(file);
    previewWrap.style.display = 'block';
    status.textContent = '解析中…';
    if (typeof Tesseract === 'undefined') {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      document.head.appendChild(s);
      await new Promise(resolve => s.onload = resolve);
    }
    try {
      const playerMap = {};
      STATE.players.forEach(p => { playerMap[p.charName] = p.name; });
      const result = await OCR.parseMatchResult(file, playerMap, pct => {
        barFill.style.width = pct + '%';
        status.textContent  = `OCR解析中… ${pct}%`;
      });
      /* 前回の値をリセット（スコア・PK・プレイヤー選択・左右） */
      document.getElementById('ocr-away').value = '';
      document.getElementById('ocr-home').value = '';
      document.getElementById('pk-check').checked = false;
      document.getElementById('pk-inputs').style.display = 'none';
      document.getElementById('ocr-away-pk').value = '';
      document.getElementById('ocr-home-pk').value = '';
      document.getElementById('ocr-teams-div').classList.remove('reversed');
      document.getElementById('pk-inputs').classList.remove('reversed');
      const awayLabel = result.awayChar ? result.awayChar.playerName : '（未検出）';
      const homeLabel = result.homeChar ? result.homeChar.playerName : '（未検出）';
      const scoreDisp = (result.awayScore !== null && result.homeScore !== null)
        ? `${result.awayScore}-${result.homeScore}` : '未検出';
      const d = result._debug || {};
      status.innerHTML = `解析完了 スコア:${scoreDisp} AWAY:${awayLabel} HOME:${homeLabel}`
        + `<br><small style="opacity:.7;font-size:0.72em;word-break:break-all">`
        + `スコア生:「${result.scoreRaw}」 PK生:「${d.pkRaw||''}」 バッジ:「${d.badgeRaw||''}」`
        + `<br>左チーム:「${d.leftTeamRaw||''}」 右チーム:「${d.rightTeamRaw||''}」`
        + `<br>HOME=${d.leftIsHome?'左':'右'}</small>`;
      try {
        if (typeof firebase !== 'undefined' && firebase.apps.length) {
          firebase.database().ref('config/ocrDebug').set({
            ts: new Date().toISOString(),
            fileName: file.name,
            scoreRaw: result.scoreRaw,
            awayScore: result.awayScore, homeScore: result.homeScore,
            awayPK: result.awayPK,       homePK: result.homePK,
            awayRaw: result.awayRaw,     homeRaw: result.homeRaw,
            awayPlayer: awayLabel,       homePlayer: homeLabel,
            pkRaw: d.pkRaw, badgeRaw: d.badgeRaw,
            leftTeamRaw: d.leftTeamRaw, rightTeamRaw: d.rightTeamRaw,
            leftIsHome: d.leftIsHome,
          }).catch(e => console.warn('[OCR debug write]', e));
        }
      } catch(e) {}
      document.getElementById('ocr-result-form').style.display = 'block';
      if (result.awayChar) _setSelect('ocr-away', result.awayChar.playerName);
      if (result.homeChar) _setSelect('ocr-home', result.homeChar.playerName);
      if (result.awayScore !== null) document.getElementById('ocr-away-score').value = result.awayScore;
      if (result.homeScore !== null) document.getElementById('ocr-home-score').value = result.homeScore;
      if (result.awayPK !== null && result.homePK !== null) {
        document.getElementById('pk-check').checked = true;
        document.getElementById('pk-inputs').style.display = 'flex';
        document.getElementById('ocr-away-pk').value = result.awayPK;
        document.getElementById('ocr-home-pk').value = result.homePK;
      }
      /* 画像に合わせてAWAY/HOMEの左右位置を揃える */
      if (d.leftIsHome) {
        document.getElementById('ocr-teams-div').classList.add('reversed');
        document.getElementById('pk-inputs').classList.add('reversed');
      }
    } catch (err) {
      status.textContent = `解析失敗: ${err.message}`;
    }
  });

  /* 登録ボタン */
  document.getElementById('ocr-save-btn')?.addEventListener('click', async () => {
    const away      = document.getElementById('ocr-away')?.value;
    const home      = document.getElementById('ocr-home')?.value;
    const awayScore = parseInt(document.getElementById('ocr-away-score')?.value, 10);
    const homeScore = parseInt(document.getElementById('ocr-home-score')?.value, 10);
    const date      = document.getElementById('ocr-date')?.value;
    const regYear   = parseInt(document.getElementById('ocr-reg-year')?.value, 10) || STATE.statsYear;
    const regMonth  = parseInt(document.getElementById('ocr-reg-month')?.value, 10) || STATE.statsMonth;
    if (!away || !home || away === home || isNaN(awayScore) || isNaN(homeScore)) {
      toast('入力を確認してください'); return;
    }
    const hasPK  = document.getElementById('pk-check')?.checked;
    const awayPK = hasPK ? parseInt(document.getElementById('ocr-away-pk')?.value, 10) : null;
    const homePK = hasPK ? parseInt(document.getElementById('ocr-home-pk')?.value, 10) : null;
    await SYNC.saveResult(regYear, regMonth, { date, away, home, awayScore, homeScore, awayPK, homePK, addedBy: STATE.userName || '不明' });
    toast(`${regYear}年${regMonth}月に登録しました`);
    document.getElementById('ocr-result-form').style.display = 'none';
    document.getElementById('ocr-preview-wrap').style.display = 'none';
  });

  document.getElementById('pk-check')?.addEventListener('change', e => {
    document.getElementById('pk-inputs').style.display = e.target.checked ? 'flex' : 'none';
  });
  document.getElementById('btn-swap-sides')?.addEventListener('click', () => {
    document.getElementById('ocr-teams-div').classList.toggle('reversed');
    document.getElementById('pk-inputs').classList.toggle('reversed');
  });
  document.getElementById('ocr-cancel-btn')?.addEventListener('click', () => {
    document.getElementById('ocr-result-form').style.display = 'none';
    document.getElementById('ocr-preview-wrap').style.display = 'none';
  });

  _loadStatsData();
}

function _loadStatsData() {
  const y = STATE.statsYear, m = STATE.statsMonth;
  const label = document.getElementById('stats-month-label');
  const rt    = document.getElementById('results-title');
  const st    = document.getElementById('standings-title');
  if (label) label.textContent = `${y}年${m}月`;
  if (rt)    rt.textContent    = `${y}年${m}月の対戦結果`;
  if (st)    st.textContent    = `${y}年${m}月の順位表`;
  if (!SYNC) return;
  SYNC.watchResults(y, m, results => {
    /* 古いリスナーが別の月を上書きしないようガード */
    if (STATE.statsYear !== y || STATE.statsMonth !== m) return;
    _renderResultsList(results);
    _renderStandings(results);
  });
  SYNC.watchAnnualResults(y, allMonths => {
    if (STATE.statsYear !== y) return;
    _renderAnnualStandings(allMonths);
  });
}

function _setSelect(id, value) {
  const sel = document.getElementById(id);
  if (!sel) return;
  for (const opt of sel.options) {
    if (opt.value === value) { sel.value = value; return; }
  }
}

function _renderResultsList(results) {
  const el = document.getElementById('results-list');
  if (!el) return;
  const year  = STATE.statsYear;
  const month = STATE.statsMonth;
  const entries = Object.entries(results || {}).sort((a,b) => (b[1].date||'').localeCompare(a[1].date||''));
  if (!entries.length) { el.innerHTML = '<div class="history-empty">まだ結果がありません</div>'; return; }

  el.innerHTML = entries.map(([id, r]) => {
    const pkStr = (r.awayPK != null && r.homePK != null)
      ? `<div class="result-pk">${r.awayPK} PK ${r.homePK}</div>` : '';
    return `
    <div class="result-item" data-id="${id}">
      <div style="flex:1">
        <div class="result-date">${r.date || '日付不明'}</div>
        <div class="result-match">
          <span class="result-team">${r.away}</span>
          <span class="result-score">${r.awayScore} - ${r.homeScore}${pkStr}</span>
          <span class="result-team">${r.home}</span>
        </div>
      </div>
      <button class="btn-del-result" data-id="${id}" title="削除">${ICON.delete}</button>
    </div>`;
  }).join('');

  el.querySelectorAll('.btn-del-result').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('この結果を削除しますか？')) return;
      await SYNC.deleteResult(year, month, btn.dataset.id);
      toast('削除しました');
    });
  });
}

/* リーグ順位ボーナス: 1位=5, 2位=3, 3位=2, 4位=1, 5位=0 */
const RANK_BONUS = [5, 3, 2, 1, 0];

function _renderStandings(results) {
  const el = document.getElementById('standings-table');
  if (!el) return;
  STATE._lastMonthResults = results;
  const stats = {};
  STATE.players.forEach(p => {
    stats[p.name] = { w: 0, pkw: 0, d: 0, l: 0, gf: 0, ga: 0 };
  });

  Object.values(results || {}).forEach(r => {
    const a = stats[r.away]; const h = stats[r.home];
    if (!a || !h) return;
    a.gf += r.awayScore; a.ga += r.homeScore;
    h.gf += r.homeScore; h.ga += r.awayScore;

    const hasPK = r.awayPK != null && r.homePK != null;
    if (r.awayScore > r.homeScore) {
      a.w++; h.l++;
    } else if (r.awayScore < r.homeScore) {
      h.w++; a.l++;
    } else if (hasPK) {
      /* 引き分け→PK: PK勝者に1pt */
      if (r.awayPK > r.homePK) { a.pkw++; h.l++; }
      else                      { h.pkw++; a.l++; }
    } else {
      a.d++; h.d++;
    }
  });

  /* 試合勝点で順位付け — 試合0の選手は除外 */
  const matchPt = s => s.w * 3 + s.pkw * 1;
  const sorted = Object.entries(stats)
    .filter(([, s]) => s.w + s.pkw + s.d + s.l > 0)
    .sort((a,b) => matchPt(b[1]) - matchPt(a[1]) || (b[1].gf - b[1].ga) - (a[1].gf - a[1].ga));

  if (!sorted.length) { el.innerHTML = '<div class="history-empty">まだ結果がありません</div>'; return; }

  /* リーグ順位ボーナス付与 */
  sorted.forEach(([, s], i) => { s.rankBonus = RANK_BONUS[i] ?? 0; });

  const avatarCell = name => {
    const url = STATE.playerAvatars[name];
    return url
      ? `<img src="${url}" class="standings-avatar" alt="">`
      : `<span class="standings-avatar-ph pxi pxi-player" aria-hidden="true"></span>`;
  };

  el.innerHTML = `
    <table class="standings">
      <thead>
        <tr>
          <th>#</th><th></th><th>選手</th><th>勝</th><th>PK</th><th>分</th><th>敗</th>
          <th>試合Pt</th><th>順位Pt</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map(([name, s], i) => `
          <tr class="${i===0?'rank-gold':i===1?'rank-silver':i===2?'rank-bronze':''}">
            <td>${i+1}</td>
            <td>${avatarCell(name)}</td>
            <td>${name}</td>
            <td>${s.w}</td><td>${s.pkw}</td><td>${s.d}</td><td>${s.l}</td>
            <td>${matchPt(s)}</td>
            <td><b>${s.rankBonus}</b></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ── 年間総合順位表 ── */
function _calcMonthlyStats(monthResults) {
  const stats = {};
  STATE.players.forEach(p => { stats[p.name] = { w:0, pkw:0, d:0, l:0, gf:0, ga:0 }; });
  Object.values(monthResults || {}).forEach(r => {
    const a = stats[r.away]; const h = stats[r.home];
    if (!a || !h) return;
    a.gf += r.awayScore; a.ga += r.homeScore;
    h.gf += r.homeScore; h.ga += r.awayScore;
    const hasPK = r.awayPK != null && r.homePK != null;
    if      (r.awayScore > r.homeScore)  { a.w++;   h.l++; }
    else if (r.awayScore < r.homeScore)  { h.w++;   a.l++; }
    else if (hasPK) {
      if (r.awayPK > r.homePK) { a.pkw++; h.l++; }
      else                      { h.pkw++; a.l++; }
    } else { a.d++; h.d++; }
  });
  return stats;
}

function _renderAnnualStandings(allMonths) {
  const el = document.getElementById('annual-standings');
  if (!el) return;
  STATE._lastAnnualMonths = allMonths;

  const annual = {};
  STATE.players.forEach(p => { annual[p.name] = { rankPt: 0 }; });

  const matchPt = s => s.w * 3 + s.pkw;

  Object.entries(allMonths).forEach(([, monthResults]) => {
    if (!monthResults || !Object.keys(monthResults).length) return;
    const stats = _calcMonthlyStats(monthResults);
    const active = Object.entries(stats).filter(([, s]) => s.w + s.pkw + s.d + s.l > 0);
    if (!active.length) return;
    const sorted = active.sort((a,b) => matchPt(b[1]) - matchPt(a[1]) || (b[1].gf-b[1].ga)-(a[1].gf-a[1].ga));
    sorted.forEach(([name], i) => {
      if (annual[name] != null) annual[name].rankPt += RANK_BONUS[i] ?? 0;
    });
  });

  const sorted = Object.entries(annual).sort((a,b) => b[1].rankPt - a[1].rankPt);

  if (!sorted.some(([,a]) => a.rankPt > 0)) {
    el.innerHTML = '<div class="history-empty">まだデータがありません</div>'; return;
  }

  const avatarCell = name => {
    const url = STATE.playerAvatars[name];
    return url ? `<img src="${url}" class="standings-avatar" alt="">` : `<span class="standings-avatar-ph pxi pxi-player" aria-hidden="true"></span>`;
  };

  el.innerHTML = `
    <table class="standings">
      <thead><tr><th>#</th><th></th><th>選手</th><th>年間順位Pt</th></tr></thead>
      <tbody>
        ${sorted.map(([name, a], i) => `
          <tr class="${i===0?'rank-gold':i===1?'rank-silver':i===2?'rank-bronze':''}">
            <td>${i+1}</td>
            <td>${avatarCell(name)}</td>
            <td>${name}</td>
            <td><b>${a.rankPt}</b></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/* ══════════════════════════════════════════════
   HISTORY PANEL
══════════════════════════════════════════════ */
function renderHistory() {
  const panel = document.getElementById('panel-history');
  if (!panel) return;

  panel.innerHTML = `
    <div class="history-toolbar">
      <h2>${ICON.history}スピン履歴</h2>
    </div>
    <div id="hist-list"><div class="history-empty">読み込み中…</div></div>`;

  const renderList = hist => {
    const listEl = document.getElementById('hist-list');
    if (!listEl) return;
    if (!hist.length) { listEl.innerHTML = '<div class="history-empty">まだ履歴がありません</div>'; return; }
    listEl.innerHTML = hist.map(h => {
      const dt = new Date(h.timestamp || h.savedAt || 0);
      const ts = `${dt.getMonth()+1}/${dt.getDate()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
      const av = h.avatarUrl
        ? `<img class="hist-avatar" src="${h.avatarUrl}" alt="">`
        : `<div class="hist-avatar" style="display:flex;align-items:center;justify-content:center;">${ICON.player}</div>`;
      return `<div class="hist-item">
        <div class="hist-meta">
          <div class="hist-who">${av}<span class="hist-name">${h.name}</span></div>
          <span class="hist-time">${ts}</span>
        </div>
        <div class="hist-results">
          <span class="hchip r1">${ICON.bolt}${Array.isArray(h.round1) ? h.round1[0] : ''}</span>
          <span class="hchip r1">${ICON.bolt}${Array.isArray(h.round1) ? h.round1[1] : ''}</span>
          <span class="hdiv">｜</span>
          <span class="hchip r2">${ICON.dice}${h.round2 || ''}</span>
        </div>
      </div>`;
    }).join('');
  };

  if (SYNC) {
    SYNC.watchSpinHistory(renderList);
  } else {
    renderList(SYNC?.getLegacyHistory() || []);
  }

}

/* ══════════════════════════════════════════════
   SETTINGS PANEL
══════════════════════════════════════════════ */
function renderSettings() {
  const panel = document.getElementById('panel-settings');
  if (!panel) return;

  const rows = (arr, pfx, count) =>
    Array.from({length: count}, (_, i) =>
      `<div class="item-row">
        <span class="item-num">${i+1}</span>
        <input type="text" id="${pfx}${i}" value="${(arr[i] || '').replace(/"/g,'&quot;')}" maxlength="20">
      </div>`).join('');

  /* プレイヤー行 */
  const playerRows = STATE.players.map((p, i) => `
    <div class="player-row">
      <span class="player-num">${i+1}</span>
      <input class="player-input" id="pname${i}" value="${p.name}" placeholder="名前" maxlength="8">
      <input class="player-input" id="pchar${i}" value="${p.charName}" placeholder="キャラクター名" maxlength="20">
    </div>`).join('');

  panel.innerHTML = `
    <div class="settings-section">
      <h3 class="settings-section-title">${ICON.group}プレイヤー設定</h3>
      <div class="player-header">
        <span style="flex:0 0 24px"></span>
        <span class="player-col-label">名前</span>
        <span class="player-col-label">ゲームキャラ名</span>
      </div>
      ${playerRows}
      <button class="btn-save" id="sv-players">保存</button>
    </div>

    <div class="settings-grid">
      <div class="settings-card">
        <h3>${ICON.spin}12択リスト</h3>
        ${rows(STATE.items12,'a',12)}
        <button class="btn-save" id="sv12">保存</button>
      </div>
      <div class="settings-card">
        <h3>${ICON.dice}6択リスト</h3>
        ${rows(STATE.items6,'b',6)}
        <button class="btn-save" id="sv6">保存</button>
      </div>
    </div>

    <div class="settings-card" style="margin-top:10px">
      <h3>${ICON.calendar}縛り月設定</h3>
      <p style="font-size:0.78em;color:var(--text-sub);margin-bottom:10px">現在の縛り月: ${RESTRICT_MONTHS.join('・')}月</p>
      <p style="font-size:0.75em;color:var(--text-sub)">縛り月の変更は管理者へご連絡ください</p>
    </div>
  `;

  document.getElementById('sv-players')?.addEventListener('click', async () => {
    STATE.players = STATE.players.map((p, i) => ({
      ...p,
      name:     document.getElementById(`pname${i}`)?.value.trim() || p.name,
      charName: document.getElementById(`pchar${i}`)?.value.trim() || p.charName,
    }));
    if (SYNC) await SYNC.saveConfig({ players: STATE.players });
    toast('プレイヤー情報を保存しました');
  });

  document.getElementById('sv12')?.addEventListener('click', async () => {
    STATE.items12 = Array.from({length:12}, (_,i) =>
      document.getElementById(`a${i}`)?.value.trim() || DEFAULT_12[i]);
    if (SYNC) await SYNC.saveConfig({ items12: STATE.items12 });
    toast('12択リストを保存しました');
  });

  document.getElementById('sv6')?.addEventListener('click', async () => {
    STATE.items6 = Array.from({length:6}, (_,i) =>
      document.getElementById(`b${i}`)?.value.trim() || DEFAULT_6[i]);
    if (SYNC) await SYNC.saveConfig({ items6: STATE.items6 });
    toast('6択リストを保存しました');
  });
}

/* ══════════════════════════════════════════════
   HELP MODAL
══════════════════════════════════════════════ */
function initHelp() {
  const modal = document.getElementById('help-modal');
  document.getElementById('btn-help')?.addEventListener('click', () => modal?.classList.add('open'));
  document.getElementById('btn-modal-close')?.addEventListener('click', () => modal?.classList.remove('open'));
  modal?.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });

  const body = document.getElementById('help-body');
  if (!body) return;
  body.innerHTML = `
    <div class="help-section">
      <h3>このアプリについて</h3>
      <p class="help-intro">
        ウイニングコレクション（ウイコレ）の毎月の対戦縛りルールを<b>ルーレットで公平に決定</b>するアプリです。<br>
        敗者がルーレットを回してルールを決めます。結果はリアルタイムで全員に共有されます。
      </p>
    </div>
    <div class="help-section">
      <h3>${ICON.game}ゲーム（ルーレット）</h3>
      <div class="help-item"><div class="help-item-name">第1ルーレット（12択）</div>
        <div class="help-item-desc">12種類のルールから2回スピンして2つを抽選します。敗者が好きな方を選べます。</div></div>
      <div class="help-item"><div class="help-item-name">第2ルーレット（6択）</div>
        <div class="help-item-desc">さらに6択から1回スピンして追加ルールを決定します。</div></div>
      <div class="help-item"><div class="help-item-name">結果シェア</div>
        <div class="help-item-desc">「LINEで送る」ボタンでグループに結果を投稿できます。</div></div>
    </div>
    <div class="help-section">
      <h3>${ICON.calendar}カレンダー</h3>
      <div class="help-item"><div class="help-item-name">縛り月・フリー月の表示</div>
        <div class="help-item-desc">月ごとに「縛り」「フリー」をカレンダー上でワンタッチで切り替えられます。</div></div>
      <div class="help-item"><div class="help-item-name">ルール記録</div>
        <div class="help-item-desc">各月に決まったルールをテキストで登録・編集できます。編集者名が履歴に残ります。</div></div>
      <div class="help-item"><div class="help-item-name">削除</div>
        <div class="help-item-desc">登録済みルールを削除できます。誰が削除したかが記録されます。</div></div>
    </div>
    <div class="help-section">
      <h3>${ICON.stats}集計</h3>
      <div class="help-item"><div class="help-item-name">試合結果の登録</div>
        <div class="help-item-desc">ウイコレのスクリーンショットをアップロードするとOCRでスコア・プレイヤー名を自動読み取りして登録できます。登録する月を選んで保存します。</div></div>
      <div class="help-item"><div class="help-item-name">月次順位表</div>
        <div class="help-item-desc">月ごとの勝敗・勝点（勝3pt、PK勝1pt）・順位ポイントを集計します。前後ボタンで月を切り替えて過去の結果も確認できます。</div></div>
      <div class="help-item"><div class="help-item-name">年間順位表</div>
        <div class="help-item-desc">各月の順位ポイント（1位5pt・2位3pt・3位2pt・4位1pt・5位0pt）の累計で年間ランキングを表示します。</div></div>
      <div class="help-item"><div class="help-item-name">結果の削除</div>
        <div class="help-item-desc">登録した試合結果を個別に削除できます。</div></div>
    </div>
    <div class="help-section">
      <h3>${ICON.history}履歴</h3>
      <div class="help-item"><div class="help-item-name">スピン履歴</div>
        <div class="help-item-desc">ルーレットを回した記録が新しい順に表示されます。誰がいつ何を引いたか確認できます。プロフィールアイコン付きで表示されます。</div></div>
    </div>
    <div class="help-section">
      <h3>${ICON.settings}設定</h3>
      <div class="help-item"><div class="help-item-name">プレイヤー設定</div>
        <div class="help-item-desc">プレイヤー名・キャラクター名（監督名）・LINE IDを登録・編集できます。</div></div>
      <div class="help-item"><div class="help-item-name">ルール項目編集</div>
        <div class="help-item-desc">12択・6択のルール内容を自由に変更できます。</div></div>
      <div class="help-item"><div class="help-item-name">縛り月設定</div>
        <div class="help-item-desc">縛りルールを適用する月をON/OFFで切り替えられます。</div></div>
    </div>`;
}

/* ══════════════════════════════════════════════
   HEADER / PROFILE
══════════════════════════════════════════════ */
function updateHeader(profile) {
  const avatarEl = document.getElementById('profile-avatar');
  const nameEl   = document.getElementById('name-input');

  if (profile) {
    STATE.userName  = profile.displayName;
    STATE.avatarUrl = profile.pictureUrl;

    if (avatarEl && profile.pictureUrl) avatarEl.src = profile.pictureUrl;
    if (nameEl) {
      nameEl.value    = profile.displayName;
      nameEl.readOnly = true;   /* LINE取得時は編集不可 */
      nameEl.style.opacity = '0.75';
      nameEl.title    = 'LINEアカウント名は変更できません';
    }
  }
}

/* ── クリップボード ── */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch(_) {
    const el = Object.assign(document.createElement('textarea'), {
      value: text, style: 'position:fixed;opacity:0'
    });
    document.body.appendChild(el);
    el.select(); document.execCommand('copy');
    document.body.removeChild(el);
  }
}

/* ── 起動 ── */
async function boot() {

  /* ① UI を先に描画（Firebase/LIFFより先に表示） */
  initNav();
  initHelp();
  STATE.isSpinner = true;
  renderGame();
  renderSettings();

  /* ② LIFF 初期化（LINE アカウント取得） */
  try {
    const result = await LIFF_WRAPPER.init();
    if (result.profile) updateHeader(result.profile);
  } catch(e) {
    console.warn('[boot] LIFF error:', e);
  }

  /* ③ Firebase 初期化と設定同期 */
  try {
    SYNC.init();
    SYNC.watchConfig(cfg => {
      if (cfg.items12?.length === 12)  STATE.items12        = cfg.items12;
      if (cfg.items6?.length  === 6)   STATE.items6         = cfg.items6;
      if (cfg.players?.length)         STATE.players        = cfg.players;
      if (cfg.restrictMonths?.length)  STATE.restrictMonths = cfg.restrictMonths;
    });

    /* アバターURL監視・自分のアバターを保存 */
    SYNC.watchPlayerAvatars(avatars => {
      /* Firebase キー（LINE表示名）→ 設定プレイヤー名 へ正規化して格納
         例: "矢部智也" → "矢部"（プレイヤー名が含まれていれば一致とみなす） */
      const raw = avatars || {};
      const mapped = {};
      for (const [key, url] of Object.entries(raw)) {
        const hit = STATE.players.find(p =>
          p.name === key ||
          key.includes(p.name) ||
          p.name.includes(key)
        );
        mapped[hit ? hit.name : key] = url;
      }
      STATE.playerAvatars = mapped;
      if (STATE._lastMonthResults != null) _renderStandings(STATE._lastMonthResults);
      if (STATE._lastAnnualMonths  != null) _renderAnnualStandings(STATE._lastAnnualMonths);
    });
    if (STATE.userName && STATE.avatarUrl) {
      /* lineId・完全一致・部分一致の順でプレイヤーを照合してから保存 */
      const matched = STATE.players.find(p =>
        p.lineId === STATE.userName ||
        p.name === STATE.userName ||
        STATE.userName.includes(p.name) ||
        p.name.includes(STATE.userName)
      );
      SYNC.savePlayerAvatar(matched ? matched.name : STATE.userName, STATE.avatarUrl);
    }

    /* セッション作成（全員が同じ current パスを参照） */
    SYNC.on('session', data => {
      if (!data) return;
      /* 他の人がスピン中ならステータスだけ更新 */
      if (data.spinning && data.spinnerName !== STATE.userName) {
        const st = document.getElementById('spin-status');
        if (st) st.textContent = `${data.spinnerName}がスピン中…`;
      }
    });

    const name = STATE.userName || '敗者';
    const newId = await SYNC.createSession(name);
    STATE.sessionId = newId;

  } catch(e) {
    console.warn('[boot] Firebase error:', e);
    /* Firebase 失敗でも LocalStorage でゲームは動く */
  }
}

/* Firebase セッション状態で UI を同期 */
function syncFromFirebase(data) {
  if (!data) return;
  const status = document.getElementById('spin-status');
  if (data.spinning && data.spinnerName !== STATE.userName) {
    if (status) status.textContent = `${data.spinnerName || '誰か'}がスピン中…`;
  }
}

document.addEventListener('DOMContentLoaded', boot);
