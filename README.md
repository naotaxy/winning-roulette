# ⚽ ウイコレ ルール決めルーレット

ウイニングコレクションの対戦ルールをLINEグループで公平に決定するLIFF Webアプリ。

## 機能

- **半円ルーレット** — 上半分のみ表示するゲームUI風ホイール
- **ハラハラ演出** — 行きすぎ→引き戻し→定着のサスペンス回転
- **第1回** 12択から2個選出 / **第2回** 6択から1個選出
- **LINE連携** — プロフィール自動取得・FlexMessageでシェア
- **履歴** — 誰がいつ何を引いたか記録
- **設定** — 12択・6択の項目を自由編集

## LINE LIFF セットアップ

1. [LINE Developers Console](https://developers.line.biz/console/) でプロバイダー作成
2. **LINEログインチャネル** を作成
3. 「LIFF」タブ → 「追加」
   - サイズ: `Full`
   - スコープ: `profile` にチェック
   - エンドポイントURL: `https://naotaxy.github.io/winning-roulette/`
4. 発行された LIFF ID を `js/liff.js` の `LIFF_ID` 定数に設定

```js
// js/liff.js
const LIFF_ID = 'xxxxxxxxxx-xxxxxxxx'; // ← ここに設定
```

## GitHub Pages デプロイ

```bash
git push origin main
# Settings → Pages → Source: main branch → Save
# URL: https://naotaxy.github.io/winning-roulette/
```

## ファイル構成

```
/
├── index.html        # メインアプリ (LIFF エントリーポイント)
├── css/style.css     # プレミアムゲームUI デザインシステム
├── js/
│   ├── roulette.js   # 半円ルーレットエンジン (Canvas)
│   ├── liff.js       # LINE LIFF ラッパー
│   └── app.js        # メインアプリロジック
└── README.md
```

## 開発メモ

- LIFF ID未設定時はブラウザモードで動作（名前手動入力・テキストコピー）
- `liff.shareTargetPicker()` でLINEグループへのFlexMessageシェア
- Canvas HiDPI対応 (devicePixelRatio)
- localStorage でアイテム設定・履歴を永続化
