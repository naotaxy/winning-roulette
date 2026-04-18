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

  /* ── Replace with your LIFF ID after creating in LINE Developers Console ── */
  const LIFF_ID = 'YOUR_LIFF_ID_HERE';

  let _profile    = null;
  let _inLine     = false;
  let _ready      = false;

  /* ── Initialize ── */
  async function init() {
    if (LIFF_ID === 'YOUR_LIFF_ID_HERE') {
      console.info('[LIFF] No LIFF ID set — running in browser-only mode.');
      _ready = true;
      return { inLine: false, profile: null, needsSetup: true };
    }

    try {
      await liff.init({ liffId: LIFF_ID });
      _inLine = liff.isInClient();
      _ready  = true;

      if (_inLine || liff.isLoggedIn()) {
        _profile = await liff.getProfile();
      } else if (_inLine) {
        liff.login({ redirectUri: location.href });
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

    const r1Items = round1.map(text => ({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: '⚡', size: 'sm', flex: 0 },
        { type: 'text', text, size: 'sm', weight: 'bold', margin: 'sm', color: '#f4d560' }
      ]
    }));

    return {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#07091a',
        paddingAll: '14px',
        contents: [
          {
            type: 'text',
            text: '⚽ ウイコレ ルール決め',
            color: '#d4af37',
            weight: 'bold',
            size: 'sm',
            align: 'center',
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#0e1230',
        paddingAll: '14px',
        spacing: 'sm',
        contents: [
          /* User info row */
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            margin: 'none',
            contents: [
              pictureUrl
                ? { type: 'image', url: pictureUrl, size: '36px', aspectRatio: '1:1', aspectMode: 'cover', cornerRadius: '18px' }
                : { type: 'text', text: '👤', size: 'xl', flex: 0 },
              {
                type: 'box',
                layout: 'vertical',
                justifyContent: 'center',
                contents: [
                  { type: 'text', text: name, weight: 'bold', size: 'sm', color: '#eef0ff' },
                  { type: 'text', text: 'がルーレットを回しました', size: 'xxs', color: '#8892b0' }
                ]
              }
            ]
          },
          { type: 'separator', margin: 'md', color: '#d4af3740' },
          /* Round 1 */
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            spacing: 'xs',
            contents: [
              { type: 'text', text: '【第1回】12択から2個', size: 'xxs', color: '#8892b0' },
              ...r1Items
            ]
          },
          /* Round 2 */
          {
            type: 'box',
            layout: 'vertical',
            margin: 'sm',
            spacing: 'xs',
            contents: [
              { type: 'text', text: '【第2回】6択から1個', size: 'xxs', color: '#8892b0' },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  { type: 'text', text: '🎲', size: 'sm', flex: 0 },
                  { type: 'text', text: round2, size: 'sm', weight: 'bold', margin: 'sm', color: '#00d9ff' }
                ]
              }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#0e1230',
        paddingAll: '12px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#d4af37',
            height: 'sm',
            action: {
              type: 'uri',
              label: '自分もやってみる',
              uri: location.href.split('?')[0]
            }
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
