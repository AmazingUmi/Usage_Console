import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONFIG } from './config.js';
import { queryAllLiveQuotas } from './quota/oauth.js';
import { usageStore } from './usage/store.js';
import type { UsageRange } from './usage/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Initialize usage store and query quotas on server launch
usageStore.sync().then(count => {
  console.log(`[UsageStore] Synced ${count} token usage records from local clients (pi, codex, grokbuild).`);
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
  const raw = String(value ?? 'true').toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'no';
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

app.post('/api/usage/sync', async (_req, res) => {
  try {
    const count = await usageStore.sync();
    res.json({ success: true, count, lastSyncTime: usageStore.getLastSyncTime() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
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
