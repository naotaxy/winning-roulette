# CLAUDE.md — soccer-roulette プロジェクトルール

## 絶対ルール

**読んでいないファイルは変更しない。**
編集前に必ず Read ツールでファイルの内容を確認すること。
未確認のまま Edit / Write / sed などで変更することは禁止。

Write ツールは「前回 Read してから変更された」とエラーを出すことがある。
その場合は再度 Read してから Write する。

## キャッシュバスト

JS・CSS を変更したときは `index.html` の `?v=XX` を手動でインクリメントする。
`sed` は使わず、Edit ツールで直接書き換えること（sed は index.html を破壊した実績あり）。

## デプロイ

```
git add <変更ファイル>
git commit -m "..."
git push
```

GitHub Pages (naotaxy/winning-roulette) に自動デプロイされる。

---

## ブランチ管理

| ブランチ | 役割 |
|---|---|
| `main` | 日記生成・OCR・ルーレット本体 |
| `feature/linebot` | LINE Bot サーバー・リマインダー・起床通知 |
| `feature/noblesse-phase1` | ノブレスエージェント |

**セッションをまたぐ前に、作業中ブランチを必ず push すること。**
未 push のまま終わると次回のコンテキストで変更が見えず、二重作業や上書きが起きる。

セッション終了前チェック:
```bash
git status          # 未コミットの変更がないか
git log origin/HEAD..HEAD --oneline  # 未 push のコミットがないか
```

---

## GitHub Actions ルール

### 安定バージョン（固定）

```yaml
uses: actions/checkout@v4      # ← v5/v6 は存在しない。必ず @v4
uses: actions/setup-node@v4    # ← 同上
node-version: '20'             # ← Node 24 は不安定。20 LTS 固定
```

バージョンを変更するときは GitHub 公式リリースページで存在確認してから変更する。
存在しないバージョンにすると全スケジュール実行が即死する（実績: @v6 で日記が4日間止まった）。

### ワークフロー設計の禁止事項

```yaml
# NG: cancel-in-progress はスケジュール実行をキャンセルしてしまう
concurrency:
  group: diary
  cancel-in-progress: true

# NG: schedule の if 条件は評価タイミングで意図せずスキップされる
jobs:
  my-job:
    if: github.event_name == 'schedule' && github.event.schedule == '0 22 * * *'
```

### ワークフロー設計の必須事項

Git コミットステップには必ず `if: always()` を付ける。
日記生成が部分失敗しても、生成済みの blog/ をコミットできるようにするため。

```yaml
- name: Commit blog archive
  if: always()    # ← 必須
  run: |
    git config user.email "traperuko@winning-roulette.local"
    git config user.name "秘書トラペル子"
    git add blog/
    git diff --cached --quiet && echo "no changes" || git commit -m "..."
    git push
```

---

## 大ファイル操作

5000 行超のファイル（例: `2026-04-26-noblesse-collab-log.md`）は
Read ツールに `offset` / `limit` を指定して分割して読む。
一括 Read はトークン上限でエラーになる。

```
# 末尾 200 行を読む例
Read(file_path="...", offset=5300, limit=200)
```

---

## ノブレスエージェント構成（linebot/src/）

| ファイル | 役割 |
|---|---|
| `noblesse-agent.js` | Gemini でA/B/C案生成・バリデーション |
| `noblesse-case.js` | 案件 CRUD・イベントログ・承認フロー |
| `noblesse-drafts.js` | 承認後のメール文面・日程調整下書き生成 |
| `noblesse-curated.js` | おでかけ/買い物秘書（curated plan） |
| `firebase-admin.js` | Firebase CRUD（案件・イベントログ） |
| `webhook.js` | LINE Bot ハンドラ（intent 振り分け） |
| `system-status.js` | システム状態返信（安全ラッパー付き） |

`node --check <ファイル>` で構文確認してからコミットする。

---

## 日記スクリプト（scripts/generate-diary.js）

- Gemini モデル: `DIARY_GEMINI_MODEL` 環境変数（GitHub Actions vars）
- フォールバック: `DIARY_GEMINI_FALLBACK_MODELS`（カンマ区切り）
- 状態ファイル: `blog/diary-state.json`（seenRecipeTitles 等）
- ブログアーカイブ: `blog/YYYY-MM-DD.md`

コンテンツ方針:
- 音楽・アーティスト名は書かない
- JMOOC / AI 収益化系の話題は書かない
- 旬の献立（月別5レシピ × 12ヶ月）を日記に自然に組み込む
