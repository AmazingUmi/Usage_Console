import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from '../config.js';
import type { TokenUsageRecord, UsageSummary, DailyTrendPoint, GroupedUsage, UsageRange } from './types.js';
import { estimateCost } from './pricing.js';

class UsageStore {
  private records: TokenUsageRecord[] = [];
  private lastSyncTime: number = 0;

  public async sync(): Promise<number> {
    const loadedRecords: TokenUsageRecord[] = [];
    const usageDir = CONFIG.paths.piUsage;

    try {
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
    } catch (err) {
      console.warn(`Could not read usage directory ${usageDir}:`, (err as Error).message);
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

    // Initialize the last N days with zeroed metrics
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
      const model = r.model || 'unknown';
      let entry = map.get(model);
      if (!entry) {
        entry = {
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          estimatedCostUsd: 0,
          requestCount: 0,
        };
        map.set(model, entry);
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

  public getByProvider(range: UsageRange = '7d'): GroupedUsage[] {
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
      const provider = r.provider || 'other';
      let entry = map.get(provider);
      if (!entry) {
        entry = {
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          estimatedCostUsd: 0,
          requestCount: 0,
        };
        map.set(provider, entry);
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
