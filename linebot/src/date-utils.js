'use strict';

const TOKYO_TIME_ZONE = 'Asia/Tokyo';

function getTokyoDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: TOKYO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

module.exports = { TOKYO_TIME_ZONE, getTokyoDateParts };
