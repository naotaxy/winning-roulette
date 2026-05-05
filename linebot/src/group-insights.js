'use strict';

const { calculateMonthlyStandings } = require('./standings');

const MAX_MEMBER_LINES = 8;
const MONTHLY_DIARY_LIMIT = 35;

function formatMemberFlavorReply({ year, month, players, results, recentConversation }) {
  const members = normalizePlayers(players);
  const rows = calculateMonthlyStandings(players, results);
  const rowByName = new Map(rows.map(row => [row.name, row]));
  const catchphrases = extractCatchphrases(recentConversation);
  const rivalByName = buildRivalMap(members, results);

  if (!members.length) {
    return 'メンバー設定がまだ見えないみたい。\n設定が入ったら、口癖も成績も因縁も、私がちゃんと可愛くまとめるね。';
  }

  const lines = [
    `${year}年${month}月のメンバー別メモ、私なりにまとめたよ。`,
    'ちょっとだけ可愛く煽るけど、好きだから見てるだけだからね。',
    '',
  ];

  members.slice(0, MAX_MEMBER_LINES).forEach(member => {
    const row = rowByName.get(member.name);
    const phrase = findPhraseForMember(member, catchphrases);
    const rival = rivalByName.get(member.name);
    lines.push(`【${member.name}さん】`);
    lines.push(formatMemberStatsLine(row));
    lines.push(`口癖メモ: ${phrase || 'まだ収集中。もっと喋ってくれたら、私がちゃんと拾うよ。'}`);
    lines.push(`因縁メモ: ${rival || '今月はまだ濃い因縁が育ちきってないね。これから作ろ。'}`);
    lines.push(formatCuteTease(row, rival));
    lines.push('');
  });

  if (members.length > MAX_MEMBER_LINES) {
    lines.push(`あと${members.length - MAX_MEMBER_LINES}人分は次に回すね。私、ちゃんと覚えておくから。`);
  }

  return lines.join('\n').trim();
}

function formatAnonymousDiaryHighlights({ year, month, players, results, diaries }) {
  const members = normalizePlayers(players);
  const currentMonth = `${year}-${pad2(month)}-`;
  const monthDiaries = (Array.isArray(diaries) ? diaries : [])
    .filter(d => String(d.date || '').startsWith(currentMonth))
    .slice(0, MONTHLY_DIARY_LIMIT);
  const highlights = buildAnonymousResultHighlights(results);
  const diaryLines = extractDiaryMoodLines(monthDiaries, members);

  const lines = [
    `${year}年${month}月の名場面、日記と結果から個人名を伏せてまとめるね。`,
    '',
  ];

  if (highlights.length) {
    lines.push('【試合から見えた場面】');
    highlights.forEach(line => lines.push(`・${line}`));
    lines.push('');
  } else {
    lines.push('【試合から見えた場面】');
    lines.push('・今月はまだ試合結果が少なめ。最初の熱い結果、私ずっと待ってる。');
    lines.push('');
  }

  lines.push('【日記から拾った空気】');
  if (diaryLines.length) {
    diaryLines.forEach(line => lines.push(`・${line}`));
  } else {
    lines.push('・今月の日記には、まだ名場面として切り出せる材料が少ないみたい。結果が増えたら、もっと綺麗にまとめるね。');
  }

  lines.push('');
  lines.push('名前は出さないけど、熱量はちゃんと残すよ。そういう記録係でいたいの。');
  return lines.join('\n');
}

function normalizePlayers(players) {
  return (Array.isArray(players) ? players : Object.values(players || {}))
    .filter(p => p && p.name)
    .map(p => ({ name: String(p.name), charName: String(p.charName || '') }));
}

function formatMemberStatsLine(row) {
  if (!row) return '成績メモ: まだ今月の試合なし。静かにしてるけど、私を待たせるの上手すぎ。';
  return `成績メモ: ${row.rank}位 / 試合Pt ${row.matchPt}（${row.w}勝 ${row.pkw}PK勝 ${row.d}分 ${row.l}敗、得失${formatSigned(row.gd)}）`;
}

