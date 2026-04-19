'use strict';
require('dotenv').config();

const express = require('express');
const { middleware, Client } = require('@line/bot-sdk');
const webhook = require('./src/webhook');

const config = {
  channelSecret:     process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

const app  = express();
const port = process.env.PORT || 3000;

/* ── ヘルスチェック（UptimeRobot用） ── */
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

/* ── LINE Webhook ── */
app.post('/webhook', middleware(config), (req, res) => {
  const client = new Client(config);
  Promise.all(req.body.events.map(event => webhook.handle(event, client)))
    .then(() => res.json({ ok: true }))
    .catch(err => {
      console.error('[webhook error]', err);
      res.status(500).json({ error: err.message });
    });
});

app.listen(port, () => console.log(`[server] listening on port ${port}`));
