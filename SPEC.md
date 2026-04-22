# ウイコレ ルール決めルーレット — 仕様書

最終更新: 2026-04-18

---

## 概要

ウイニングコレクション（ウイコレ）の5人対戦において、毎月の縛りルールをルーレットで公平に決定するLINE LIFFアプリ。

---

## プレイヤー情報

プレイヤー名・LINEアカウント・ゲームキャラクター名はアプリの設定タブで管理します。
ソースコードへの記載はありません。

---

## ゲームルール

### 縛りルール月
- **縛りあり**: 5・6・8・9・11月
- **縛りなし**: 7・12月（他の月も変更可能性あり）

### ルーレット仕様
- 敗者がルーレットを**2回**まわす
- 結果（2候補）のどちらかを選択して当月ルールを確定
- 毎月実施

### フェーズ構成
1. **第1回** (12択 × 2回スピン) — 12種類のルールから2つ抽選
2. **第2回** (6択 × 1回スピン) — 6種類の特殊ルールから1つ抽選
3. **結果確定** — LINEグループへシェア

---

## 12択ルール一覧（デフォルト）

| # | ルール名 | 内容 |
|---|---------|------|
| 1 | スピード | チーム全体のスピード属性重視 |
| 2 | スタミナ | スタミナ属性が高い選手中心 |
| 3 | パワー | パワー属性優先 |
| 4 | テクニック | 技術属性でドリブル・パス精度重視 |
| 5 | バランス | 全属性バランスよい選手のみ |
| 6 | レジェンド禁止 | レジェンドレア選手の使用禁止 |
| 7 | ナショナル限定 | 1カ国の代表チームの選手のみ |
| 8 | レギュラー限定 | レギュラーレアリティのみ |
| 9 | キラ禁止 | キラカードの使用禁止 |
| 10 | 星5禁止 | ★5評価カードの使用禁止 |
| 11 | カスタム禁止 | カスタマイズ強化カード全面禁止 |
| 12 | セレクトカスタム禁止 | プレミアム選択カスタム禁止 |

## 6択ルール一覧（デフォルト）

| # | ルール名 |
|---|---------|
| 1 | 後半得点2倍 |
| 2 | 黄カード即負 |
| 3 | 赤カード即負 |
| 4 | 黄カードx2得点マイナス |
| 5 | 先制点勝ち |
| 6 | 選手交代負け |

---

## システム構成

### フロントエンド
- 純粋なHTML/CSS/JavaScript（バンドラー不使用）
- GitHub Pages でホスティング
- LINE LIFF でLINEアプリ内対応

### バックエンド（Firebase Realtime Database）
- リアルタイム全員共有
- セッションベースのゲーム状態管理
- 月次ルール・試合結果の永続化

### Firebase データ構造

```
/sessions/{sessionId}
  phase: 1|2|3
  spinning: boolean
  round1: number[]
  round2: number|null
  spinnerName: string
  createdAt: timestamp

/config
  items12: string[12]
  items6: string[6]
  players: Player[]

/monthlyRules/{year}/{month}
  rule: string
  decidedBy: string
  decidedAt: timestamp

/matchResults/{year}/{month}/{id}
  date: string (YYYY-MM-DD)
  away: string
  home: string
  awayScore: number
  homeScore: number
  addedBy: string
  addedAt: timestamp
```

---

## 機能一覧

### ゲームタブ（⚽）
- **タイミングゲージ**: 0〜100%で動くパワーバー。押したタイミングでスピン強さが決まる
- **物理ベース減速**: 指数減衰（v = v₀·e^{-kt}）+ スプリング整定（ダンプ振動）
- **全円ルーレット**: 12分割または6分割の全円ホイール
- **不正防止**: スピン結果をFirebaseに先行コミット（確定後に変更不可）
- **観戦モード**: URLパラメータ`?session=ID`で参加した全員がリアルタイムで閲覧

### カレンダータブ（📅）
- 月別の縛り状況を一覧表示
- 確定したルールをリアルタイムで表示

### 集計タブ（📊）
- 試合結果スクリーンショットのOCR取り込み（Tesseract.js）
- チーム名の自動認識・マッピング
- 月次対戦結果一覧
- 勝点制順位表（勝3・分1・負0）

### 履歴タブ（📜）
- スピン結果の履歴（最大100件）

### 設定タブ（⚙️）
- プレイヤー名・ゲームキャラクター名の編集
- 12択・6択リストの自由編集
- 全設定はFirebaseでリアルタイム共有

---

## 不正防止措置

1. **結果先行コミット**: SPINボタン押下時に結果をFirebaseに書き込んだ後にアニメーション開始（変更不能）
2. **セッションロック**: スピン中は`spinning: true`フラグで再スピン不可
3. **LINEアカウント名ロック**: LIFF経由で取得した名前は編集不可（readOnly）
4. **観戦者ボタン無効化**: `?session=ID`参加者のSPINボタンは非活性

---

## LINE LIFF 設定

- **LIFF ID**: （js/liff.js の LIFF_ID 変数に設定）
- **エンドポイント**: （GitHub Pages URL）
- **サイズ**: Full
- **スコープ**: profile

---

## Firebase セットアップ手順

1. https://console.firebase.google.com でプロジェクト作成
2. Authentication の Sign-in method で Anonymous を有効化
3. Realtime Database を作成し、`database.rules.json` をセキュリティルールに反映
4. `js/firebase-config.js` に設定値を記入
5. GitHubにプッシュ

---

## ファイル構成

```
/
├── index.html              # メインHTML（5タブ構成）
├── database.rules.json     # Realtime Database セキュリティルール
├── firebase.json           # Firebase CLI 用設定
├── css/style.css           # デザインシステム
├── js/
│   ├── firebase-config.js  # Firebase設定（要記入）
│   ├── sync.js             # Firebase/LocalStorageリアルタイム同期
│   ├── ocr.js              # OCR（Tesseract.js）
│   ├── roulette.js         # ルーレットエンジン + タイミングゲージ
│   ├── liff.js             # LINE LIFF ラッパー
│   └── app.js              # メインアプリロジック
├── SPEC.md                 # 本仕様書
└── README.md               # セットアップガイド
```

---

## 今後の課題・予定

- [ ] Firebase セキュリティルールの本番設定
- [ ] OCR精度向上（画像前処理の改善）
- [ ] プッシュ通知（月初ルール決め通知）
- [ ] 過去月のアーカイブ閲覧
- [ ] LINE Messaging API でbot通知
