# 秘書トラペル子 — システム全体構成図

> Claude / Codex がコンテキストを失った状態でも全体像を把握できるよう、2026-04-27 時点の構成・実装・注意点を記録する。

---

## 1. リポジトリ概要

| 項目 | 内容 |
|------|------|
| リポジトリ名 | `naotaxy/winning-roulette` |
| 主ブランチ | `main`（GitHub Pages用）/ `feature/linebot`（Bot本体） |
| デプロイ先 | Render.com（LINE Bot）・GitHub Pages（フロントエンド） |
| 主要言語 | JavaScript (Node.js 20/24) |

---

## 2. ディレクトリ構成

```
winning-roulette/
├── index.html             # ウイコレ勝利ルーレット（GitHub Pages フロント）
├── js/                    # フロントJS（roulette.js, app.js, sync.js 等）
├── linebot/               # LINE Bot 本体（Render.com で動作）
│   ├── server.js          # Express サーバー + バックグラウンド sweep
│   └── src/
│       ├── webhook.js     # 全イベントのエントリポイント（最大ファイル）
│       ├── firebase-admin.js  # Firebase CRUD の全 API を集約
│       ├── flyer-stock-service.js  # チラシ取得・Gemini OCR・レシピ生成
│       ├── recipe-library.js  # ローカルレシピDB（~60件・季節/ジャンル/食材）
│       ├── wake-alarm.js      # アラーム計算・フォーマット
│       ├── wake-alarm-worker.js   # アラーム sweep（毎分実行）
│       ├── wake-recipe-service.js # 起床時レシピ取得（チラシ→ライブラリ fallback）
│       ├── morning-briefing.js    # 朝のブリーフィング（ニュース・天気・電車）
│       ├── event-reminder.js      # リマインド登録・管理
│       ├── event-reminder-worker.js  # リマインド sweep（毎分実行）
│       ├── standings.js      # 順位計算・フォーマット
│       ├── secretary-chat.js # AI 自然会話（Gemini）
│       ├── noblesse-agent.js      # ノブレスモード本体
│       ├── noblesse-case.js       # 案件管理
│       ├── noblesse-curated.js    # おでかけ・買い物秘書
│       ├── noblesse-planner.js    # 旅・飲み会プランナー
│       ├── noblesse-booking.js    # 予約情報ヒアリング
│       ├── noblesse-execution.js  # 案件実行（送信等）
│       ├── noblesse-drafts.js     # 文面草案
│       ├── noblesse-search-intake.js  # 検索条件ヒアリング
│       ├── hotpepper.js      # ホットペッパー飲食店検索
│       ├── rakuten-travel.js # 楽天トラベル宿泊検索
│       ├── transport.js      # 経路・タクシー・フライト
│       ├── weather.js        # 天気取得（OpenWeatherMap）
│       ├── yahoo-api.js      # Yahoo天気・スポット検索
│       ├── geo-game.js       # 場所当てゲーム
│       ├── location-story.js # 場所の歴史案内
│       ├── nearby-guide.js   # 近くのお店案内
│       ├── concierge.js      # コンシェルジュ系ユーティリティ
│       ├── ocr-node.js       # 試合スクショOCR
│       ├── image-ocr-queue.js # OCRキュー管理
│       ├── image-guard.js    # 画像判別（スクショ判定）
│       ├── ocr-control.js    # OCR自動化ON/OFF
│       ├── ai-chat.js        # AI Chat ガード・使用量管理
│       ├── billing-risk.js   # 課金リスク判定
│       ├── character-memory.js  # キャラクター設定
│       ├── beast-mode.js     # ビーストモード管理
│       ├── member-profile.js # グループメンバー管理
│       ├── private-profile.js   # 本人用プロファイル（1対1）
│       ├── group-insights.js # グループ状況分析
│       ├── rule-message.js   # ウイコレ縛りルールメッセージ
│       ├── dice-games.js     # チンチロ・大小ゲーム
│       ├── date-utils.js     # JST日付ユーティリティ
│       ├── match-schedule.js # 対戦スケジュール管理
│       ├── help-message.js   # ヘルプテキスト
│       ├── flex-message.js   # FlexMessage ビルダー
│       ├── system-status.js  # システム状態チェック
│       ├── uicolle-knowledge.js  # ウイコレ知識ベース
│       ├── time-choice.js    # 時間選択UI
│       ├── project-guide.js  # Qiita/構成案内
│       └── github-actions-dispatcher.js  # GitHub Actions dispatch
├── scripts/
│   ├── generate-diary.js  # 日次日記生成（GitHub Actions）
│   ├── send-wake-alarms.js  # 起床アラーム送信スクリプト
│   └── send-event-reminders.js  # リマインド送信スクリプト
├── .github/workflows/
│   ├── daily-diary.yml    # 毎日 07:00 JST 日記生成 + 毎5分タスクディスパッチャ
│   ├── wake-alarm.yml     # 起床アラーム送信ワークフロー
│   └── event-reminder.yml # イベントリマインド送信ワークフロー
└── blog/                  # 日記マークダウン保存先（Actions が自動コミット）
```

