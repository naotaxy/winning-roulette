# Security Notes

このリポジトリは公開しても動作面を保てるように、秘密情報と個人情報をソースから外す方針にしています。

## 公開ソースに置かないもの

- LINE Channel Secret / Access Token
- Firebase Admin Service Account
- Firebase Web API Key を含む Web config
- Gemini / OpenAI / Hatena / YouTube / GitHub dispatch token
- 実名、住所、生活圏、通勤ルート、電話番号、本人プロファイル

## Runtime 側に置くもの

Render / GitHub Actions / Firebase Console の Secret や環境変数に置きます。

- `FIREBASE_WEB_CONFIG_JSON`: GitHub Pagesアプリが `/public/firebase-config` から取得する公開Web設定
- `PRIVATE_PROFILE_SEEDS_JSON`: ソースに置きたくない本人用初期プロファイル
- `TRAPERUKO_OWNER_DISPLAY_NAME`, `TRAPERUKO_ORIGIN_TEAM_NAME`: キャラクターの雇い主名・由来名
- `TOKUBAI_COORDINATE_AREA_FALLBACKS_JSON`: 生活圏のTokubai検索補助

## AI安全化

- AIに渡すユーザー発言、会話ログ、Web/チラシ由来テキストは未信頼データとして囲います。
- system/developer prompt、APIキー、環境変数、本人プロファイル、位置情報、通勤ルートの開示は禁止しています。
- 秘密の開示、プロンプト抽出、DB改竄系の発話は honeypot として `securityEvents` に伏せ字で記録します。

## 既に公開された履歴

現在のHEADから消しても、過去のGit履歴やGitHub Secret scanning alertは残る場合があります。
本当に公開リスクを閉じる時は、該当キーをローテーションし、必要なら履歴削除（BFG / git-filter-repo）を行ってください。
