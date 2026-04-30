# LINE Bot — セットアップ・運用ガイド

## 概要

LINEグループに試合結果のスクリーンショットを投稿すると、OCRでスコア・チーム名を読み取り、確認メッセージを返信してくれるBot。OKを押すとFirebaseに登録される。

```
[グループ] 画像送信
    ↓
[Bot] OCR解析 → 「試合結果、読めたよ。あなたに確認してほしいな。」
    ↓ OK押す
[Bot] Firebase登録 → 「登録できたよ。ちゃんと残したからね。」
```

---

## 必要なアカウント・サービス

| サービス | 用途 | 費用 |
|---------|------|------|
| LINE Developers | Messaging API チャネル | 無料 |
| Render.com | Node.jsサーバーホスティング | 無料 |
| Firebase | DB（既存プロジェクト共用） | 無料 |
| UptimeRobot | Renderのスリープ防止 | 無料 |
| Wikimedia Commons | ジオゲームの位置情報付き写真 | 無料 |
| OpenStreetMap Nominatim | ジオゲーム回答の地名→座標変換 | 無料（小規模利用） |

---

## 初回セットアップ手順

### 1. LINE Messaging API チャネル作成

1. [LINE Developers Console](https://developers.line.biz/console/) にログイン
2. プロバイダーを選択（または新規作成）
3. 「新規チャネル作成」→「Messaging API」を選択
4. チャネル名・説明を入力して作成
5. **チャネルシークレット**（Messaging API設定タブ）をコピーして保存
6. **チャンネルアクセストークン**（同タブ下部）を「発行」してコピーして保存

### 2. Render.com にデプロイ

1. [render.com](https://render.com) にログインし「New Web Service」を作成
2. GitHubリポジトリ `naotaxy/winning-roulette` を連携
3. 以下の設定にする：
   - Branch: `feature/linebot`（mainへマージ後は `main`）
   - Root Directory: `linebot`
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Plan: Free
4. 環境変数（Environment Variables）を以下の通り設定：

| キー | 値 |
|-----|---|
| `LINE_CHANNEL_SECRET` | チャネルシークレット |
| `LINE_CHANNEL_ACCESS_TOKEN` | チャンネルアクセストークン |
| `FIREBASE_SERVICE_ACCOUNT` | サービスアカウントJSON（後述） |
| `FIREBASE_DATABASE_URL` | `https://winning-roulette-c6de7-default-rtdb.asia-southeast1.firebasedatabase.app` |

5. 「Create Web Service」でデプロイ開始
6. デプロイ完了後、サービスURLをコピー（例: `https://winning-roulette.onrender.com`）

### 3. Firebase サービスアカウントの取得

1. [Firebase Console](https://console.firebase.google.com) でプロジェクトを開く
2. 「プロジェクトの設定」→「サービスアカウント」タブ
3. 「新しい秘密鍵を生成」→ JSONファイルをダウンロード
4. JSONファイルの中身を**1行にまとめて**Renderの `FIREBASE_SERVICE_ACCOUNT` に貼り付け

### 4. LINE Messaging API の Webhook 設定

1. LINE Developers Console → 該当チャネル → Messaging API設定
2. Webhook URL に `https://（RenderのURL）/webhook` を入力
3. 「検証」ボタンで成功することを確認
4. Webhook利用を「オン」にする

### 5. LINE Official Account Manager の設定

**重要**: デフォルトの自動応答をオフにしないとWebhookが動かない。

1. [manager.line.biz](https://manager.line.biz) にログイン
2. 「チャットの設定」または「応答設定」を開く
3. 以下のように設定：
   - 応答モード（チャット）: **オフ**
   - あいさつメッセージ: **オフ**
   - 応答メッセージ（自動応答）: **オフ**
   - Webhook: **オン**

### 6. Firebase の config/players を確認

Botがチーム名を認識するには、アプリの設定タブでプレイヤー情報が保存されている必要がある。

1. アプリ（https://naotaxy.github.io/winning-roulette/）を開く
2. 設定タブ（⚙️）でプレイヤー名・キャラ名が入力されているか確認
3. 「保存」ボタンを押してFirebaseに書き込む

### 7. UptimeRobot でスリープ防止

Renderの無料プランは15分アクセスがないとスリープする。

1. [uptimerobot.com](https://uptimerobot.com) に登録
2. 「Add New Monitor」→ HTTP(s) を選択
3. URL: `https://（RenderのURL）/cron/reminders?secret=任意の長い文字列`
4. Monitoring Interval: 5分
5. 「Create Monitor」で完了

上の `secret` と同じ値を Render の環境変数 `REMINDER_CRON_SECRET` に入れる。未設定でも `/cron/reminders` は動くが、外部から誰でも起床・リマインド掃除を叩ける状態になるので、無料運用でもsecret設定を推奨。

`/health` も従来どおり疎通確認と背景復帰を兼ねる。起床通知とイベントリマインダーを確実に拾いたい場合は、UptimeRobotの監視URLを `/cron/reminders` にしておく。

---

## 動作フロー詳細

### 画像受信時

```
1. LINEグループに画像投稿
2. Webhook受信 → Render(Node.js)へ転送
3. LINE Content APIから画像バイナリ取得
4. 端末スクリーンショットらしい画像だけOCR対象にする
5. 自動OCRがOFFなら screenshotCandidates/{sourceId}/{date}/{msgId} に控えて返信しない
6. 自動OCRがONなら Firebase config/players からプレイヤーマップ取得（5分キャッシュ）
7. Tesseract.js (jpn+eng) でOCR
   - スコア: BgDiff → Invert → DigitFallback の3段階
   - チーム名: ファジーマッチング（Levenshtein + bigram Jaccard、閾値0.45）
8. スコアと両チームが揃ったウイコレ結果だけ pendingOcr/{msgId} に一時保存（TTL: 1時間）
9. 確認FlexMessage を返信

ウイコレ結果ではなさそうな画像は、グループを邪魔しないように返信せず無視します。
試合結果らしいが一部だけ読めない画像は、登録せず再送を促します。
自動OCRがOFFの時は「@秘書トラペル子 集計して」で、その日に控えたスクリーンショット候補だけをまとめてOCRします。
```

### テキスト受信時

```
「@秘書トラペル子」:
  → 反応できる言葉一覧を可愛く返信

「@秘書トラペル子 ありがとう / 褒めて / 慰めて / 煽って / 叱って / おはよう / お疲れ / おやすみ / かわいい」など:
  → メンション付き雑談として、秘書兼ベタ惚れキャラで返信

「順位」「ランキング」「今何位」など:
  → 当月の順位表を返信

「年間順位」「今年のpt」など:
  → 年間順位Ptを返信

「状況」「秘書」「bot」「お話」など:
  → 現在の月次・年間状況を踏まえて秘書キャラで返信

「来月の縛り」「来月のルール」など:
  → monthlyRules と config/restrictMonths を見て、来月の縛りルールを返信

「レンダー」「ファイアベース」「ギットハブ」「システム」など:
  → Botから見える範囲で Render / Firebase / GitHub / 全体の稼働状況を返信

「課金」「無料枠」「料金」「コスト」など:
  → 無料枠からはみ出しそうな赤信号と、Botから見える状態を返信

「ジオゲーム」「場所当て」「ここどこ」など:
  → Wikimedia Commonsの位置情報付き写真から都内の問題を自動出題
  → 「回答 新宿駅」「回答 35.658,139.701」で回答を受付
  → 制限時間後にBotが自動で正解座標と一番近い人を発表
  → Google Maps APIは使わず、APIキーもカード登録も不要

AI自然会話:
  → `AI_CHAT_ENABLED=true` とプロバイダーAPIキーがある時だけ、メンション付き雑談を外部AIへ渡す。未設定時は無料テンプレ返答に戻る
  → 無料運用の推奨は `AI_PROVIDER=gemini` + `GEMINI_API_KEY`。Google AI Studio / Cloud Billing は有効化しない
  → `AI_COST_GUARD_ENABLED=true` なら、日次/月次回数・トークン上限・quota/billing系エラーでFirebaseに自動停止フラグを保存し、それ以降はAIを呼ばない

Gemma4本気作戦会議:
  → `作戦会議` / `Codex会議` / `度肝を抜いて` で、Gemma 4を使った自由会話型の10人会議を先頭に追加
  → 失敗、未設定、混雑、課金ガード上限時は固定ロジックの作戦会議へ自動フォールバック
```

### OK / キャンセル時

```
OK押下:
  → Firebase matchResults/{year}/{month} に登録
  → pendingOcr から削除
  → 「登録できたよ。ちゃんと残したからね。」を返信

キャンセル押下:
  → pendingOcr から削除
  → 「わかった、キャンセルにするね。」を返信
```

---

## 環境変数一覧

| 変数名 | 説明 |
|-------|------|
| `LINE_CHANNEL_SECRET` | Webhook署名検証に使用 |
| `LINE_CHANNEL_ACCESS_TOKEN` | メッセージ返信に使用 |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK 認証（JSON文字列） |
| `FIREBASE_DATABASE_URL` | Firebase Realtime Database のURL |
| `AI_CHAT_ENABLED` | 任意。`true` の時だけAI自然会話を有効化（課金リスクあり） |
| `AI_PROVIDER` | 任意。`gemini` 推奨。`openai` も指定可 |
| `GEMINI_API_KEY` | 任意。Gemini無料枠で使うGoogle AI Studio APIキー |
| `GEMINI_MODEL` | 任意。既定値は `gemini-2.5-flash-lite` |
| `GEMMA4_COUNCIL_ENABLED` | 任意。`true` でGemma4本気作戦会議を明示ON、`false` でOFF。未指定時は `AI_CHAT_ENABLED=true` かつ Gemini 利用時にON |
| `GEMMA4_COUNCIL_MODEL` | 任意。Gemma4作戦会議のモデル。既定値は `gemma-4-26b-a4b-it` |
| `GEMMA4_COUNCIL_THINKING` | 任意。`false` 以外ならGemma4のthinking level highを要求 |
| `GEMMA4_COUNCIL_MAX_OUTPUT_TOKENS` | 任意。Gemma4作戦会議の最大出力トークン。既定値は `900` |
| `GEMMA4_COUNCIL_TIMEOUT_MS` | 任意。Gemma4作戦会議のタイムアウト。既定値は `6500` |
| `BACKGROUND_START_DELAY_MS` | 任意。Render起動直後の背景worker開始待ち。既定値は `45000` |
| `WEBHOOK_RECOVERY_DELAY_MS` | 任意。LINE通常返信後に背景workerを復帰させる待ち時間。既定値は `2500` |
| `WEBHOOK_RECOVERY_COOLDOWN_MS` | 任意。Webhook起点の背景復帰の最短間隔。既定値は `60000` |
| `WAKE_ALARM_MAX_LATE_PUSH_MS` | 任意。起床通知を遅れて送ってよい最大時間。既定値は `600000` |
| `GITHUB_SCHEDULER_WORKFLOWS` | 任意。RenderからdispatchするワークフローCSV。既定値は `event-reminder.yml,wake-alarm.yml` |
| `REMINDER_CRON_SECRET` | 任意。`/cron/reminders` をUptimeRobotなど外部Pingから叩く時のsecret |
| `OPENAI_API_KEY` | 任意。OpenAIを使う時だけ設定（従量課金なので無料運用では非推奨） |
| `OPENAI_MODEL` | 任意。OpenAI利用時の既定値は `gpt-5-nano` |
| `AI_COST_GUARD_ENABLED` | 任意。既定値はON。`false` にしない限り、課金ガードでAIを自動停止 |
| `AI_CHAT_DAILY_LIMIT` | 任意。AI会話の日次上限。既定値は `10` 回 |
| `AI_CHAT_MONTHLY_LIMIT` | 任意。AI会話の月次上限。既定値は `50` 回 |
| `AI_CHAT_DAILY_TOKEN_LIMIT` | 任意。AI会話の日次トークン上限。既定値は `10000` |
| `AI_CHAT_MONTHLY_TOKEN_LIMIT` | 任意。AI会話の月次トークン上限。既定値は `50000` |
| `AI_CHAT_ESTIMATED_TOKENS_PER_REPLY` | 任意。呼び出し前に見積もる1返信分のトークン。既定値は `900` |
| `GEOGAME_ENABLED` | 任意。`false` でジオゲームを停止。既定値はON |
| `GEOGAME_DAILY_LIMIT` | 任意。ジオゲームの1日出題上限。既定値は `5` 回 |
| `GEOGAME_ANSWER_SECONDS` | 任意。ジオゲームの回答時間。既定値は `180` 秒 |
| `GEOGAME_AUTO_REVEAL` | 任意。`false` で制限時間後の自動発表を停止。既定値はON |
| `GEOGAME_RADIUS_METERS` | 任意。写真を探す半径。既定値は `1400` |
| `GEOGAME_IMAGE_WIDTH` | 任意。LINEへ送る写真サムネイル幅。既定値は `640` |
| `GEOGAME_USER_AGENT` | 任意。Nominatim/Wikimediaへ送る識別用User-Agent |
| `GEOGAME_REFERER` | 任意。Nominatimへ送るReferer。既定値はLIFF URL |
| `PORT` | サーバーポート（Renderが自動設定） |

ジオゲームはGoogle Maps APIを使わない無料版。写真はWikimedia Commonsの位置情報付き画像、回答の地名検索はOpenStreetMap Nominatimを使う。Nominatimの公共サーバーは小規模利用向けなので、`GEOGAME_DAILY_LIMIT` を大きくしすぎない。回答地名はFirebaseに30日キャッシュし、同じ検索を何度も投げない。

AI課金ガードは `config/aiChatGuard/autoDisabled` に停止理由を保存する。日次・月次のリクエスト上限やトークン上限で止まった場合は、日付または月が切り替わって枠が復活した時に自動で `disabled=false` に戻る。APIキー認証、請求、外部サービス側quotaなど課金リスク系エラーで止まった場合は安全のため自動復帰しないので、Firebaseで `disabled` を `false` に戻し、必要なら上限値を見直してからRenderを再デプロイする。

Gemini無料枠で自然会話を使う場合は、Renderに `AI_CHAT_ENABLED=true`、`AI_PROVIDER=gemini`、`GEMINI_API_KEY=...` を設定する。Google AI StudioでAPIキーを作る時にCloud Billingは有効化しない。BotからGoogle側の請求先状態までは直接読めないので、無料運用では管理画面の「Billing未設定」を必ず確認する。

Gemma4本気作戦会議は Gemini API 経由の Gemma 4（既定: `gemma-4-26b-a4b-it`）を呼ぶ。AI課金ガードは通常のAI自然会話と同じ `aiChatUsage` / `config/aiChatGuard/autoDisabled` を使うため、日次・月次上限やquota/billing系エラーでは自動停止し、固定ロジックの作戦会議へ戻る。

起床セットとイベントリマインダーは、Render常駐worker、GitHub Actionsの定期実行、Webhook後の復帰worker、UptimeRobot等からの `/cron/reminders` 外部Ping復帰の四段で拾う。Render無料枠のスリープ復帰直後に起床通知が通常返信より先に見えないよう、起動直後の背景workerを少し遅らせ、LINEの通常返信完了後に復帰処理を走らせる。RenderからのGitHub Actions dispatchは既定で `event-reminder.yml` と `wake-alarm.yml` を直接叩く。GitHub Actionsがアカウント側で無効化されていても、UptimeRobotの5分PingでRenderが起きれば `/cron/reminders` がローカルの起床・リマインド掃除を実行する。大きく遅れた起床通知は突然送らず missed として記録し、繰り返し設定なら次回予定へ進める。

---

## ファイル構成

```
linebot/
├── server.js              # Expressサーバー、Webhookルート
├── render.yaml            # Renderデプロイ設定
├── package.json
└── src/
    ├── webhook.js         # イベントハンドラ（画像・テキスト・Postback）
    ├── image-guard.js     # 非スクリーンショット・非ウイコレ画像の無視判定
    ├── standings.js       # 月次・年間順位集計とテキスト整形
    ├── rule-message.js    # 縛りルール返信文の整形
    ├── secretary-chat.js  # メンション付き雑談の返答バリエーション
    ├── ai-chat.js         # 任意のGemini/OpenAI自然会話
    ├── character-memory.js # 秘書トラペル子の固定プロフィール記憶
    ├── system-status.js   # Render / Firebase / GitHub / システム状況の返信
    ├── billing-risk.js    # 無料枠・課金リスクの返信
    ├── geo-game.js        # 無料データ版ジオゲーム
    ├── date-utils.js      # 日本時間の日付取得
    ├── ocr-node.js        # OCRロジック（ブラウザ版ocr.jsのNode.js移植）
    ├── firebase-admin.js  # Firebase Admin SDK（読み書き）
    └── flex-message.js    # LINE FlexMessage生成
```

---

## トラブルシューティング

### チーム名が未検出になる
→ アプリ設定タブでプレイヤー情報を保存したか確認（Firebase `config/players` が空の可能性）

### Webhookが届かない / 自動応答が返ってくる
→ LINE Official Account Manager で「チャット」をオフ、「Webhook」をオンに設定する

### Renderがスリープしてレスポンスが遅い
→ UptimeRobot の `/health` 監視を設定する

### 同じエラーでサーバーが再起動を繰り返す
→ LINEは返答がない場合にWebhookを再試行する。Renderのログを確認し、エラー原因を修正する

---

## ブランチ運用

- 開発中: `feature/linebot`
- 本番: `main`（テスト完了後にマージ予定）