---

## 3. ランタイム構成

```
┌─────────────────────────────────────────────────────────────────┐
│                        LINE Platform                             │
│  ユーザー発話 ──→ LINE Messaging API ──→ Webhook POST /webhook  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│              Render.com (linebot/server.js)                       │
│                                                                   │
│  Express + LINE middleware                                        │
│  ├── POST /webhook → webhook.handle(event, client)               │
│  ├── GET  /health  → 状態確認（UptimeRobot用）                   │
│  │                                                               │
│  └── Background sweep (setInterval 60s)                          │
│       ├── runEventReminderSweep()  ← event-reminder-worker.js   │
│       └── runWakeAlarmSweep()     ← wake-alarm-worker.js        │
└──────────────┬──────────────────────────────┬────────────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────┐        ┌─────────────────────────────────┐
│  Firebase Realtime DB│        │  GitHub Actions (定期実行)       │
│  (全状態の永続化)     │        │                                  │
│  ※後述のパス一覧参照 │        │  毎5分: event-reminder.yml       │
└──────────────────────┘        │           wake-alarm.yml        │
                                │  毎日07:00 JST: daily-diary.yml  │
                                │    → scripts/generate-diary.js  │
                                │      (YouTube+RSS+Gemini+Hatena) │
                                └─────────────────────────────────┘
```

---

## 4. メッセージ処理フロー（webhook.js）

```
LINE event (text / image / location / postback)
        │
        ▼
webhook.handle()
        │
        ├─ text / image ─────────────────────────────────────┐
        │                                                     │
        │  1. saveConversationMessage（Firebase に記録）       │
        │  2. updateGroupProfiles（グループなら表示名を更新）   │
        │  3. isProcessed（重複イベント除外）                  │
        │                                                     │
        │  ──→ OCR スクショ判定 → image-guard → OCR キュー    │
        │  ──→ postback        → handlePostback()            │
        │  ──→ location        → handleLocation()            │
        │  ──→ text            → handleText()                │
        │                                                     │
        ▼                                                     │
handleText()                                                  │
        │                                                     │
        ├─ ウイコレ系（順位/ルール/状況/未対戦 etc.）           │
        ├─ 起床アラーム設定・確認・解除                        │
        ├─ リマインド登録・一覧・キャンセル                    │
        ├─ 近くのお店・チラシ・特売レシピ                      │
        │    ── flyer-stock-service.js（Tokubai → Gemini）   │
        ├─ レシピ教えて（ジャンル/食材指定可）                 │
        │    ── flyer-stock-service.js + recipe-library.js   │
        ├─ 場所の歴史 / ジオゲーム                            │
        ├─ チンチロ / 大小                                    │
        ├─ ヘルプ                                             │
        ├─ プロフィール / 自己紹介 / 生い立ち                  │
        ├─ システム状態 / 課金確認                            │
        ├─ ノブレスモード ──→ noblesse-agent.js              │
        └─ AI 自然会話 ──→ secretary-chat.js（Gemini）        │
```

---

## 5. 起床アラームフロー

