'use strict';

const admin = require('firebase-admin');
const { runEventReminderSweep } = require('../linebot/src/event-reminder-worker');

runEventReminderSweep()
  .catch(err => {
    console.error('[reminder] fatal', err);
    process.exitCode = 1;
  })
  .finally(() => {
    const app = admin.apps[0];
    if (app) app.delete().catch(() => {});
  });
