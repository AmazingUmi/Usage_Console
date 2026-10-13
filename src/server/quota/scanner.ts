import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from '../config.js';
import type { ProviderQuota, QuotaState, QuotaWindow, QuotaGroup } from './types.js';

interface RawCodexReading {
  capturedAt?: number;
  plan?: string;
  fiveHour?: QuotaWindow;
  weekly?: QuotaWindow;
}

interface RawAntigravityReading {
  capturedAt?: number;
  tier?: string;
  groups?: QuotaGroup[];
  models?: Array<{ modelId: string; displayName?: string; remainingPercent: number; resetAt?: number }>;
}

interface RawGrokReading {
  capturedAt?: number;
  plan?: string;
  windows?: QuotaWindow[];
}

export async function getLatestQuotaState(): Promise<QuotaState> {
  const providers: Record<string, ProviderQuota> = {};
  const baseDir = CONFIG.paths.piQuotaReadings;

  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const providerDir = path.join(baseDir, entry.name);
      const files = await fs.readdir(providerDir);
      const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse();
      if (jsonFiles.length === 0) continue;

      const latestFile = path.join(providerDir, jsonFiles[0]);
      try {
        const content = await fs.readFile(latestFile, 'utf8');
        const data = JSON.parse(content);

        if (entry.name.startsWith('antigravity')) {
          const raw = data as RawAntigravityReading;
          providers['antigravity'] = {
            provider: 'antigravity',
            displayName: 'Antigravity (Google)',
            plan: raw.tier || 'Standard',
            capturedAt: raw.capturedAt || Date.now(),
            status: 'ok',
            groups: raw.groups || [],
          };
        } else if (entry.name.startsWith('codex')) {
          const raw = data as RawCodexReading;
          const windows: QuotaWindow[] = [];
          if (raw.fiveHour) {
            windows.push({
              ...raw.fiveHour,
              label: '5-Hour Window',
            });
          }
          if (raw.weekly) {
            windows.push({
              ...raw.weekly,
              label: 'Weekly Window',
            });
          }

          // Use provider key or account key if multiple
          const key = entry.name.length > 10 ? `codex_${entry.name.slice(6, 12)}` : 'codex';
          providers[key] = {
            provider: 'codex',
            displayName: `OpenAI Codex (${raw.plan || 'Active'})`,
            plan: raw.plan,
            capturedAt: raw.capturedAt || Date.now(),
            status: 'ok',
            windows,
          };
        } else if (entry.name.startsWith('grok')) {
          const raw = data as RawGrokReading;
          providers['grok'] = {
            provider: 'grok',
            displayName: 'xAI Grok',
            plan: raw.plan,
            capturedAt: raw.capturedAt || Date.now(),
            status: 'ok',
            windows: raw.windows || [],
          };
        }
      } catch (err) {
        console.error(`Failed to parse quota file ${latestFile}:`, err);
      }
    }
  } catch (err) {
    // If directory not found, we can supply fallback status
    console.warn(`Could not read quota directory ${baseDir}:`, (err as Error).message);
  }

  // If no providers found, check fallback or mock data
  if (Object.keys(providers).length === 0) {
    providers['codex'] = {
      provider: 'codex',
      displayName: 'OpenAI Codex',
      plan: 'Plus',
      capturedAt: Date.now(),
      status: 'warning',
      errorMessage: '等待同步额度或未配置凭据',
      windows: [
        { label: '5-Hour Window', remainingPercent: 100, resetAt: Date.now() + 3600 * 1000 * 3 },
        { label: 'Weekly Window', remainingPercent: 100, resetAt: Date.now() + 3600 * 1000 * 24 * 5 },
      ]
    };
  }

  return {
    updatedAt: Date.now(),
    providers,
  };
}
