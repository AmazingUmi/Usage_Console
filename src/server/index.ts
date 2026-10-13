import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONFIG } from './config.js';
import { getLatestQuotaState } from './quota/scanner.js';
import { usageStore } from './usage/store.js';
import type { UsageRange } from './usage/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Initialize usage store on server launch
usageStore.sync().then(count => {
  console.log(`[UsageStore] Synced ${count} token usage records from local ledgers.`);
}).catch(err => {
  console.error('[UsageStore] Initial sync failed:', err);
});

// API Routes
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

// Quota routes
app.get('/api/quota', async (_req, res) => {
  try {
    const quotaState = await getLatestQuotaState();
    res.json(quotaState);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/quota/refresh', async (_req, res) => {
  try {
    const quotaState = await getLatestQuotaState();
    res.json(quotaState);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Usage routes
app.get('/api/usage/summary', (req, res) => {
  const range = (req.query.range as UsageRange) || 'today';
  const summary = usageStore.getSummary(range);
  res.json({ range, summary, lastSyncTime: usageStore.getLastSyncTime() });
});

app.get('/api/usage/trend', (req, res) => {
  const days = parseInt(req.query.days as string, 10) || 14;
  const trend = usageStore.getDailyTrend(days);
  res.json({ days, trend });
});

app.get('/api/usage/by-model', (req, res) => {
  const range = (req.query.range as UsageRange) || '7d';
  const data = usageStore.getByModel(range);
  res.json({ range, data });
});

app.get('/api/usage/by-provider', (req, res) => {
  const range = (req.query.range as UsageRange) || '7d';
  const data = usageStore.getByProvider(range);
  res.json({ range, data });
});

app.get('/api/usage/records', (req, res) => {
  const limit = parseInt(req.query.limit as string, 10) || 50;
  const records = usageStore.getRecentRecords(limit);
  res.json({ limit, records });
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
