# ウイコレ ルール決めルーレット

ウイニングコレクションの月例対戦ルール、試合結果、順位表をLINEグループで共有するLIFF Webアプリです。敗者がルーレットを回して縛りルールを決め、結果はFirebase Realtime Databaseで参加者に同期されます。

## 現行機能

- 12択ルーレットを2回、6択ルーレットを1回まわして月のルールを決定
- SPIN POWERゲージで回転演出の周回数と時間を変化
- スピン結果を先にFirebaseへコミットする不正防止フロー
- 決定ルールをLINE Flex Messageまたはテキストコピーで共有
- 縛り月カレンダーで月別ルールを保存、編集、削除
- スクリーンショットOCRで試合結果を取り込み
- AWAY/HOMEが画像表示と合わない場合の自動左右反転と手動入れ替え
- PK戦、登録月、試合日を含めた対戦結果の保存
- 月次順位表と年間順位表を自動集計
- プレイヤー名、ゲーム内キャラ名、ルーレット項目の編集
- LINEプロフィール画像の表示と履歴への保存

## 画面構成

### ゲーム

ルーレット本体、SPIN POWERゲージ、抽選済みルール、最終結果を表示します。最終結果では保存対象月を選び、カレンダーに登録できます。

### カレンダー

1月から12月までの縛り状態と月別ルールを表示します。縛り月とフリー月の切り替え、ルールの手動編集、削除に対応しています。

### 集計

試合終了画面の画像をアップロードし、OCRでスコアとチーム名を読み取ります。登録後は月別の対戦結果、月次順位表、年間順位表に反映されます。

### 履歴

ルーレットの実行履歴を新しい順に表示します。LINEプロフィール画像が取得できる場合はアイコンとして表示します。

### 設定

プレイヤー名、ゲーム内キャラ名、12択リスト、6択リストを編集できます。設定はFirebaseに保存され、参加者間で共有されます。

## デザイン方針

アプリ内の装飾用Unicode絵文字は使わず、CSSで生成した8bit調のピクセルアイコンに置き換えています。外部素材のライセンスに依存しない自作表現なので、追加表記なしで利用できます。

## LINE LIFFセットアップ

1. [LINE Developers Console](https://developers.line.biz/console/) でプロバイダーを作成
2. LINEログインチャネルを作成
3. LIFFタブでLIFFアプリを追加
4. サイズは `Full`、スコープは `profile` を有効化
5. エンドポイントURLにGitHub PagesのURLを設定
6. 発行されたLIFF IDを [js/liff.js](/Users/naotay/soccer-roulette/js/liff.js) の `LIFF_ID` に設定

```js
const LIFF_ID = 'xxxxxxxxxx-xxxxxxxx';
```

## Firebase構成

Firebase Realtime Databaseを使います。主な保存対象は次の通りです。

- `config`: ルーレット項目、プレイヤー設定、縛り月
- `sessions`: 現在のスピン状態とスピナー
- `spinHistory`: ルーレット履歴
- `monthlyRules`: 月別ルール
- `results`: 試合結果
- `playerAvatars`: プレイヤー別プロフィール画像

## GitHub Pagesデプロイ

```bash
git push origin main
```

GitHubの `Settings > Pages` で `main` ブランチを公開対象にします。

公開URL:

```text
https://naotaxy.github.io/winning-roulette/
```

## ファイル構成

```text
/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── app.js
│   ├── firebase-config.js
│   ├── liff.js
│   ├── ocr.js
│   ├── roulette.js
│   └── sync.js
├── README.md
└── SPEC.md
```

## 開発メモ

- キャッシュ対策として `index.html` のCSS/JS読み込みにバージョン番号を付けています。
- 主要UIはスマホLIFF内での利用を前提に最大幅480pxで設計しています。
- OCRは必要時にTesseract.jsをCDNから読み込みます。
- LIFFが利用できない環境では、共有はクリップボードコピーにフォールバックします。
