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
3. URL: `https://（RenderのURL）/health`
4. Monitoring Interval: 5分
5. 「Create Monitor」で完了

---

## 動作フロー詳細

### 画像受信時

```
1. LINEグループに画像投稿
2. Webhook受信 → Render(Node.js)へ転送
3. LINE Content APIから画像バイナリ取得
4. 端末スクリーンショットらしい画像だけOCR対象にする
5. Firebase config/players からプレイヤーマップ取得（5分キャッシュ）
6. Tesseract.js (jpn+eng) でOCR
   - スコア: BgDiff → Invert → DigitFallback の3段階
   - チーム名: ファジーマッチング（Levenshtein + bigram Jaccard、閾値0.45）
7. スコアと両チームが揃ったウイコレ結果だけ pendingOcr/{msgId} に一時保存（TTL: 1時間）
8. 確認FlexMessage を返信

ウイコレ結果ではなさそうな画像は、グループを邪魔しないように返信せず無視します。
試合結果らしいが一部だけ読めない画像は、登録せず再送を促します。
```

### テキスト受信時

```
「順位」「ランキング」「今何位」など:
  → 当月の順位表を返信

「年間順位」「今年のpt」など:
  → 年間順位Ptを返信

「状況」「秘書」「bot」「お話」など:
  → 現在の月次・年間状況を踏まえて秘書キャラで返信

「来月の縛り」「来月のルール」など:
  → monthlyRules と config/restrictMonths を見て、来月の縛りルールを返信
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
| `PORT` | サーバーポート（Renderが自動設定） |

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
