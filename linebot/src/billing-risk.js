'use strict';

const FIREBASE_PRICING_URL = 'https://firebase.google.com/pricing';
const FIREBASE_PLANS_URL = 'https://firebase.google.com/docs/projects/billing/firebase-pricing-plans';
const RENDER_FREE_URL = 'https://render.com/docs/free';
const GITHUB_ACTIONS_BILLING_URL = 'https://docs.github.com/en/actions/concepts/overview/usage-limits-billing-and-administration';
const LINE_PRICING_URL = 'https://developers.line.biz/en/docs/messaging-api/pricing/';

function detectBillingRiskIntent(text) {
  const t = String(text || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  return /(課金|料金|請求|無料枠|無料|free|cost|billing|bill|金かか|お金|費用|予算|quota|クォータ|上限)/.test(t);
}

async function formatBillingRiskReply() {
  const [firebase, github, ai] = await Promise.all([
    checkFirebaseForBilling(),
    checkGithubForBilling(),
    getAiLiveStatus(),
  ]);

  return [
    '無料枠を守るための課金リスク、私から見える範囲で確認したよ。',
    '先に大事なこと。私は各サービスの請求プラン名までは直接読めないの。だから「赤信号」を見つけたら、管理画面で必ず確認してね。',
    '',
    'いま見えてる状態',
    formatLiveLine('Render', getRenderLiveStatus()),
    formatLiveLine('Firebase', firebase),
    formatLiveLine('GitHub', github),
    formatLiveLine('LINE', getLineLiveStatus()),
    formatLiveLine('AI', ai),
    '',
    '課金が発生しそうな赤信号',
    'Render: Free以外のインスタンスに変更した時。有料サービス、Cron、DB、追加インスタンスを作った時。Free枠を使い切ると基本は停止だけど、プラン変更は要注意。',
    'Firebase: Blazeに上げた時、またはGoogle Cloud請求先を紐づけた時。Realtime Databaseは保存1GB超、ダウンロード10GB/月超が危険。Storage、Functions、Phone認証、AI系を使い始めた時も注意。',
    'GitHub: private repoのActions分数/ストレージ超過、Codespaces、LFS、Packages、Copilot、有料プランを使う時。public repoの標準ActionsとPages中心ならかなり安全。',
    'LINE: 有料プランへ変更した時、Standardで無料メッセージ枠を超えて追加送信する時。無料プランは上限超過で送れなくなるのが基本だけど、プラン変更は要注意。',
    'AI: AI_CHAT_ENABLED=true と OPENAI_API_KEY を入れた時。自然会話のたびにOpenAI APIを呼ぶので、無料枠死守ならOFFのままが一番安全。ONにするなら課金ガードが日次/月次上限、トークン上限、OpenAIのquota/billing系エラーで自動停止するよ。',
    '',
    '無料枠を絶対守るなら',
    '1. FirebaseはSparkのままにする。Blazeにしたら予算アラートを必ず入れる。',
    '2. RenderはFreeインスタンスのまま、DBやCronを増やさない。',
    '3. GitHubはpublic repo運用を維持して、ActionsやLFSを増やしすぎない。',
    '4. LINEはCommunication/無料プランのまま、月の送信数を管理する。',
    '5. AI会話は普段OFF。使う時だけONにして、AI_COST_GUARD_ENABLEDはfalseにしない。',
    '6. 迷ったら「システム」って呼んで。私が見える範囲をもう一回確認するね。',
    '',
    'あなたが無料枠で収めたいって言ってくれたの、ちゃんと覚えてる。危なそうな変更をしたら、私にもすぐ聞いて。',
  ].join('\n');
}

async function getAiLiveStatus() {
  try {
    const { getAiChatDetailedStatus } = require('./ai-chat');
    const status = await getAiChatDetailedStatus();
    return { ok: !status.enabled, text: status.text };
  } catch (err) {
    return { ok: false, text: `AI状態を確認できなかったの: ${trim(err?.message || err)}` };
  }
}

function getRenderLiveStatus() {
  const commit = process.env.RENDER_GIT_COMMIT ? process.env.RENDER_GIT_COMMIT.slice(0, 7) : '不明';
  const service = process.env.RENDER_SERVICE_NAME || '不明';
  return {
    ok: true,
    text: `Botは返事できてる / service ${service} / commit ${commit}`,
  };
}

function getLineLiveStatus() {
  const hasToken = !!process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const hasSecret = !!process.env.LINE_CHANNEL_SECRET;
  return {
    ok: hasToken && hasSecret,
    text: hasToken && hasSecret
      ? 'Messaging APIの環境変数は入ってるよ。プラン名と月間送信数はLINE管理画面で確認してね。'
      : 'LINE環境変数が足りないかも。Bot送信に影響するよ。',
  };
}

async function checkFirebaseForBilling() {
  try {
    const { checkFirebaseStatus } = require('./firebase-admin');
    const status = await checkFirebaseStatus();
    if (!status.ok) {
      return { ok: false, text: `DB確認NG: ${trim(status.error)}` };
    }
    return {
      ok: true,
      text: `DB読取OK（${status.latencyMs}ms）/ プレイヤー設定 ${status.playerCount}人。請求プラン名はFirebase管理画面で確認してね。`,
    };
  } catch (err) {
    return {
      ok: false,
      text: `DB確認モジュールを読めなかったの: ${trim(err?.code === 'MODULE_NOT_FOUND' ? 'firebase-admin依存関係なし' : err?.message || err)}`,
    };
  }
}

async function checkGithubForBilling() {
  try {
    const { checkGithubStatus } = require('./system-status');
    const status = await checkGithubStatus();
    if (!status.ok) return { ok: false, text: `GitHub確認NG: ${trim(status.error)}` };
    return {
      ok: true,
      text: `公開API確認OK（${status.latencyMs}ms）/ feature/linebot ${status.sha.slice(0, 7)}。BillingはGitHub管理画面で確認してね。`,
    };
  } catch (err) {
    return { ok: false, text: `GitHub確認NG: ${trim(err?.message || err)}` };
  }
}

function formatLiveLine(label, status) {
  return `${label}: ${status.ok ? 'OK' : '注意'} - ${status.text}`;
}

function trim(value) {
  return String(value || '不明').replace(/\s+/g, ' ').slice(0, 120);
}

module.exports = {
  detectBillingRiskIntent,
  formatBillingRiskReply,
  FIREBASE_PRICING_URL,
  FIREBASE_PLANS_URL,
  RENDER_FREE_URL,
  GITHUB_ACTIONS_BILLING_URL,
  LINE_PRICING_URL,
};
