import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import type { TokenUsageRecord, UsageSummary, DailyTrendPoint, GroupedUsage, UsageRange } from './types.js';
import { estimateCost } from './pricing.js';

class UsageStore {
  private records: TokenUsageRecord[] = [];
  private lastSyncTime: number = 0;

  public async sync(): Promise<number> {
    const loadedRecords: TokenUsageRecord[] = [];

    // 1. Ingest Pi ledgers (~/.pi/agent/pi-quota-monitor/usage/)
    try {
      const usageDir = CONFIG.paths.piUsage;
      if (fsSync.existsSync(usageDir)) {
        const files = await fs.readdir(usageDir);
        const jsonlFiles = files.filter(f => /^usage-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();

        for (const file of jsonlFiles) {
          const filePath = path.join(usageDir, file);
          const content = await fs.readFile(filePath, 'utf8');
          const lines = content.split('\n');

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const raw = JSON.parse(line) as TokenUsageRecord;
              if (!raw.timestamp || !raw.totalTokens) continue;

              const record: TokenUsageRecord = {
                ...raw,
                client: 'pi',
                provider: raw.provider || 'antigravity',
                input: raw.input || 0,
                output: raw.output || 0,
                reasoning: raw.reasoning || 0,
                cacheRead: raw.cacheRead || 0,
                cacheWrite: raw.cacheWrite || 0,
                estimatedCostUsd: estimateCost(raw),
              };
              loadedRecords.push(record);
            } catch {
              // ignore malformed line
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[UsageStore] Could not read pi usage directory:`, (err as Error).message);
    }

    // 2. Ingest Grok Build sessions (~/.grok/sessions/**/updates.jsonl)
    try {
      const grokDir = path.join(CONFIG.paths.home, '.grok', 'sessions');
      if (fsSync.existsSync(grokDir)) {
        const findUpdatesFiles = (dir: string): string[] => {
          let res: string[] = [];
          try {
            for (const f of fsSync.readdirSync(dir, { withFileTypes: true })) {
              const p = path.join(dir, f.name);
              if (f.isDirectory()) res = res.concat(findUpdatesFiles(p));
              else if (f.name === 'updates.jsonl') res.push(p);
            }
          } catch {}
          return res;
        };

        const updateFiles = findUpdatesFiles(grokDir);
        for (const file of updateFiles) {
          try {
            const content = await fs.readFile(file, 'utf8');
            const lines = content.split('\n');
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const j = JSON.parse(line);
                if (j.params?.update?.sessionUpdate === 'turn_completed' && j.params?.update?.usage) {
                  const usage = j.params.update.usage;
                  const model = Object.keys(usage.modelUsage || {})[0] || 'grok-4.6-build';
                  const ts = j.timestamp > 1e11 ? j.timestamp : j.timestamp * 1000;
                  const record: TokenUsageRecord = {
                    timestamp: ts,
                    client: 'grokbuild',
                    provider: 'xai',
                    model,
                    input: usage.inputTokens || 0,
                    output: usage.outputTokens || 0,
                    reasoning: usage.reasoningTokens || 0,
                    cacheRead: usage.cachedReadTokens || 0,
                    totalTokens: usage.totalTokens || ((usage.inputTokens || 0) + (usage.outputTokens || 0)),
                    estimatedCostUsd: usage.costUsdTicks ? usage.costUsdTicks * 1e-10 : 0,
                    source: 'grok-session',
                    sessionId: file,
                  };
                  record.estimatedCostUsd = record.estimatedCostUsd || estimateCost(record);
                  loadedRecords.push(record);
                }
              } catch {}
            }
          } catch {}
        }
      }
    } catch (err) {
      console.warn(`[UsageStore] Could not read grok sessions:`, (err as Error).message);
    }

    // 3. Ingest Codex sessions (~/.codex/sessions/**/rollout-*.jsonl)
    try {
      const codexDir = CONFIG.paths.codexSessions;
      if (fsSync.existsSync(codexDir)) {
        const findRecentCodexFiles = (dir: string, maxFiles = 50): string[] => {
          let list: { p: string; mtime: number }[] = [];
          const walk = (d: string) => {
            try {
              for (const f of fsSync.readdirSync(d, { withFileTypes: true })) {
                const p = path.join(d, f.name);
                if (f.isDirectory()) walk(p);
                else if (f.name.endsWith('.jsonl')) {
                  list.push({ p, mtime: fsSync.statSync(p).mtimeMs });
                }
              }
            } catch {}
          };
          walk(dir);
          list.sort((a, b) => b.mtime - a.mtime);
          return list.slice(0, maxFiles).map(x => x.p);
        };

        const recentCodexFiles = findRecentCodexFiles(codexDir, 50);
        for (const file of recentCodexFiles) {
          try {
            const content = await fs.readFile(file, 'utf8');
            const lines = content.split('\n');
            let currentModel = 'gpt-4o';

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const j = JSON.parse(line);
                if (j.type === 'turn_context' && j.payload?.model) {
                  currentModel = j.payload.model;
                } else if (j.type === 'event_msg' && j.payload?.type === 'token_count' && j.payload.info?.last_token_usage) {
                  const usage = j.payload.info.last_token_usage;
                  const ts = j.timestamp ? new Date(j.timestamp).getTime() : Date.now();
                  const record: TokenUsageRecord = {
                    timestamp: ts,
                    client: 'codex',
                    provider: 'openai-codex',
                    model: currentModel,
                    input: usage.input_tokens || 0,
                    output: usage.output_tokens || 0,
                    reasoning: usage.reasoning_output_tokens || 0,
                    cacheRead: usage.cached_input_tokens || 0,
                    totalTokens: usage.total_tokens || ((usage.input_tokens || 0) + (usage.output_tokens || 0)),
                    source: 'codex-session',
                    sessionId: file,
                  };
                  record.estimatedCostUsd = estimateCost(record);
                  loadedRecords.push(record);
                }
              } catch {}
            }
          } catch {}
        }
      }
    } catch (err) {
      console.warn(`[UsageStore] Could not read codex sessions:`, (err as Error).message);
    }

    // Sort descending by timestamp
    loadedRecords.sort((a, b) => b.timestamp - a.timestamp);
    this.records = loadedRecords;
    this.lastSyncTime = Date.now();
    return this.records.length;
  }

  private filterByRange(range: UsageRange): TokenUsageRecord[] {
    if (range === 'all') return this.records;

    const now = new Date();
    let startTime = 0;

    if (range === 'today') {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      startTime = startOfDay.getTime();
    } else if (range === '7d') {
      startTime = Date.now() - 7 * 86_400_000;
    } else if (range === '30d') {
      startTime = Date.now() - 30 * 86_400_000;
    }

    return this.records.filter(r => r.timestamp >= startTime);
  }

  public getSummary(range: UsageRange = 'today'): UsageSummary {
    const subset = this.filterByRange(range);
    const summary: UsageSummary = {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: 0,
      requestCount: subset.length,
    };

    for (const r of subset) {
      summary.totalTokens += r.totalTokens;
      summary.inputTokens += r.input;
      summary.outputTokens += r.output;
      summary.reasoningTokens += r.reasoning || 0;
      summary.cacheReadTokens += r.cacheRead || 0;
      summary.cacheWriteTokens += r.cacheWrite || 0;
      summary.estimatedCostUsd += r.estimatedCostUsd || 0;
    }

    summary.estimatedCostUsd = Number(summary.estimatedCostUsd.toFixed(4));
    return summary;
  }

  public getDailyTrend(days: number = 14): DailyTrendPoint[] {
    const map = new Map<string, DailyTrendPoint>();
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86_400_000);
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      map.set(dateKey, {
        date: dateKey,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        requestCount: 0,
      });
    }

    for (const r of this.records) {
      const d = new Date(r.timestamp);
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const entry = map.get(dateKey);
      if (entry) {
        entry.totalTokens += r.totalTokens;
        entry.inputTokens += r.input;
        entry.outputTokens += r.output;
        entry.estimatedCostUsd += r.estimatedCostUsd || 0;
        entry.requestCount += 1;
      }
    }

    const result = Array.from(map.values());
    for (const item of result) {
      item.estimatedCostUsd = Number(item.estimatedCostUsd.toFixed(4));
    }
    return result;
  }

  public getByModel(range: UsageRange = '7d'): GroupedUsage[] {
    return this.aggregateByField(range, r => r.model || 'unknown');
  }

  public getByProvider(range: UsageRange = '7d'): GroupedUsage[] {
    return this.aggregateByField(range, r => r.provider || 'other');
  }

  public getByClient(range: UsageRange = '7d'): GroupedUsage[] {
    return this.aggregateByField(range, r => r.client || 'other');
  }

  private aggregateByField(range: UsageRange, getKey: (r: TokenUsageRecord) => string): GroupedUsage[] {
    const subset = this.filterByRange(range);
    const map = new Map<string, {
      totalTokens: number;
      inputTokens: number;
      outputTokens: number;
      reasoningTokens: number;
      estimatedCostUsd: number;
      requestCount: number;
    }>();

    let grandTotalTokens = 0;

    for (const r of subset) {
      const key = getKey(r);
      let entry = map.get(key);
      if (!entry) {
        entry = {
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          estimatedCostUsd: 0,
          requestCount: 0,
        };
        map.set(key, entry);
      }
      entry.totalTokens += r.totalTokens;
      entry.inputTokens += r.input;
      entry.outputTokens += r.output;
      entry.reasoningTokens += r.reasoning || 0;
      entry.estimatedCostUsd += r.estimatedCostUsd || 0;
      entry.requestCount += 1;
      grandTotalTokens += r.totalTokens;
    }

    return Array.from(map.entries())
      .map(([name, data]) => ({
        name,
        totalTokens: data.totalTokens,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        reasoningTokens: data.reasoningTokens,
        estimatedCostUsd: Number(data.estimatedCostUsd.toFixed(4)),
        requestCount: data.requestCount,
        percentage: grandTotalTokens > 0 ? Number(((data.totalTokens / grandTotalTokens) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens);
  }

  public getRecentRecords(limit: number = 50): TokenUsageRecord[] {
    return this.records.slice(0, limit);
  }

  public getLastSyncTime(): number {
    return this.lastSyncTime;
  }
}

export const usageStore = new UsageStore();
