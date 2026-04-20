'use strict';

const { loadImage } = require('canvas');

async function inspectImage(imageBuffer) {
  const img = await loadImage(imageBuffer);
  const ratio = img.width / img.height;
  return {
    width: img.width,
    height: img.height,
    ratio,
  };
}

function looksLikePhoneScreenshot(profile) {
  if (!profile) return false;
  if (profile.width < 600 || profile.height < 900) return false;
  if (profile.height <= profile.width) return false;
  return profile.ratio >= 0.35 && profile.ratio <= 0.90;
}

function classifyOcrResult(ocrResult) {
  const hasAway = !!ocrResult?.awayChar?.playerName;
  const hasHome = !!ocrResult?.homeChar?.playerName;
  const hasAwayScore = Number.isInteger(ocrResult?.awayScore);
  const hasHomeScore = Number.isInteger(ocrResult?.homeScore);
  const hasScores = hasAwayScore && hasHomeScore;
  const matchedTeams = Number(hasAway) + Number(hasHome);

  return {
    hasScores,
    matchedTeams,
    isCompleteMatch: hasScores && matchedTeams === 2,
    isMaybeMatch: hasScores || matchedTeams >= 1,
  };
}

module.exports = { inspectImage, looksLikePhoneScreenshot, classifyOcrResult };
