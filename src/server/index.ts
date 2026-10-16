import express from 'express';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveClientDist } from './client-dist.js';
import { CONFIG } from './config.js';
import { browserUrl, isLoopbackHost, isLoopbackRequestHost } from './listen.js';
import { getProxyStatus, initializeProxy } from './network/proxy.js';
import { L, langMiddleware } from './i18n.js';
import { findAgyBinary } from './quota/agy.js';
import { loadSettings, resolveDataDir, saveSettings, settingsView } from './settings.js';
import { queryAllLiveQuotas, quotaAgeMs } from './quota/oauth.js';
import { usageStore } from './usage/store.js';
import type { UsageRange } from './usage/types.js';
import { calibrateData } from './data/calibrate.js';
import { copyDataIfMissing, loadAccounts, removeAccount, reorderAccounts, updateAccount, upsertAccounts } from './data/library.js';
import { hasCredential, removeCredential, saveCredential } from './identity/credentials.js';
import type { CredentialProvider } from './identity/credentials.js';
import type { LoginResult } from './identity/login.js';
import { finishClaudeLogin, pollCodexLogin, pollGrokLogin, startClaudeLogin, startCodexLogin, startGrokLogin } from './identity/login.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Same-origin UI only. A permissive CORS policy would let any website call this process.
app.use((req, res, next) => {
  let loopbackBind = true;
  try {
    loopbackBind = isLoopbackHost(CONFIG.host);
  } catch {
    // A refused bind never listens; fail closed if a request still arrives.
  }
  if (loopbackBind && !isLoopbackRequestHost(req.headers.host)) {
    res.status(403).type('text/plain').send('本控制台只接受本机请求。\nThis console only accepts local requests.');
    return;
  }
  next();
});
// Host checks stop DNS rebinding; Origin/Fetch Metadata also stop cross-origin side effects.
// Headerless local clients remain supported. Do not trust forwarded host/origin headers.
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  const site = req.headers['sec-fetch-site'];
  let sameOrigin = origin === undefined;
  if (origin !== undefined && req.headers.host) {
    try {
      sameOrigin = origin === new URL(`${req.protocol}://${req.headers.host}`).origin;
    } catch {
      sameOrigin = false;
    }
  }
  res.vary('Origin').vary('Sec-Fetch-Site');
  if (!sameOrigin || (site !== undefined && site !== 'same-origin' && site !== 'none')) {
    res.status(403).type('text/plain').send('本控制台拒绝跨源 API 请求。\nCross-origin API requests are not allowed.');
    return;
  }
  next();
});
app.use(express.json());
app.use(langMiddleware);

// Start work only after a successful bind; failed CLI startup must leave no scans or timers behind.
function startBackgroundTasks(): void {
  calibrateData().then(({ count }) => {
    console.log(`[UsageStore] Calibrated ${count} usage records. Accounts come from console logins only.`);
  }).catch(err => {
    console.error('[UsageStore] Initial sync failed:', err);
  });

  queryAllLiveQuotas().then(() => {
    console.log('[Quota] Initial live OAuth quota check completed.');
  }).catch(err => {
    console.warn('[Quota] Initial quota check warning:', err.message);
  });

  // The listening server, not a background timer, owns the process lifetime.
  setInterval(() => {
    usageStore.sync().catch(() => {});
  }, 120 * 1000).unref();
  scheduleQuotaPoll();
}

// Quota polling follows the "refresh interval" setting (0 = manual only) and is re-armed when it changes.
let quotaTimer: NodeJS.Timeout | null = null;
let nextRefreshAt = 0;
function scheduleQuotaPoll(): void {
  if (quotaTimer) clearTimeout(quotaTimer);
  quotaTimer = null;
  const seconds = loadSettings().quotaRefreshIntervalSeconds;
  if (seconds <= 0) {
    nextRefreshAt = 0;
    return;
  }
  nextRefreshAt = Date.now() + seconds * 1000;
  quotaTimer = setTimeout(() => {
    queryAllLiveQuotas(true).catch(() => {}).finally(scheduleQuotaPoll);
  }, seconds * 1000);
  quotaTimer.unref();
}

function decorateQuota<T extends object>(state: T): T & { refreshIntervalSeconds: number; nextRefreshAt: number | null } {
  const refreshIntervalSeconds = loadSettings().quotaRefreshIntervalSeconds;
  return {
    ...state,
    refreshIntervalSeconds,
    nextRefreshAt: refreshIntervalSeconds > 0 && nextRefreshAt > 0 ? nextRefreshAt : null,
  };
}

// API Routes
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

app.get('/api/proxy', async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json(await getProxyStatus());
  } catch {
    res.status(500).json({ error: L('无法检查代理状态，请稍后重试', 'Could not check proxy status; please try again') });
  }
});