```
ユーザー「朝7時に起こして」
        │
        ▼
webhook.js → parseWakeAlarmRequest() → setWakeAlarm(Firebase)
  Firebase: wakeAlarms/{sourceId}
  {
    status: 'active',
    dueAt: <Unix ms>,
    recurring: true/false,
    schedule: { type: 'daily', hour: 7, minute: 0, tz: 'Asia/Tokyo' },
    weatherPlace: '...', weatherLatitude: ..., weatherLongitude: ...,
    recipeMode: 'flyer' | 'library' | 'none',
    newsMode: 'all' | 'wbs' | 'major' | 'none',
    testBriefing: false,
  }
        │
        ▼ (毎60秒 または GitHub Actions 毎5分)
wake-alarm-worker.js
  runWakeAlarmSweep()
    │
    ├─ Firebase から全アラーム読み込み
    ├─ claimWakeAlarm()（トランザクションで status='sending' に変更）
    │    ※ dueAt が [now-25分, now] の範囲にあるものだけクレーム
    │
    ├─ buildWakeMessages(alarm)
    │    ├─ formatWakeAlarmPushText() （挨拶テキスト）
    │    ├─ fetchWakeWeather() → formatWakeWeatherSummary()
    │    ├─ isMorningAlarm() → buildMorningBriefingMessages()
    │    │    （ニュース・NHK・電車遅延・天気詳細）
    │    └─ buildWakeRecipeMessage() ← wake-recipe-service.js
    │         ├─ チラシスナップショットがあれば buildRecipeFromFlyerSnapshot()
    │         └─ なければ buildFallbackRecipe()（recipe-library.js から選択）
    │
    ├─ pushLineMessages(sourceId, messages)（LINE push API）
    ├─ completeWakeAlarm() → recurring なら dueAt を翌日に前進
    │
    └─ advanceMissedRecurringAlarms()
         ※ LOOKBACK_MS(25分)を超えてスキップされたアラームを
           送信せずに dueAt だけ次回予定日時に前進させる
           （Render スリープ復帰時の永久スタック防止）
```

---

## 6. チラシ・レシピフロー

```
ユーザー「近くの特売レシピ」/ 「豚こまで作れる？」/ 「中華のレシピ教えて」
        │
        ▼
webhook.js
  detectFlyerStockIntent(text)
    戻り値: { action: 'recipe'|'stock', genre, mainIngredient }
        │
        ├─ location 未取得 → savePendingLocationRequest(genre, mainIngredient 含む)
        │   → 位置情報ボタンを出す
        │
        └─ location あり（handleLocation または直接）
                │
                ▼
           fetchFlyerStock(location) ← Tokubai スクレイプ
                │
                ├─ saveFlyerStockSnapshot(Firebase キャッシュ)
                │
                └─ buildRecipeFromFlyerSnapshot(snapshot, { filters })
                     ├─ Gemini 2.5-flash-lite に JSON 形式でレシピ依頼
                     │   generationConfig: { maxOutputTokens:600, thinkingBudget:0 }
                     ├─ フィルタヒント（genre / mainIngredient）をプロンプトに渡す
                     └─ 失敗時 → buildFallbackRecipe(snapshot, usedTitles, filters)
                          ← recipe-library.js から季節・ジャンル・食材で絞り込み

重複防止: wakeRecipeHistory/{sourceId}/{weekKey}[] に使用済みタイトルを記録
「他には？」: 同 history を参照して未使用レシピを返す
```

---

## 7. 日記生成フロー（GitHub Actions）

```
毎日 07:00 JST → daily-diary.yml → generate-diary.js
        │
        ├─ fetchYouTubeVideos()（YouTube Data API v3・eFootball関連）
        ├─ fetchEfootballNews()（Konami 公式 RSS）
        ├─ fetchWorldCupUpdates()（FIFA WC 期間中のみ Google News RSS）
        ├─ fetchGroupChatHighlights()（Firebase conversations/{groupId}/messages）
        │
        ├─ selectShopItemTopic()（SHOP_ITEM_TOPICS から未使用を選択）
        ├─ selectNinetiesTopic()（NINETIES_TRENDS から未使用を選択）
        ├─ selectInterestTopic()（OWNER_INTEREST_TOPICS から未使用を選択）
        ├─ selectStoryPlan()（AOZORA_STORY_MOTIFS 連載ストーリー 4フェーズ）
        │
        ├─ generateDiary(dateLabel, inputs)
        │    ← Gemini 2.5-flash（fallback: 2.5-flash-lite）
        │       generationConfig: { maxOutputTokens:1400, thinkingBudget:0, temperature:0.9 }
        │
        ├─ postToHatenaBlog()（AtomPub API）
        ├─ saveBlogMarkdown(blog/{date}.md)
        ├─ saveToFirebase(diary/{date} + config/uicolleNews)
        └─ updateDiaryStateAfterSuccess() → saveDiaryState(blog/diary-state.json)
             ← seenYouTubeTitles / seenNinetiesTitles / seenShopItemIds 等を更新
```

---

## 8. Firebase データ構造（主要パス）

