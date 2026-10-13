import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONFIG } from './config.js';
import { loadSettings, resolveDataDir, saveSettings, settingsView } from './settings.js';
import { queryAllLiveQuotas } from './quota/oauth.js';
import { usageStore } from './usage/store.js';
import type { UsageRange } from './usage/types.js';
import { calibrateData } from './data/calibrate.js';
import { copyDataIfMissing, loadAccounts, removeAccount, updateAccount, upsertAccounts } from './data/library.js';
import { getClaudeLocalStatus, lastClaudeLocalStatus } from './identity/claude-local.js';
import type { ClaudeLocalStatus } from './identity/claude-local.js';
import { finishClaudeLogin, pollCodexLogin, startClaudeLogin, startCodexLogin } from './identity/login.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Initialize usage store and query quotas on server launch
calibrateData().then(({ count }) => {
  console.log(`[UsageStore] Calibrated ${count} usage records. OAuth tokens are not stored.`);
}).catch(err => {
  console.error('[UsageStore] Initial sync failed:', err);
});

queryAllLiveQuotas().then(() => {
  console.log('[Quota] Initial live OAuth quota check completed.');
}).catch(err => {
  console.warn('[Quota] Initial quota check warning:', err.message);
});

// Auto-sync usage & quota periodically (every 120s)
setInterval(() => {
  usageStore.sync().catch(() => {});
  queryAllLiveQuotas(true).catch(() => {});
}, 120 * 1000);

// API Routes
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

// Quota routes
app.get('/api/quota', async (req, res) => {
  try {
    const force = req.query.force === 'true';
    const quotaState = await queryAllLiveQuotas(force);
    res.json(quotaState);
  } catch (err) {
    res.json({
      updatedAt: Date.now(),
      providers: {},
      error: (err as Error).message,
    });
  }
});

app.post('/api/quota/refresh', async (_req, res) => {
  try {
    const quotaState = await queryAllLiveQuotas(true);
    res.json(quotaState);
  } catch (err) {
    res.json({
      updatedAt: Date.now(),
      providers: {},
      error: (err as Error).message,
    });
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

function publicClaudeStatus(status: ClaudeLocalStatus | null) {
  if (!status) return null;
  const { subscription, ...rest } = status;
  return { ...rest, windows: subscription?.windows ?? [] };
}

function publicSettings() {
  return {
    ...settingsView(usageStore.getScanReport()),
    accounts: loadAccounts(),
    dataDir: resolveDataDir(),
    claudeLogin: publicClaudeStatus(lastClaudeLocalStatus()),
  };
}

app.get('/api/claude/status', async (req, res) => {
  try {
    res.json(publicClaudeStatus(await getClaudeLocalStatus(req.query.force === 'true')));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

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
    res.status(404).json({ error: '账户不存在' });
    return;
  }
  res.json({ account, settings: publicSettings() });
});

app.delete('/api/accounts/:id', (req, res) => {
  if (!removeAccount(req.params.id)) {
    res.status(404).json({ error: '账户不存在' });
    return;
  }
  res.json({ success: true, settings: publicSettings() });
});

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
    upsertAccounts([{ ...result, source: 'login' }]);
    res.json({ ...result, settings: publicSettings() });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/login/claude/start', (_req, res) => {
  res.json(startClaudeLogin());
});

app.post('/api/login/claude/finish', async (req, res) => {
  try {
    const result = await finishClaudeLogin(String(req.body?.state || ''), String(req.body?.code || ''));
    upsertAccounts([{ ...result, source: 'login' }]);
    res.json({ ...result, settings: publicSettings() });
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
    const pathsChanged = JSON.stringify(loadSettings().paths) !== before;
    if (pathsChanged || req.body?.rescan === true || previousDataDir !== nextDataDir) await calibrateData();
    const quota = pathsChanged ? await queryAllLiveQuotas(true) : null;
    res.json({ settings: publicSettings(), quota });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Serve frontend static files if built
const clientDist = path.resolve(__dirname, '../../dist/client');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`[Usage Console Server] Running at http://${CONFIG.host}:${CONFIG.port}`);
});
