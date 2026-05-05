'use strict';

const TOKYO_TIME_ZONE = 'Asia/Tokyo';

function getTokyoDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: TOKYO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function shiftMonth(year, month, delta) {
  const zeroBased = (year * 12) + (month - 1) + delta;
  return {
    year: Math.floor(zeroBased / 12),
    month: (zeroBased % 12) + 1,
  };
}

module.exports = { TOKYO_TIME_ZONE, getTokyoDateParts, shiftMonth };
