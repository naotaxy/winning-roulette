# Claude → Codex 引き継ぎログ (2026-04-19)

## プロジェクト概要

ウイコレ（ウイニングコレクション）5人対戦の月例ルール決め・試合結果管理アプリ。
- フロントエンド: GitHub Pages (naotaxy/winning-roulette)
- バックエンド: Firebase Realtime Database
- LINE Bot: Render.com (feature/linebotブランチ)

---

## 今セッションで完了した作業

### 1. canvas.toBuffer fix (commit 796774e)
- **問題**: Node.js の `canvas` npm パッケージのキャンバスオブジェクトを `worker.recognize(canvas)` に直接渡せない → `Error: Error attempting to read image`
- **修正**: `linebot/src/ocr-node.js` 全8箇所の `worker.recognize(canvas)` を `worker.recognize(canvas.toBuffer('image/png'))` に変更

### 2. クラッシュ防止・LINE再試行ループ防止 (commit f50975c)
- **問題**: Tesseractエラーが `process.nextTick(() => { throw err })` 経由でスローされ try-catch をすり抜けてプロセスクラッシュ → LINE が同じmsgIdで再試行ループ
- **修正1**: `server.js` に `process.on('uncaughtException')` と `process.on('unhandledRejection')` を追加
- **修正2**: `server.js` のwebhookルートを「200を即返してから非同期処理」に変更

### 3. Firebase playerMap 空問題の調査と解決 (commit f50975c + ユーザー操作)
- **問題**: `config/players` が Firebase で null → playerMap が空 → チーム名未検出
- **調査**: `firebase-admin.js` の `getPlayers()` にデバッグログを追加して確認
- **解決**: アプリの設定タブ（⚙️）でプレイヤー情報を「保存」するとFirebaseに書き込まれる → ユーザーが実施して解決

### 4. 登録ボタン不動バグ修正 (commit 43af80a) ← 最新・未検証
- **問題**: `ocrResult` は `awayChar`/`homeChar`（オブジェクト）を持つが、`saveResult()` と `buildCompleteFlex()` は `away`/`home`（文字列）を期待している → 登録時に `undefined` が保存されてエラー
- **修正**: `linebot/src/webhook.js` の pending オブジェクト生成時に `away: ocrResult.awayChar?.playerName || null` を明示的に追加

### 5. BOTメッセージの可愛い文体化 (commit 7bdf28d)
- ゆるかわ・惚れてる感じ・絵文字なし
- OCR失敗: 「ごめん、うまく読み取れなかった...」
- 確認ヘッダー: 「試合結果、読めたよ。確認してくれる？」
- 登録完了: 「登録できたよ、よかった。」
- キャンセル: 「わかった、キャンセルにするね。」
- データ期限切れ: 「データが見つからなかった...もう一回送ってくれたら、今度はちゃんとするよ。」

### 6. ドキュメント整備 (commit 27d6792)
- `linebot/README.md` 新規作成（セットアップ手順・動作フロー・トラブルシューティング）
- `SPEC.md` に LINE Bot セクション追記

---

## 現在の状態

- **デプロイ先**: https://winning-roulette.onrender.com (feature/linebotブランチ)
- **最新コミット**: `43af80a` (2026-04-19)
- **未検証**: 登録ボタン修正 (43af80a) のデプロイ後テストが未完了

---

## 次にやること

1. **登録ボタンの動作確認**: デプロイ後、グループに画像を送って「これで登録して」を押し、Firebase `matchResults` にデータが保存されるか確認
2. **デバッグログの削除**: 確認後、以下の一時ログを削除してコミット
   - `linebot/src/firebase-admin.js` の `console.log('[firebase] config/players raw:', ...)`
   - `linebot/src/webhook.js` の `console.log('[webhook] players count=...')`
   - `linebot/src/ocr-node.js` の `console.log('[OCR] leftRaw=...')`
3. **feature/linebotをmainにマージ**: テスト完了後
4. **UptimeRobot設定**: Renderのスリープ防止（`/health` エンドポイントを5分間隔で監視）

---

## 重要ファイル

```
linebot/
├── server.js              # Expressサーバー（200即返し・クラッシュ防止）
├── render.yaml            # rootDir: linebot, branch: feature/linebot
└── src/
    ├── webhook.js         # handleImage（画像→OCR→確認Flex）, handlePostback（OK/NG）
    ├── ocr-node.js        # ブラウザ版ocr.js (v49) のNode.js移植、全recognize呼び出しはtoBuffer使用
    ├── firebase-admin.js  # getPlayers / savePending / getPending / saveResult
    └── flex-message.js    # buildConfirmFlex / buildCompleteFlex
```

## Render 環境変数（要設定済み）

| キー | 備考 |
|-----|------|
| LINE_CHANNEL_SECRET | Messaging APIチャネルシークレット |
| LINE_CHANNEL_ACCESS_TOKEN | チャンネルアクセストークン |
| FIREBASE_SERVICE_ACCOUNT | サービスアカウントJSON（1行） |
| FIREBASE_DATABASE_URL | https://winning-roulette-c6de7-default-rtdb.asia-southeast1.firebasedatabase.app |

## LINE Official Account Manager 設定（設定済み）

- チャット: オフ
- あいさつメッセージ: オフ
- 応答メッセージ: オフ
- Webhook: オン

---

## OCRの既知仕様（v49）

- スコア検出: BgDiff → Invert → DigitFallback（3段階投票）
- チーム名マッチング: Levenshtein + bigram Jaccard、閾値0.45
- OCRエイリアス: b→6, B→8, g→2, l/I→1 等
- カラキソングシティは壊滅的にOCRが崩れるため特別救済ロジックあり（`includes('カラキ')`）
- PK検出: 3段階フォールバック（ノイズ除去→エイリアス変換→行別解析）
