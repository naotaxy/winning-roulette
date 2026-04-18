# CLAUDE.md — soccer-roulette プロジェクトルール

## 絶対ルール

**読んでいないファイルは変更しない。**
編集前に必ず Read ツールでファイルの内容を確認すること。
未確認のまま Edit / Write / sed などで変更することは禁止。

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
