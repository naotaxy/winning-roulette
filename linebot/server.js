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
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

/* ── LINE Webhook ── */
app.post('/webhook', middleware(config), (req, res) => {
  res.json({ ok: true });  // LINEには必ず200を即返す（再試行ループ防止）
  const client = new Client(config);
  req.body.events.forEach(event => {
    webhook.handle(event, client).catch(err => console.error('[webhook error]', err));
  });
});

app.listen(port, () => console.log(`[server] listening on port ${port}`));