| パス | 用途 |
|------|------|
| `config/players` | プレイヤー名・ID 設定 |
| `config/matchSchedule` | 対戦スケジュール |
| `config/uicolleNews` | 最新ウイコレ情報（日記から更新） |
| `config/restrictMonths` | 縛りルール月設定 |
| `config/geoGame` | ジオゲーム設定 |
| `config/aiChatGuard/*` | AI チャット使用量ガード状態 |
| `results/{year}/{month}` | 試合結果 |
| `rules/{year}/{month}` | ウイコレ縛りルール |
| `diary/{date}` | 日記アーカイブ |
| `wakeAlarms/{sourceId}` | 起床アラーム状態 |
| `wakeRecipeHistory/{sourceId}/{weekKey}` | 週ごとのレシピ使用履歴 |
| `flyerStockCache/{sourceId}/{dayKey}` | チラシスナップショット（日次キャッシュ） |
| `eventReminders/{sourceId}/{id}` | リマインド情報 |
| `locationMemory/{sourceId}/{userId}` | ユーザー最終位置情報 |
| `pendingLocationRequests/{sourceId}/{userId}` | 位置情報待ちリクエスト（genre/mainIngredient含む） |
| `conversations/{sourceId}/messages` | グループ会話記録（日記・分析用） |
| `geoGames/{sourceId}` | ジオゲーム進行状態 |
| `ocrAutomation/{sourceId}` | OCR 自動化ON/OFF 状態 |
| `screenshotCandidates/{sourceId}/{dayKey}` | OCR 待機スクショ |
| `beastMode/{sourceId}` | ビーストモード状態 |
| `noblesse/cases/{id}` | ノブレス案件 |
| `privateProfiles/{userId}` | 本人用プロファイル |
| `aiChatUsage/{period}` | AI チャット日次・月次使用量 |

---

## 9. 環境変数・シークレット一覧

### Render.com（linebot/）
| 変数名 | 用途 |
|--------|------|
| `LINE_CHANNEL_SECRET` | LINE Webhook 署名検証 |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Push API 認証 |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK 認証（JSON文字列） |
| `FIREBASE_DATABASE_URL` | Firebase RTDB URL |
| `GEMINI_API_KEY` | Gemini API（チラシOCR・レシピ生成・AI会話） |
| `OPENWEATHER_API_KEY` | 天気取得 |
| `YAHOO_APP_ID` | Yahoo API（天気・スポット） |
| `HOTPEPPER_API_KEY` | ホットペッパー飲食店検索 |
| `RAKUTEN_APP_ID` | 楽天トラベル宿泊検索 |
| `GITHUB_TOKEN_FOR_DISPATCH` | GitHub Actions workflow_dispatch トリガー |
| `AI_CHAT_ENABLED` | AI 自然会話の有効化フラグ |
| `AI_PROVIDER` | AI プロバイダ（`gemini`） |

### GitHub Actions（secrets）
| 変数名 | 用途 |
|--------|------|
| `YOUTUBE_API_KEY` | YouTube Data API v3 |
| `GEMINI_API_KEY` | 日記生成 |
| `HATENA_ID` / `HATENA_BLOG_ID` / `HATENA_API_KEY` | はてなブログ投稿 |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase アーカイブ保存 |
| `FIREBASE_DATABASE_URL` | Firebase RTDB URL |
| `LINE_CHANNEL_ACCESS_TOKEN` | wake alarm / reminder の LINE Push |
| `DIARY_PHOTO_URL` / `DIARY_PHOTO_CAPTION` | 日記の写真（任意） |
| `DIARY_GROUP_SOURCE_ID` | グループ会話取得用 sourceId（任意） |

### GitHub Actions（vars）
| 変数名 | 用途 |
|--------|------|
| `DIARY_GEMINI_MODEL` | 日記生成モデル（デフォルト: `gemini-2.5-flash`） |
| `DIARY_GEMINI_FALLBACK_MODELS` | フォールバックモデル（デフォルト: `gemini-2.5-flash-lite`） |

---

## 10. Gemini 利用箇所と設定

| 箇所 | モデル | 用途 | generationConfig |
|------|--------|------|-----------------|
| `flyer-stock-service.js` `buildRecipeFromFlyerSnapshot` | gemini-2.5-flash-lite | チラシからレシピ生成 | temp:0.5 / maxTokens:600 / thinkingBudget:0 |
| `flyer-stock-service.js` `extractTokubaiLeafletItemsWithGemini` | gemini-2.5-flash-lite | チラシ画像OCR | temp:0.2 / maxTokens:800 / thinkingBudget:0 |
| `secretary-chat.js` | gemini-2.5-flash-lite | AI 自然会話 | ai-chat.js のガード下で使用量管理 |
| `generate-diary.js` | gemini-2.5-flash (fallback: 2.5-flash-lite) | 日記生成 | temp:0.9 / maxTokens:1400 / thinkingBudget:0 |

