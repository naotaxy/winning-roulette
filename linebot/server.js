'use strict';
require('dotenv').config();

const express = require('express');
const { middleware, Client } = require('@line/bot-sdk');
const webhook = require('./src/webhook');

const config = {
  channelSecret:     process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

process.on('uncaughtException',    err => console.error('[uncaught]', err));
process.on('unhandledRejection',   err => console.error('[unhandledRejection]', err));

const app  = express();
const port = process.env.PORT || 3000;

/* ── ヘルスチェック（UptimeRobot用） ── */
app.get('/health', (_req, res) => res.json({
  ok: true,
  ts: new Date().toISOString(),
  commit: process.env.RENDER_GIT_COMMIT ? process.env.RENDER_GIT_COMMIT.slice(0, 7) : null,
  line: {
    channelSecret: !!process.env.LINE_CHANNEL_SECRET,
    channelAccessToken: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
  },
}));

/* ── LINE Webhook ── */
app.post('/webhook', middleware(config), (req, res) => {
  res.json({ ok: true });  // LINEには必ず200を即返す（再試行ループ防止）
  const client = new Client(config);
  req.body.events.forEach(event => {
    webhook.handle(event, client).catch(err => console.error('[webhook error]', err));
  });
});

app.use((err, req, res, next) => {
  if (req.path === '/webhook') {
    console.error('[line middleware error]', err?.message || err);
    return res.status(401).json({ ok: false, error: 'line webhook rejected' });
  }
  return next(err);
});

app.listen(port, () => console.log(`[server] listening on port ${port}`));
