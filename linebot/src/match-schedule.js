'use strict';

const DEFAULT_MATCH_SCHEDULE = {
  matchesPerPair: 2,
  weeks: [2, 4],
};
const MATCH_WEEK_OPTIONS = [1, 2, 3, 4, 5];

function normalizeMatchSchedule(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  let weeks = Array.isArray(source.weeks)
    ? source.weeks.map(Number).filter(w => MATCH_WEEK_OPTIONS.includes(w))
    : [...DEFAULT_MATCH_SCHEDULE.weeks];
  weeks = [...new Set(weeks)].sort((a, b) => a - b);

  let matchesPerPair = Number(source.matchesPerPair ?? source.matchesPerMonth);
  if (!Number.isInteger(matchesPerPair) || matchesPerPair < 1 || matchesPerPair > MATCH_WEEK_OPTIONS.length) {
    matchesPerPair = weeks.length || DEFAULT_MATCH_SCHEDULE.matchesPerPair;
  }
  if (!weeks.length || weeks.length !== matchesPerPair) {
    weeks = defaultWeeksForMatchCount(matchesPerPair);
  }
  return { matchesPerPair, weeks };
}

function defaultWeeksForMatchCount(count) {
  const patterns = {
    1: [2],
    2: [2, 4],
    3: [1, 3, 5],
    4: [1, 2, 3, 4],
    5: [1, 2, 3, 4, 5],
  };
  return [...(patterns[count] || DEFAULT_MATCH_SCHEDULE.weeks)];
}

function formatWeekList(weeks) {
  return (weeks || []).map(w => `第${w}`).join('・') + '週';
}

function formatMatchSchedule(schedule) {
  const normalized = normalizeMatchSchedule(schedule);
  return `各ペア月${normalized.matchesPerPair}回（${formatWeekList(normalized.weeks)}）`;
}

module.exports = {
  DEFAULT_MATCH_SCHEDULE,
  normalizeMatchSchedule,
  formatMatchSchedule,
};