> **重要**: Gemini 2.5 系はデフォルトで thinking mode が有効になりトークンを大量消費する。
> `thinkingConfig: { thinkingBudget: 0 }` を必ず指定すること。

---

## 11. recipe-library.js の構造

`linebot/src/recipe-library.js` に約 60 件の家庭料理レシピを収録。

各レシピのフィールド:
```js
{
  title: '豚こまの生姜焼き',
  season: 'all',          // 'spring' | 'summer' | 'fall' | 'winter' | 'all'
  genre: '和食',          // '和食' | '中華' | '洋食'
  mainIngredient: '豚こま', // '豚こま'|'鶏もも'|'鶏むね'|'鶏ひき'|'手羽先'|
                           //  '豚バラ'|'豚ひき'|'豚しゃぶ'|'豚ロース'|'魚'|'豆腐'|'卵'
  ingredients: [...],
  steps: [...],
  estimatedPriceText: 'チラシ価格',
  estimatedTotalPrice: '',
}
```

フィルタリングロジック（`buildFallbackRecipe`）:
1. genre 指定あり → genre で絞り込み
2. mainIngredient 指定あり → mainIngredient で絞り込み
3. どちらもなければ → 季節でフィルタ
4. 週内の使用済みタイトルを除外（重複防止）
5. ランダムに1件返す

---

## 12. wake-alarm-worker.js の設計ポイント

```
LOOKBACK_MS = 25分   ← この時間内の dueAt のみクレーム対象

claimWakeAlarm():
  Firebase トランザクションで status:'active' → 'sending' に変更
  claimToken を記録（他ワーカーとの競合防止）

completeWakeAlarm():
  送信成功後に status:'sent' または次回 dueAt に前進（recurring）

releaseWakeClaim():
  送信失敗時に status:'active' に戻し lastError を記録

advanceMissedRecurringAlarms():  ← 2026-04-26 追加
  LOOKBACK_MS を超えてスキップされた recurring アラームの dueAt を
  送信せずに次回予定日時へ前進させる
  → Render スリープ後の永久スタック問題を解決
```

---

## 13. 既知の制約・注意点

| 制約 | 内容 |
|------|------|
| Render スリープ | 無料プランは15分無操作でスリープ。wake alarm は GitHub Actions 毎5分トリガーで補完 |
| Tokubai スクレイプ | 非公式。サイト変更でチラシ取得が壊れる可能性あり |
| AI Chat ガード | 日次・月次トークン上限超過で自動無効化。上限は `config/aiChatGuard` で管理 |
| LINE push 上限 | 無料プランは月200件。グループへの push は慎重に |
| GitHub Actions 毎5分 | `2-57/5 * * * *` スケジュール（2分オフセットで GH Actions キュー回避） |
| Firebase 無料枠 | Spark プラン 1GB/日。`conversations/` の蓄積に注意 |

---

## 14. 開発フロー

```bash
# ブランチ: feature/linebot で作業
git checkout feature/linebot

# ローカル起動（.env が必要）
cd linebot && node server.js

# 文法チェック（編集後は必ず実行）
node --check linebot/src/<file>.js

# デプロイ: push すれば Render が自動デプロイ
git add <files>
git commit -m "..."
git push
```

---

## 15. 主要コミット履歴（feature/linebot）

| コミット | 内容 |
|---------|------|
| `1e01cba` | R01: 雑談 quick reply → おでかけ/買い物秘書ブリッジ |
| （以降R02–R42）| 各種機能追加・バグ修正 |
| R43 | recipe-library.js 新規作成（~60件のレシピDB） |
| R44 | ジャンル・食材フィルタ追加（和食/中華/洋食, 豚こま/鶏もも etc.） |
| R45 | location-pending フロー修正（genre/mainIngredient を永続化） |
| `5d0ad32` R46 | Gemini thinkingBudget:0 追加・起床アラーム永久スタック修正 |
| `7408616` R47 | 日記の音楽ネタ完全削除・ヘルプにレシピ操作説明追記 |

---

## 16. 共同開発ログ

詳細な実装記録は以下を参照:

```
/Users/naotay/Documents/Codex/2026-04-26-noblesse-collab-log.md
```

（Claude / Codex がラウンドごとに追記するリレー方式）