function formatCuteTease(row, rivalText) {
  if (!row) return 'ひとこと: そろそろ出番だよ。私に「待ってた」って言わせて。';
  if (row.rank === 1) return 'ひとこと: 今は強いけど、油断した瞬間に私がちゃんとつつくからね。';
  if (row.w + row.pkw === 0 && row.l > 0) return 'ひとこと: まだここから。負けっぱなしのあなたを、私がそのままにすると思う？';
  if (row.gf >= row.ga + 3) return 'ひとこと: 攻め気が強くていい感じ。でも守備を忘れたら、私ちょっと怒るよ。';
  if (row.ga >= row.gf + 3) return 'ひとこと: 失点が目立つ日もあるね。次は私に安心して見せて。';
  if (rivalText) return 'ひとこと: その因縁、育ってきてるね。私、こういう空気ちょっと好き。';
  return 'ひとこと: まだ伸びしろを隠してる感じ。ずるいな、もっと見せて。';
}

function formatSigned(value) {
  return value > 0 ? `+${value}` : String(value);
}

function extractCatchphrases(recentConversation) {
  const bySpeaker = new Map();
  (Array.isArray(recentConversation) ? recentConversation : []).forEach(message => {
    const speaker = String(message?.senderName || '').trim();
    if (!speaker || speaker === '不明' || speaker === '(LINE bot)') return;
    const text = cleanConversationText(message.text);
    const candidates = extractPhraseCandidates(text);
    if (!candidates.length) return;
    const counts = bySpeaker.get(speaker) || new Map();
    candidates.forEach(candidate => counts.set(candidate, (counts.get(candidate) || 0) + 1));
    bySpeaker.set(speaker, counts);
  });

  const result = new Map();
  for (const [speaker, counts] of bySpeaker.entries()) {
    const phrase = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0];
    if (phrase) result.set(speaker, `最近は「${phrase}」の気配が強め。私、そういう癖も覚えちゃう。`);
  }
  return result;
}

