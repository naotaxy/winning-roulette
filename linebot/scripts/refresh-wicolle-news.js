'use strict';

require('dotenv').config();

const { getUicolleNews, saveUicolleNews } = require('../src/firebase-admin');
const { getTokyoDateParts } = require('../src/date-utils');
const {
  fetchWicolleOfficialNews,
  buildWicolleNewsSnapshot,
  parseDetailIdxSeeds,
} = require('../src/wicolle-official-news');

main().catch(err => {
  console.error('[wicolle-refresh] fatal', err?.message || err);
  process.exit(1);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const idxSeeds = parseDetailIdxSeeds(args.idx || args.idxs || '');
  const result = await fetchWicolleOfficialNews({
    detailIdxs: idxSeeds,
    maxItems: Number(args.limit || 12),
    timeoutMs: Number(args.timeout || 8000),
  });
  const existing = args.dryRun ? null : await getUicolleNews().catch(() => null);
  const snapshot = buildWicolleNewsSnapshot(result, {
    date: getTokyoDateParts().date,
    existing,
  });

  if (!snapshot.items.length) {
    console.log(JSON.stringify({
      ok: false,
      saved: false,
      note: snapshot.note || result.note || 'no items',
      items: 0,
      idxSeeds,
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  if (!args.dryRun) {
    await saveUicolleNews(snapshot);
  }

  console.log(JSON.stringify({
    ok: true,
    dryRun: !!args.dryRun,
    saved: !args.dryRun,
    updatedAt: snapshot.updatedAt,
    source: snapshot.source,
    items: snapshot.items.length,
    eventLength: snapshot.event.length,
    gachaLength: snapshot.gacha.length,
    idxSeeds,
    titles: snapshot.items.slice(0, 12).map(item => ({
      idx: item.idx,
      date: item.date,
      category: item.category,
      title: item.title,
      keywords: item.keywords || [],
    })),
  }, null, 2));
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (arg === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}