// Quota routes
app.get('/api/quota', async (req, res) => {
  try {
    const force = req.query.force === 'true';
    const quotaState = await queryAllLiveQuotas(force);
    const seconds = loadSettings().quotaRefreshIntervalSeconds;
    if (!force && seconds > 0 && quotaAgeMs() > seconds * 1500) queryAllLiveQuotas(true).catch(() => {});
    res.set('Cache-Control', 'no-store').json(decorateQuota(quotaState));
  } catch (err) {
    res.set('Cache-Control', 'no-store').json(decorateQuota({
      updatedAt: Date.now(),
      providers: {},
      error: (err as Error).message,
    }));
  }
});

app.post('/api/quota/refresh', async (_req, res) => {
  try {
    const quotaState = await queryAllLiveQuotas(true);
    scheduleQuotaPoll();
    res.set('Cache-Control', 'no-store').json(decorateQuota(quotaState));
  } catch (err) {
    res.set('Cache-Control', 'no-store').json(decorateQuota({
      updatedAt: Date.now(),
      providers: {},
      error: (err as Error).message,
    }));
  }
});

function parseRange(value: unknown, fallback: UsageRange = 'all'): UsageRange {
  const range = String(value || fallback);
  if (range === 'today' || range === '7d' || range === '30d' || range === 'all') return range;
  return fallback;
}

function parseBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseExcludeAgyClaude(value: unknown): boolean {
  const raw = String(value ?? 'false').toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

async function usageOverview(range: UsageRange, days: number, limit: number, excludeAgyClaude: boolean) {
  await usageStore.ensureReady();
  const options = { excludeAgyClaude };
  return {
    range,
    excludeAgyClaude,
    summary: usageStore.getSummary(range, options),
    trend: usageStore.getDailyTrend(days, options),
    models: usageStore.getByModel(range, options),
    providers: usageStore.getByProvider(range, options),
    clients: usageStore.getByClient(range, options),
    records: usageStore.getRecentRecords(limit, range, options),
    speed: usageStore.getSpeed(range, options),
    lastSyncTime: usageStore.getLastSyncTime(),
  };
}

// Usage routes
app.get('/api/usage/overview', async (req, res) => {
  try {
    const range = parseRange(req.query.range);
    const days = parseBoundedInt(req.query.days, 14, 1, 90);
    const limit = parseBoundedInt(req.query.limit, 50, 1, 200);
    const excludeAgyClaude = parseExcludeAgyClaude(req.query.excludeAgyClaude);
    res.json(await usageOverview(range, days, limit, excludeAgyClaude));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/usage/summary', async (req, res) => {
  try {
    await usageStore.ensureReady();
    const range = parseRange(req.query.range, 'today');
    res.json({ range, summary: usageStore.getSummary(range), lastSyncTime: usageStore.getLastSyncTime() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/usage/trend', async (req, res) => {
  try {
    await usageStore.ensureReady();
    const days = parseBoundedInt(req.query.days, 14, 1, 90);
    res.json({ days, trend: usageStore.getDailyTrend(days) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/usage/by-model', async (req, res) => {
  try {
    await usageStore.ensureReady();
    const range = parseRange(req.query.range, '7d');
    res.json({ range, data: usageStore.getByModel(range) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/usage/by-provider', async (req, res) => {
  try {
    await usageStore.ensureReady();
    const range = parseRange(req.query.range, '7d');
    res.json({ range, data: usageStore.getByProvider(range) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/usage/by-client', async (req, res) => {
  try {
    await usageStore.ensureReady();
    const range = parseRange(req.query.range, '7d');
    res.json({ range, data: usageStore.getByClient(range) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/usage/records', async (req, res) => {
  try {
    await usageStore.ensureReady();
    const limit = parseBoundedInt(req.query.limit, 50, 1, 200);
    const range = parseRange(req.query.range, 'all');
    res.json({ limit, range, records: usageStore.getRecentRecords(limit, range) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

function publicSettings() {
  return {
    ...settingsView(usageStore.getScanReport()),
    accounts: loadAccounts().map((account) => ({
      ...account,
      ownLogin: account.type !== 'agy' && hasCredential(account.type, account.userId),
    })),
    dataDir: resolveDataDir(),
  };
}

app.post('/api/usage/sync', async (_req, res) => {
  try {
    const { count } = await calibrateData();
    res.json({ success: true, count, lastSyncTime: usageStore.getLastSyncTime(), scan: usageStore.getScanReport() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/data/calibrate', async (_req, res) => {
  try {
    const { count, accounts } = await calibrateData();
    res.json({ success: true, count, accounts, scan: usageStore.getScanReport(), settings: publicSettings() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.patch('/api/accounts/:id', (req, res) => {
  const account = updateAccount(req.params.id, { label: req.body?.label, notes: req.body?.notes });
  if (!account) {
    res.status(404).json({ error: L('账户不存在', 'Account not found') });
    return;
  }
  res.json({ account, settings: publicSettings() });
});

/** Antigravity is read through the local agy CLI (its own login), so adding it only needs agy to exist. */
app.post('/api/accounts/agy', async (_req, res) => {
  try {
    await findAgyBinary();
  } catch {
    res.status(400).json({
      error: L('没有找到 agy。请先安装并登录 Antigravity CLI（agy）。', 'agy was not found. Install and sign in to the Antigravity CLI (agy) first.'),
    });
    return;
  }
  upsertAccounts([{ type: 'agy', userId: 'agy-local', source: 'scan' }]);
  queryAllLiveQuotas(true).catch(() => {});
  res.json({ settings: publicSettings() });
});

app.put('/api/accounts/order', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id: unknown): id is string => typeof id === 'string') : [];
  reorderAccounts(ids);
  res.json({ settings: publicSettings() });
});

app.delete('/api/accounts/:id', (req, res) => {
  const account = loadAccounts().find((item) => item.id === req.params.id);
  if (!removeAccount(req.params.id)) {
    res.status(404).json({ error: L('账户不存在', 'Account not found') });
    return;
  }
  if (account && account.type !== 'agy') removeCredential(account.type, account.userId);
  res.json({ success: true, settings: publicSettings() });
});

/** Stores the new login and answers without the token: the browser only ever learns who signed in. */
function completeLogin(result: LoginResult, res: express.Response) {
  const { credential, ...account } = result;
  saveCredential(account.type as CredentialProvider, credential);
  upsertAccounts([{ ...account, source: 'login' }]);
  queryAllLiveQuotas(true).catch(() => {});
  res.json({ ...account, settings: publicSettings() });
}

app.post('/api/login/gpt/start', async (_req, res) => {
  try {
    res.json(await startCodexLogin());
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/login/gpt/poll', async (req, res) => {
  try {
    const result = await pollCodexLogin(String(req.body?.deviceCode || ''));
    if ('pending' in result) {
      res.json(result);
      return;
    }
    completeLogin(result, res);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/login/grok/start', async (_req, res) => {
  try {
    res.json(await startGrokLogin());
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/login/grok/poll', async (req, res) => {
  try {
    const result = await pollGrokLogin(String(req.body?.deviceCode || ''));
    if ('pending' in result) {
      res.json(result);
      return;
    }
    completeLogin(result, res);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/login/claude/start', (_req, res) => {
  res.json(startClaudeLogin());
});

app.post('/api/login/claude/finish', async (req, res) => {
  try {
    completeLogin(await finishClaudeLogin(String(req.body?.state || ''), String(req.body?.code || '')), res);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get('/api/settings', async (_req, res) => {
  try {
    await usageStore.ensureReady();
    res.json(publicSettings());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const previousDataDir = resolveDataDir();
    const before = JSON.stringify(loadSettings().paths);
    saveSettings(req.body ?? {});
    const nextDataDir = resolveDataDir();
    if (previousDataDir !== nextDataDir) copyDataIfMissing(previousDataDir, nextDataDir);
    scheduleQuotaPoll();
    const pathsChanged = JSON.stringify(loadSettings().paths) !== before;
    if (pathsChanged || req.body?.rescan === true || previousDataDir !== nextDataDir) await calibrateData();
    const quota = pathsChanged ? decorateQuota(await queryAllLiveQuotas(true)) : null;
    res.json({ settings: publicSettings(), quota });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

let listening = false;

/** Starts the local server. Safe to call once; the CLI and a direct `node`/`tsx` run both use this. */
export function startServer(): Promise<{ url: string; clientBuilt: boolean }> {
  if (listening) return Promise.reject(new Error('Server is already listening'));
  listening = true;
  const clientDist = resolveClientDist(__dirname);
  if (clientDist) {
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }
  let host: string;
  let port: number;
  try {
    host = CONFIG.host;
    port = CONFIG.port;
    // Configure the owned transport before the first quota/auth request, not on module import.
    initializeProxy();
  } catch (err) {
    listening = false;
    return Promise.reject(err);
  }
  if (!isLoopbackHost(host)) {
    console.warn(`[警告] 正在监听 ${host}，API 没有鉴权。\n[warning] Listening on ${host} with no authentication.`);
  }
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      startBackgroundTasks();
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      resolve({ url: browserUrl(host, actualPort), clientBuilt: clientDist != null });
    });
    server.on('error', (err) => {
      listening = false;
      reject(err);
    });
  });
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  startServer().then(({ url, clientBuilt }) => {
    console.log(`[Usage Console] ${url}`);
    if (!clientBuilt) console.error('前端尚未构建。请先执行 pnpm build。\nUI is not built. Run pnpm build.');
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