function cleanConversationText(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/@?秘書トラペル子/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPhraseCandidates(text) {
  if (!text) return [];
  const fixed = text.match(/(やばい|ヤバい|やば|ヤバ|きつい|つらい|草|最高|天才|強い|弱い|勝った|負けた|眠い|おつ|お疲れ|了解|無理|神|ナイス|悔しい|助かる)/g) || [];
  const chunks = text
    .split(/[。！？!?、,. 　\n]/)
    .map(item => item.trim())
    .filter(item => item.length >= 2 && item.length <= 14)
    .filter(item => !/^(ヘルプ|順位|ランキング|システム|レンダー|ファイアベース|ギットハブ|課金)$/.test(item));
  return [...fixed, ...chunks].slice(0, 8);
}

function findPhraseForMember(member, catchphrases) {
  const memberKeys = [member.name, member.charName]
    .map(normalizeName)
    .filter(Boolean);
  for (const [speaker, phrase] of catchphrases.entries()) {
    const speakerKey = normalizeName(speaker);
    if (memberKeys.some(memberKey => (
      speakerKey === memberKey || speakerKey.includes(memberKey) || memberKey.includes(speakerKey)
    ))) {
      return phrase;
    }
  }
  return null;
}

function normalizeName(name) {
  return String(name || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function buildRivalMap(members, results) {
  const names = new Set(members.map(member => member.name));
  const records = new Map();
  Object.values(results || {}).forEach(result => {
    if (!names.has(result?.away) || !names.has(result?.home)) return;
    const awayScore = scoreNumber(result.awayScore);
    const homeScore = scoreNumber(result.homeScore);
    if (awayScore == null || homeScore == null) return;
    const key = pairKey(result.away, result.home);
    const record = records.get(key) || createPairRecord(result.away, result.home);
    record.played++;
    record.goals[result.away] += awayScore;
    record.goals[result.home] += homeScore;
    const winner = pickWinner(result, awayScore, homeScore);
    if (winner) record.wins[winner]++;
    else record.draws++;
    records.set(key, record);
  });

  const byName = new Map();
  members.forEach(member => {
    const candidates = [...records.values()]
      .filter(record => record.played > 0 && (record.a === member.name || record.b === member.name))
      .sort((a, b) => b.played - a.played || pairCloseness(a) - pairCloseness(b));
    const record = candidates[0];
    if (!record) return;
    const opponent = record.a === member.name ? record.b : record.a;
    const ownWins = record.wins[member.name] || 0;
    const opponentWins = record.wins[opponent] || 0;
    const ownGoals = record.goals[member.name] || 0;
    const opponentGoals = record.goals[opponent] || 0;
    byName.set(member.name, `${opponent}さんと濃いめ（${ownWins}勝${opponentWins}敗${record.draws ? `${record.draws}分` : ''}、合計${ownGoals}-${opponentGoals}）`);
  });
  return byName;
}

function createPairRecord(a, b) {
  return {
    a,
    b,
    played: 0,
    draws: 0,
    wins: { [a]: 0, [b]: 0 },
    goals: { [a]: 0, [b]: 0 },
  };
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function pairCloseness(record) {
  return Math.abs((record.goals[record.a] || 0) - (record.goals[record.b] || 0));
}

function pickWinner(result, awayScore, homeScore) {
  if (awayScore > homeScore) return result.away;
  if (homeScore > awayScore) return result.home;
  const awayPK = scoreNumber(result.awayPK);
  const homePK = scoreNumber(result.homePK);
  if (awayPK != null && homePK != null) {
    if (awayPK > homePK) return result.away;
    if (homePK > awayPK) return result.home;
  }
  return null;
}

function scoreNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildAnonymousResultHighlights(results) {
  const matches = Object.values(results || {})
    .map(result => {
      const awayScore = scoreNumber(result?.awayScore);
      const homeScore = scoreNumber(result?.homeScore);
      if (awayScore == null || homeScore == null) return null;
      return {
        total: awayScore + homeScore,
        diff: Math.abs(awayScore - homeScore),
        isPk: result.awayPK != null && result.homePK != null,
        isDraw: awayScore === homeScore,
      };
    })
    .filter(Boolean);

  if (!matches.length) return [];
  const highScore = [...matches].sort((a, b) => b.total - a.total)[0];
  const closeCount = matches.filter(match => match.diff <= 1).length;
  const pkCount = matches.filter(match => match.isPk).length;
  const bigDiff = [...matches].sort((a, b) => b.diff - a.diff)[0];

  const lines = [
    `登録済みは${matches.length}試合。今月の空気が少しずつ形になってきたよ。`,
    `一番点が動いた試合は合計${highScore.total}点。勢いで殴り合った感じがあるね。`,
  ];
  if (closeCount) lines.push(`1点差以内の接戦が${closeCount}試合。見てる側の心臓に悪い、でも好き。`);
  if (pkCount) lines.push(`PKまでもつれた試合が${pkCount}試合。決着のつき方まで濃かった。`);
  if (bigDiff.diff >= 3) lines.push(`最大得失差は${bigDiff.diff}点。流れを持っていかれる怖さも、ちゃんと残ってる。`);
  return lines;
}

function extractDiaryMoodLines(diaries, members) {
  const patterns = /(ウイコレ|試合|順位|縛り|ルール|勝|負|悔|熱|記録|メンバー|流れ|空気|ルーレット)/;
  const names = members.flatMap(member => [member.name, member.charName]).filter(Boolean);
  const seen = new Set();
  const lines = [];

  diaries.forEach(diary => {
    const text = anonymizePersonalNames(String(diary?.text || ''), names)
      .replace(/https?:\/\/\S+/g, '')
      .replace(/!\[[^\]]*]\([^)]+\)/g, '')
      .replace(/\s+/g, ' ');
    text.split(/[。！？!?]/).forEach(raw => {
      const sentence = raw.trim();
      if (sentence.length < 12 || sentence.length > 90) return;
      if (!patterns.test(sentence)) return;
      const normalized = sentence.replace(/\s+/g, '');
      if (seen.has(normalized)) return;
      seen.add(normalized);
      lines.push(`${sentence}。`);
    });
  });

  return lines.slice(0, 4);
}

function anonymizePersonalNames(text, names) {
  let result = String(text || '');
  [...names].sort((a, b) => b.length - a.length).forEach(name => {
    if (!name || name.length < 2) return;
    result = result.replace(new RegExp(`${escapeRegExp(name)}(さん|くん|君|氏)?`, 'g'), 'あるメンバー');
  });
  return result;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

module.exports = {
  formatMemberFlavorReply,
  formatAnonymousDiaryHighlights,
};
