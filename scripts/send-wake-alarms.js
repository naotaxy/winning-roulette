'use strict';

const admin = require('firebase-admin');
const { runWakeAlarmSweep } = require('../linebot/src/wake-alarm-worker');

runWakeAlarmSweep()
  .catch(err => {
    console.error('[wake] fatal', err);
    process.exitCode = 1;
  })
  .finally(() => {
    const app = admin.apps[0];
    if (app) app.delete().catch(() => {});
  });
