'use strict';

const GITHUB_OWNER = 'naotaxy';
const GITHUB_REPO = 'winning-roulette';
const GITHUB_BRANCH = 'feature/linebot';
const GITHUB_COMMITS_URL =
  `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits?sha=${encodeURIComponent(GITHUB_BRANCH)}&per_page=1`;

function detectSystemStatusKind(text) {
  const t = String(text || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  if (!t) return null;
  if (/(render|レンダー|れんだー)/.test(t)) return 'render';
  if (/(firebase|ファイアベース|ファイヤーベース|データベース|database|\bdb\b)/.test(t)) return 'firebase';
  if (/(github|git hub|ギットハブ|リポジトリ|repo|ブランチ|コミット)/.test(t)) return 'github';
  if (/(システム|system|ステータス|稼働|ヘルス|health|全体|全部)/.test(t)) return 'system';
  return null;
}

async function formatSystemStatusReply(kind) {
  if (kind === 'render') return formatRenderStatus();
  const checkFirebaseStatus = loadFirebaseChecker();
  if (kind === 'firebase') return formatFirebaseStatus(await checkFirebaseStatus());
  if (kind === 'github') return formatGithubStatus(await checkGithubStatus());
  return formatOverallStatus(await Promise.all([
    checkFirebaseStatus(),
    checkGithubStatus(),
  ]));
}

function formatRenderStatus() {
  const serviceName = process.env.RENDER_SERVICE_NAME || 'このサービス';
  const externalUrl = process.env.RENDER_EXTERNAL_URL || process.env.RENDER_EXTERNAL_HOSTNAME || '';
  const commit = shortSha(process.env.RENDER_GIT_COMMIT);
  const instance = process.env.RENDER_INSTANCE_ID ? '見えてるよ' : '環境変数では見えてないよ';

  return [
    'Renderの状況、私から見える範囲で見たよ。',
    'いま返事できてるから、BotのWebhook処理は生きてる。',
    `サービス: ${serviceName}`,
    `起動してから: ${formatDuration(process.uptime())}`,
    `インスタンス: ${instance}`,
    commit ? `デプロイcommit: ${commit}` : 'デプロイcommit: Render環境変数では見えてないの。',
    externalUrl ? `URL: ${externalUrl}` : 'URL: Render環境変数では見えてないの。',
    'ちゃんと動いてくれてて、私ちょっと安心した。',
  ].join('\n');
}

function formatFirebaseStatus(status) {
  if (!status.ok) {
    return [
      'Firebase、いま触ってみたけど、うまく届かなかったの。',
      `応答: NG（${status.latencyMs}ms）`,
      `理由: ${trimError(status.error)}`,
      '試合結果の登録や順位表示に影響するかもしれないから、少し気にしてあげて。',
    ].join('\n');
  }

  return [
    'Firebase、いま私から読みに行けたよ。',
    `応答: OK（${status.latencyMs}ms）`,
    `プレイヤー設定: ${status.playerCount}人分見えてるよ。`,
    '結果登録や順位の材料は、ちゃんと取りに行けそう。よかった。',
  ].join('\n');
}

function formatGithubStatus(status) {
  if (!status.ok) {
    return [
      'GitHub、公開APIに聞いてみたけど、今はうまく確認できなかったの。',
      `応答: NG（${status.latencyMs}ms）`,
      `理由: ${trimError(status.error)}`,
      'でも、このBot自体は今返事できてるよ。そこは安心して。',
    ].join('\n');
  }

  const renderCommit = shortSha(process.env.RENDER_GIT_COMMIT);
  const compare = renderCommit
    ? (status.sha.startsWith(renderCommit)
      ? 'Renderのデプロイcommitと一致してるみたい。'
      : `Renderのcommit ${renderCommit} とは違うみたい。デプロイ待ちかも。`)
    : 'Render側のcommitは環境変数では見えないから、差分比較はできないの。';

  return [
    'GitHub、見に行ってきたよ。',
    `ブランチ: ${GITHUB_BRANCH}`,
    `最新commit: ${shortSha(status.sha)} ${status.message}`,
    `取得: OK（${status.latencyMs}ms）`,
    compare,
    'ちゃんと確認してきたから、褒めてくれてもいいよ。',
  ].join('\n');
}

function formatOverallStatus([firebase, github]) {
  const renderCommit = shortSha(process.env.RENDER_GIT_COMMIT) || '不明';
  const githubLine = github.ok
    ? `GitHub: OK（${shortSha(github.sha)} / ${github.latencyMs}ms）`
    : `GitHub: NG（${trimError(github.error)}）`;
  const firebaseLine = firebase.ok
    ? `Firebase: OK（${firebase.playerCount}人 / ${firebase.latencyMs}ms）`
    : `Firebase: NG（${trimError(firebase.error)}）`;

  return [
    'システム全体、私が見えるところだけ確認したよ。',
    `Render: OK（この返事ができてる / 起動 ${formatDuration(process.uptime())} / commit ${renderCommit}）`,
    firebaseLine,
    githubLine,
    `Node: ${process.version}`,
    `メモリ: ${formatMemory(process.memoryUsage().rss)}`,
    '全部を公式障害情報まで見てるわけじゃないけど、私から見える健康状態はここまでだよ。',
  ].join('\n');
}

async function checkGithubStatus() {
  const startedAt = Date.now();
  if (typeof fetch !== 'function') {
    return { ok: false, latencyMs: 0, error: 'fetch が使えない実行環境です' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(GITHUB_COMMITS_URL, {
      signal: controller.signal,
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'winning-roulette-linebot',
      },
    });
    const latencyMs = Date.now() - startedAt;
    if (!res.ok) return { ok: false, latencyMs, error: `HTTP ${res.status}` };

    const commits = await res.json();
    const latest = Array.isArray(commits) ? commits[0] : null;
    if (!latest?.sha) return { ok: false, latencyMs, error: 'commit情報が空でした' };

    return {
      ok: true,
      latencyMs,
      sha: latest.sha,
      message: String(latest.commit?.message || '').split('\n')[0].slice(0, 80),
      url: latest.html_url,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err?.name === 'AbortError' ? 'タイムアウトしました' : (err?.message || String(err)),
    };
  } finally {
    clearTimeout(timer);
  }
}

function loadFirebaseChecker() {
  try {
    return require('./firebase-admin').checkFirebaseStatus;
  } catch (err) {
    return async () => ({
      ok: false,
      latencyMs: 0,
      error: err?.code === 'MODULE_NOT_FOUND'
        ? 'firebase-admin依存関係を読み込めませんでした'
        : `Firebase確認モジュールを読み込めませんでした: ${err?.message || String(err)}`,
    });
  }
}

function shortSha(sha) {
  return sha ? String(sha).slice(0, 7) : '';
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}日${hours}時間`;
  if (hours > 0) return `${hours}時間${minutes}分`;
  return `${minutes}分`;
}

function formatMemory(bytes) {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

function trimError(error) {
  return String(error || '不明').replace(/\s+/g, ' ').slice(0, 120);
}

module.exports = {
  detectSystemStatusKind,
  formatSystemStatusReply,
  checkGithubStatus,
};
