'use strict';

const DEFAULT_MAX_BACKLOG = 3;

let chain = Promise.resolve();
let running = false;
let pending = 0;
let totalStarted = 0;
let totalSkipped = 0;
let lastStartedAt = null;
let lastFinishedAt = null;
let lastSkippedAt = null;

function getMaxBacklog() {
  const value = Number(process.env.IMAGE_OCR_MAX_BACKLOG || DEFAULT_MAX_BACKLOG);
  if (!Number.isFinite(value) || value < 1) return DEFAULT_MAX_BACKLOG;
  return Math.floor(value);
}

async function enqueueImageOcr(job, label = 'image') {
  const maxBacklog = getMaxBacklog();
  const backlog = pending + (running ? 1 : 0);
  if (backlog >= maxBacklog) {
    totalSkipped++;
    lastSkippedAt = new Date().toISOString();
    console.warn(`[image-ocr] skipped label=${label} backlog=${backlog}/${maxBacklog}`);
    return { skipped: true };
  }

  pending++;
  const queuedAt = Date.now();
  const run = chain.catch(() => {}).then(async () => {
    pending--;
    running = true;
    totalStarted++;
    lastStartedAt = new Date().toISOString();
    console.log(`[image-ocr] start label=${label} waitedMs=${Date.now() - queuedAt}`);
    try {
      return { skipped: false, value: await job() };
    } finally {
      running = false;
      lastFinishedAt = new Date().toISOString();
      console.log(`[image-ocr] finish label=${label}`);
    }
  });

  chain = run.catch(() => {});
  return run;
}

function getImageOcrQueueState() {
  return {
    running,
    pending,
    maxBacklog: getMaxBacklog(),
    totalStarted,
    totalSkipped,
    lastStartedAt,
    lastFinishedAt,
    lastSkippedAt,
  };
}

module.exports = { enqueueImageOcr, getImageOcrQueueState };
