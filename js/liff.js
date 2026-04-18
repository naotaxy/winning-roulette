/* ═══════════════════════════════════════════════════
   LINE LIFF WRAPPER
   ─ Auto-detects LINE environment
   ─ Gracefully falls back to manual name input
   ─ shareTargetPicker + Flex Message
   ═══════════════════════════════════════════════════

   SETUP STEPS (LINE Developers Console):
   1. https://developers.line.biz/console/
   2. プロバイダー作成 → LINE ログインチャネル作成
   3. LIFFタブ → 「追加」→ サイズ: Full, スコープ: profile
   4. 発行された LIFF ID を LIFF_ID に設定
   5. エンドポイントURLに GitHub Pages URL を設定 (HTTPS必須)
   ═══════════════════════════════════════════════════ */

'use strict';

const LIFF_WRAPPER = (() => {

  /* ── LIFF ID (LINE Developers Console で取得した値) ── */
  const LIFF_ID = '2009825025-LzTdx4vR';

  let _profile    = null;
  let _inLine     = false;
  let _ready      = false;

  /* ── Initialize ── */
  async function init() {
    if (!LIFF_ID || LIFF_ID === 'YOUR_LIFF_ID_HERE') {
      console.info('[LIFF] No LIFF ID set — running in browser-only mode.');
      _ready = true;
      return { inLine: false, profile: null, needsSetup: true };
    }

    try {
      await liff.init({ liffId: LIFF_ID });
      _inLine = liff.isInClient();
      _ready  = true;

      console.info('[LIFF] isInClient:', _inLine, '/ isLoggedIn:', liff.isLoggedIn());

      if (liff.isLoggedIn()) {
        /* ログイン済み → プロフィール取得 */
        _profile = await liff.getProfile();
        console.info('[LIFF] Profile:', _profile?.displayName);
      } else if (_inLine) {
        /* LINE内ブラウザなのにログインできていない → 再試行 */
        _profile = await liff.getProfile().catch(() => null);
        if (!_profile) {
          const baseUrl = location.origin + location.pathname;
          liff.login({ redirectUri: baseUrl });
          return { inLine: true, profile: null, needsSetup: false };
        }
      } else {
        /* 外部ブラウザ・未ログイン → LINE認証画面へ */
        const baseUrl = location.origin + location.pathname;
        liff.login({ redirectUri: baseUrl });
        return { inLine: false, profile: null, needsSetup: false };
      }

      return { inLine: _inLine, profile: _profile, needsSetup: false };
    } catch (e) {
      console.warn('[LIFF] Init failed:', e.message);
      _ready = true;
      return { inLine: false, profile: null, needsSetup: false };
    }
  }

  /* ── Get display name ── */
  function getDisplayName() {
    return _profile?.displayName ?? null;
  }

  /* ── Get avatar URL ── */
  function getPictureUrl() {
    return _profile?.pictureUrl ?? null;
  }

  /* ── Build Flex Message (LINE rich card) ── */
  function buildFlexMessage(entry) {
    const { name, round1, round2, pictureUrl } = entry;
    const appUrl = location.href.split('?')[0];

    const r1Items = round1.map((text, idx) => ({
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      margin: 'xs',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          width: '20px',
          height: '20px',
          backgroundColor: '#d4af3730',
          cornerRadius: '10px',
          alignItems: 'center',
          justifyContent: 'center',
          contents: [{ type: 'text', text: String(idx + 1), size: 'xxs', color: '#d4af37', weight: 'bold' }]
        },
        { type: 'text', text, size: 'sm', weight: 'bold', color: '#f4d560', flex: 1, wrap: true }
      ]
    }));

    return {
      type: 'bubble',
      size: 'mega',
      /* ── Header bar ── */
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#07091a',
        paddingTop: '14px',
        paddingBottom: '10px',
        paddingStart: '16px',
        paddingEnd: '16px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            alignItems: 'center',
            spacing: 'sm',
            contents: [
              { type: 'text', text: '⚽', size: 'xl', flex: 0 },
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  { type: 'text', text: 'WINNING ROULETTE', size: 'xs', weight: 'bold', color: '#d4af37', letterSpacing: '2px' },
                  { type: 'text', text: 'ウイコレ ルール決め', size: 'xxs', color: '#8892b0' }
                ]
              }
            ]
          }
        ]
      },
      /* ── Body ── */
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#0e1230',
        paddingAll: '16px',
        spacing: 'sm',
        contents: [
          /* Player info */
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'md',
            alignItems: 'center',
            contents: [
              pictureUrl
                ? { type: 'image', url: pictureUrl, size: '40px', aspectRatio: '1:1', aspectMode: 'cover', cornerRadius: '20px', flex: 0 }
                : { type: 'text', text: '👤', size: 'xxl', flex: 0 },
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  { type: 'text', text: name, weight: 'bold', size: 'md', color: '#eef0ff', wrap: true },
                  { type: 'text', text: 'がルーレットを回しました', size: 'xxs', color: '#8892b0' }
                ]
              }
            ]
          },
          { type: 'separator', margin: 'md', color: '#d4af3750' },
          /* Round 1 */
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            contents: [
              {
                type: 'box',
                layout: 'horizontal',
                alignItems: 'center',
                spacing: 'sm',
                margin: 'none',
                contents: [
                  { type: 'text', text: '▌', size: 'xs', color: '#d4af37', flex: 0 },
                  { type: 'text', text: '【第1回】12択から2個', size: 'xs', color: '#8892b0', weight: 'bold' }
                ]
              },
              {
                type: 'box',
                layout: 'vertical',
                margin: 'sm',
                paddingStart: '10px',
                spacing: 'xs',
                contents: r1Items
              }
            ]
          },
          { type: 'separator', margin: 'sm', color: '#d4af3730' },
          /* Round 2 */
          {
            type: 'box',
            layout: 'vertical',
            margin: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'horizontal',
                alignItems: 'center',
                spacing: 'sm',
                contents: [
                  { type: 'text', text: '▌', size: 'xs', color: '#00d9ff', flex: 0 },
                  { type: 'text', text: '【第2回】6択から1個', size: 'xs', color: '#8892b0', weight: 'bold' }
                ]
              },
              {
                type: 'box',
                layout: 'horizontal',
                margin: 'sm',
                paddingStart: '10px',
                spacing: 'sm',
                alignItems: 'center',
                contents: [
                  { type: 'text', text: '🎲', size: 'lg', flex: 0 },
                  { type: 'text', text: round2, size: 'md', weight: 'bold', color: '#00d9ff', flex: 1, wrap: true }
                ]
              }
            ]
          }
        ]
      },
      /* ── Footer ── */
      footer: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#07091a',
        paddingAll: '12px',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#d4af37',
            height: 'sm',
            action: { type: 'uri', label: '⚽ 自分もやってみる', uri: appUrl }
          },
          {
            type: 'text',
            text: 'WINNING ROULETTE for ウイコレ',
            size: 'xxs',
            color: '#ffffff30',
            align: 'center',
            margin: 'sm'
          }
        ]
      }
    };
  }

  /* ── Share via shareTargetPicker (LINE share sheet) ── */
  async function shareResult(entry) {
    if (!_ready) throw new Error('LIFF not ready');

    const msg = {
      type: 'flex',
      altText: `⚽ ${entry.name}さんのルール: ${entry.round1.join('・')} / ${entry.round2}`,
      contents: buildFlexMessage(entry)
    };

    if (_inLine && liff.isApiAvailable('shareTargetPicker')) {
      try {
        const res = await liff.shareTargetPicker([msg], { isMultiple: true });
        return res ? 'shared' : 'cancelled';
      } catch (e) {
        console.warn('[LIFF] shareTargetPicker failed:', e);
      }
    }

    /* Fallback: copy text */
    return 'fallback';
  }

  /* ── Send to current chat (when inside a chat) ── */
  async function sendToChat(entry) {
    if (!_inLine) return false;

    const text =
      `⚽ ウイコレ ルール決め\n👤 ${entry.name}\n\n` +
      `【第1回】\n${entry.round1.map(r => `⚡ ${r}`).join('\n')}\n\n` +
      `【第2回】\n🎲 ${entry.round2}`;

    try {
      await liff.sendMessages([{ type: 'text', text }]);
      return true;
    } catch (e) {
      console.warn('[LIFF] sendMessages failed:', e);
      return false;
    }
  }

  /* ── Build plain text for clipboard ── */
  function buildText(entry) {
    return (
      `⚽ ウイコレ ルール決め\n` +
      `👤 ${entry.name}\n\n` +
      `【第1回 12択】\n${entry.round1.map(r => `⚡ ${r}`).join('\n')}\n\n` +
      `【第2回 6択】\n🎲 ${entry.round2}`
    );
  }

  return { init, getDisplayName, getPictureUrl, shareResult, sendToChat, buildText };
})();
