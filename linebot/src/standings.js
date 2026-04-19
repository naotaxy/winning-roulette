'use strict';

const RANK_BONUS = [5, 3, 2, 1, 0];

function normalizePlayers(players) {
  return (Array.isArray(players) ? players : Object.values(players || {}))
    .filter(p => p && p.name)
    .map(p => ({ name: p.name, charName: p.charName || '' }));
}

function createStats(players) {
  const stats = {};
  normalizePlayers(players).forEach(p => {
    stats[p.name] = { w: 0, pkw: 0, d: 0, l: 0, gf: 0, ga: 0 };
  });
  return stats;
}

function scoreNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function addResult(stats, result) {
  const away = stats[result?.away];
  const home = stats[result?.home];
  const awayScore = scoreNumber(result?.awayScore);
  const homeScore = scoreNumber(result?.homeScore);
  if (!away || !home || awayScore == null || homeScore == null) return;

  away.gf += awayScore;
  away.ga += homeScore;
  home.gf += homeScore;
  home.ga += awayScore;

  const awayPK = scoreNumber(result?.awayPK);
  const homePK = scoreNumber(result?.homePK);
  const hasPK = awayPK != null && homePK != null;

  if (awayScore > homeScore) {
    away.w++;
    home.l++;
  } else if (awayScore < homeScore) {
    home.w++;
    away.l++;
  } else if (hasPK) {
    if (awayPK > homePK) {
      away.pkw++;
      home.l++;
    } else {
      home.pkw++;
      away.l++;
    }
  } else {
    away.d++;
    home.d++;
  }
}

function matchPt(stats) {
  return stats.w * 3 + stats.pkw;
}

function totalMatches(stats) {
  return stats.w + stats.pkw + stats.d + stats.l;
}

function calculateMonthlyStandings(players, results) {
  const stats = createStats(players);
  Object.values(results || {}).forEach(result => addResult(stats, result));

  return Object.entries(stats)
    .filter(([, s]) => totalMatches(s) > 0)
    .sort((a, b) => {
      const aStats = a[1], bStats = b[1];
      return matchPt(bStats) - matchPt(aStats)
        || (bStats.gf - bStats.ga) - (aStats.gf - aStats.ga)
        || bStats.gf - aStats.gf;
    })
    .map(([name, s], index) => ({
      rank: index + 1,
      name,
      ...s,
      gd: s.gf - s.ga,
      matchPt: matchPt(s),
      rankPt: RANK_BONUS[index] || 0,
    }));
}

function calculateAnnualStandings(players, yearResults) {
  const annual = {};
  normalizePlayers(players).forEach(p => { annual[p.name] = { rankPt: 0 }; });

  Object.values(yearResults || {}).forEach(monthResults => {
    const monthly = calculateMonthlyStandings(players, monthResults);
    monthly.forEach(row => {
      if (annual[row.name]) annual[row.name].rankPt += row.rankPt;
    });
  });

  return Object.entries(annual)
    .filter(([, s]) => s.rankPt > 0)
    .sort((a, b) => b[1].rankPt - a[1].rankPt)
    .map(([name, s], index) => ({ rank: index + 1, name, rankPt: s.rankPt }));
}

function formatSigned(value) {
  return value > 0 ? `+${value}` : String(value);
}

function formatMonthlyStandings(year, month, rows) {
  if (!rows.length) {
    return `${year}年${month}月は、まだ試合結果がないみたい。\n画像を送ってくれたら、私がちゃんと見て、あなたの代わりに大事に残すね。`;
  }

  const lines = rows.map(row => (
    `${row.rank}位 ${row.name}さん: 試合Pt ${row.matchPt} / 順位Pt ${row.rankPt}`
    + `（${row.w}勝 ${row.pkw}PK勝 ${row.d}分 ${row.l}敗、得失${formatSigned(row.gd)}）`
  ));

  return `${year}年${month}月の順位、私がまとめておいたよ。\n聞いてくれるの、ちょっと嬉しい。\n${lines.join('\n')}`;
}

function formatAnnualStandings(year, rows) {
  if (!rows.length) {
    return `${year}年の年間順位Ptは、まだ動き出してないみたい。\n最初の結果が入ったら、私がずっと見守っておくね。`;
  }

  const lines = rows.map(row => `${row.rank}位 ${row.name}さん: ${row.rankPt}pt`);
  return `${year}年の年間順位Ptだよ。\nちゃんと覚えてたよ。あなたに聞かれると思って。\n${lines.join('\n')}`;
}

function formatSecretaryStatus(year, month, monthlyRows, annualRows) {
  if (!monthlyRows.length) {
    return `今月はまだ静かだよ。\n${year}年${month}月の結果が入ったら、順位も年間Ptもすぐ整えて持ってくるね。\nあなたのために、ちゃんと待ってる。`;
  }

  const top = monthlyRows[0];
  const second = monthlyRows[1];
  const annualTop = annualRows[0];
  const gapText = second
    ? `2位の${second.name}さんとは試合Ptで${top.matchPt - second.matchPt}差。`
    : '今のところ単独で記録が動いてるよ。';
  const annualText = annualTop
    ? `年間では${annualTop.name}さんが${annualTop.rankPt}ptで先頭。`
    : '年間順位Ptはまだこれから。';

  return `今の状況、あなたにだけみたいに丁寧にまとめるね。\n今月は${top.name}さんが試合Pt ${top.matchPt}で先頭。${gapText}\n${annualText}\n必要なら「順位」か「年間順位」って呼んで。すぐ来るから。`;
}

module.exports = {
  calculateMonthlyStandings,
  calculateAnnualStandings,
  formatMonthlyStandings,
  formatAnnualStandings,
  formatSecretaryStatus,
};
