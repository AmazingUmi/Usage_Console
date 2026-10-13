import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import type { TokenUsageRecord, UsageSummary, DailyTrendPoint, GroupedUsage, UsageRange } from './types.js';
import { estimateCost } from './pricing.js';

function toEpoch(value: unknown, fallback = Date.now()): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e11 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 1e11 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export interface UsageQueryOptions {
  excludeAgyClaude?: boolean;
}

export function isAgyClaudeRecord(record: TokenUsageRecord): boolean {
  const provider = (record.provider || '').toLowerCase();
  const model = (record.model || '').toLowerCase();
  if (!provider.includes('antigravity')) return false;
  return model.includes('claude') || model.includes('anthropic');
}

function shouldExcludeAgyClaude(options?: UsageQueryOptions): boolean {
  return options?.excludeAgyClaude !== false;
}

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function findRecentFiles(dir: string, predicate: (name: string) => boolean, maxFiles = 300): string[] {
  const list: { p: string; mtime: number }[] = [];
  const walk = (current: string) => {
    try {
      for (const entry of fsSync.readdirSync(current, { withFileTypes: true })) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) walk(fullPath);
        else if (predicate(entry.name)) {
          try {
            list.push({ p: fullPath, mtime: fsSync.statSync(fullPath).mtimeMs });
          } catch {}
        }
      }
    } catch {}
  };
  walk(dir);
  list.sort((a, b) => b.mtime - a.mtime);
  return list.slice(0, maxFiles).map((item) => item.p);
}

async function readLines(filePath: string): Promise<string[]> {
  const content = await fs.readFile(filePath, 'utf8');
  return content.split('\n');
}

class UsageStore {
  private records: TokenUsageRecord[] = [];
  private lastSyncTime = 0;
  private inflightSync: Promise<number> | null = null;

  public async sync(): Promise<number> {
    if (this.inflightSync) return this.inflightSync;
    this.inflightSync = this.runSync().finally(() => {
      this.inflightSync = null;
    });
    return this.inflightSync;
  }

  public async ensureReady(): Promise<void> {
    if (this.lastSyncTime > 0) return;
    await this.sync();
  }

  private async runSync(): Promise<number> {
    const loadedRecords: TokenUsageRecord[] = [];
    const seenSignatures = new Set<string>();

    const addRecord = (rec: TokenUsageRecord) => {
      if (!rec.timestamp || !Number.isFinite(rec.timestamp) || !rec.totalTokens) return;
      const sig = `${rec.client ?? 'unknown'}_${rec.timestamp}_${rec.totalTokens}_${rec.model}`;
      if (seenSignatures.has(sig)) return;
      seenSignatures.add(sig);

      const incomingCost = rec.estimatedCostUsd;
      rec.id = rec.id || sig;
      rec.input = rec.input || 0;
      rec.output = rec.output || 0;
      rec.reasoning = rec.reasoning || 0;
      rec.cacheRead = rec.cacheRead || 0;
      rec.cacheWrite = rec.cacheWrite || 0;
      rec.estimatedCostUsd = typeof incomingCost === 'number' && incomingCost > 0
        ? incomingCost
        : estimateCost({ ...rec, estimatedCostUsd: undefined });
      loadedRecords.push(rec);
    };

    await Promise.all([
      this.ingestPiLedgers(addRecord),
      this.ingestPiSessions(addRecord),
      this.ingestGrokSessions(addRecord),
      this.ingestCodexSessions(addRecord),
      this.ingestClaudeSessions(addRecord),
    ]);

    loadedRecords.sort((a, b) => b.timestamp - a.timestamp);
    this.records = loadedRecords;
    this.lastSyncTime = Date.now();
    return this.records.length;
  }

  private async ingestPiLedgers(addRecord: (rec: TokenUsageRecord) => void): Promise<void> {
    try {
      const usageDir = CONFIG.paths.piUsage;
      if (!fsSync.existsSync(usageDir)) return;
      const files = (await fs.readdir(usageDir))
        .filter((file) => /^usage-\d{4}-\d{2}-\d{2}\.jsonl$/.test(file))
        .sort();

      for (const file of files) {
        try {
          const lines = await readLines(path.join(usageDir, file));
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const raw = JSON.parse(line) as TokenUsageRecord;
              addRecord({
                ...raw,
                timestamp: toEpoch(raw.timestamp),
                client: 'pi',
                provider: raw.provider || 'antigravity',
                model: raw.model || 'unknown',
                input: raw.input || 0,
                output: raw.output || 0,
                reasoning: raw.reasoning || 0,
                cacheRead: raw.cacheRead || 0,
                cacheWrite: raw.cacheWrite || 0,
                totalTokens: raw.totalTokens || ((raw.input || 0) + (raw.output || 0)),
                source: raw.source || 'pi-ledger',
              });
            } catch {}
          }
        } catch {}
      }
    } catch (err) {
      console.warn('[UsageStore] Could not read pi usage directory:', (err as Error).message);
    }
  }

  private async ingestPiSessions(addRecord: (rec: TokenUsageRecord) => void): Promise<void> {
    try {
      const piSessionsDir = path.join(CONFIG.paths.piAgent, 'sessions');
      if (!fsSync.existsSync(piSessionsDir)) return;
      const files = findRecentFiles(piSessionsDir, (name) => name.endsWith('.jsonl'), 400);

      for (const filePath of files) {
        try {
          const lines = await readLines(filePath);
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);
              if (json.type !== 'message' || !json.message?.usage) continue;
              const usage = json.message.usage;
              addRecord({
                timestamp: toEpoch(json.message.timestamp || json.timestamp),
                client: 'pi',
                provider: json.message.provider || 'antigravity',
                model: json.message.model || 'unknown',
                input: usage.input || 0,
                output: usage.output || 0,
                reasoning: usage.reasoning || 0,
                cacheRead: usage.cacheRead || 0,
                cacheWrite: usage.cacheWrite || 0,
                totalTokens: usage.totalTokens || ((usage.input || 0) + (usage.output || 0)),
                estimatedCostUsd: usage.cost?.total,
                source: 'pi-session',
                sessionId: filePath,
              });
            } catch {}
          }
        } catch {}
      }
    } catch (err) {
      console.warn('[UsageStore] Could not read native pi sessions:', (err as Error).message);
    }
  }

  private async ingestGrokSessions(addRecord: (rec: TokenUsageRecord) => void): Promise<void> {
    try {
      const grokDir = path.join(CONFIG.paths.home, '.grok', 'sessions');
      if (!fsSync.existsSync(grokDir)) return;
      const files = findRecentFiles(grokDir, (name) => name === 'updates.jsonl', 300);

      for (const filePath of files) {
        try {
          const lines = await readLines(filePath);
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);
              if (json.params?.update?.sessionUpdate !== 'turn_completed' || !json.params?.update?.usage) continue;
              const usage = json.params.update.usage;
              const model = Object.keys(usage.modelUsage || {})[0] || 'grok-4.6-build';
              addRecord({
                timestamp: toEpoch(json.timestamp),
                client: 'grokbuild',
                provider: 'xai',
                model,
                input: usage.inputTokens || 0,
                output: usage.outputTokens || 0,
                reasoning: usage.reasoningTokens || 0,
                cacheRead: usage.cachedReadTokens || 0,
                totalTokens: usage.totalTokens || ((usage.inputTokens || 0) + (usage.outputTokens || 0)),
                estimatedCostUsd: usage.costUsdTicks ? usage.costUsdTicks * 1e-10 : undefined,
                source: 'grok-session',
                sessionId: filePath,
              });
            } catch {}
          }
        } catch {}
      }
    } catch (err) {
      console.warn('[UsageStore] Could not read grok sessions:', (err as Error).message);
    }
  }

  private async ingestCodexSessions(addRecord: (rec: TokenUsageRecord) => void): Promise<void> {
    try {
      const codexDir = CONFIG.paths.codexSessions;
      if (!fsSync.existsSync(codexDir)) return;
      const files = findRecentFiles(codexDir, (name) => name.endsWith('.jsonl'), 200);

      for (const filePath of files) {
        try {
          const lines = await readLines(filePath);
          let currentModel = 'gpt-4o';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);
              if (json.type === 'turn_context' && json.payload?.model) {
                currentModel = json.payload.model;
                continue;
              }
              if (json.type !== 'event_msg' || json.payload?.type !== 'token_count' || !json.payload.info?.last_token_usage) {
                continue;
              }
              const usage = json.payload.info.last_token_usage;
              addRecord({
                timestamp: toEpoch(json.timestamp),
                client: 'codex',
                provider: 'openai-codex',
                model: currentModel,
                input: usage.input_tokens || 0,
                output: usage.output_tokens || 0,
                reasoning: usage.reasoning_output_tokens || 0,
                cacheRead: usage.cached_input_tokens || 0,
                totalTokens: usage.total_tokens || ((usage.input_tokens || 0) + (usage.output_tokens || 0)),
                source: 'codex-session',
                sessionId: filePath,
              });
            } catch {}
          }
        } catch {}
      }
    } catch (err) {
      console.warn('[UsageStore] Could not read codex sessions:', (err as Error).message);
    }
  }

  private async ingestClaudeSessions(addRecord: (rec: TokenUsageRecord) => void): Promise<void> {
    try {
      const claudeDir = path.join(CONFIG.paths.home, '.claude', 'projects');
      if (!fsSync.existsSync(claudeDir)) return;
      const files = findRecentFiles(claudeDir, (name) => name.endsWith('.jsonl'), 300);

      for (const filePath of files) {
        try {
          const lines = await readLines(filePath);
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);
              if (!json.message?.usage) continue;
              const usage = json.message.usage;
              const input = usage.input_tokens || 0;
              const output = usage.output_tokens || 0;
              addRecord({
                timestamp: toEpoch(json.timestamp),
                client: 'claude',
                provider: 'anthropic',
                model: json.message.model || 'claude-3-5-sonnet',
                input,
                output,
                reasoning: usage.output_tokens_details?.thinking_tokens || 0,
                cacheRead: usage.cache_read_input_tokens || 0,
                cacheWrite: usage.cache_creation_input_tokens || 0,
                totalTokens: input + output,
                source: 'claude-session',
                sessionId: filePath,
              });
            } catch {}
          }
        } catch {}
      }
    } catch (err) {
      console.warn('[UsageStore] Could not read claude sessions:', (err as Error).message);
    }
  }

  private filterByRange(range: UsageRange): TokenUsageRecord[] {
    const now = Date.now();
    let startTime = 0;

    switch (range) {
      case 'today': {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        startTime = startOfDay.getTime();
        break;
      }
      case '7d':
        startTime = now - 7 * 24 * 3600 * 1000;
        break;
      case '30d':
        startTime = now - 30 * 24 * 3600 * 1000;
        break;
      case 'all':
      default:
        return this.records;
    }

    return this.records.filter((record) => record.timestamp >= startTime);
  }

  private selectRecords(range: UsageRange, options?: UsageQueryOptions): TokenUsageRecord[] {
    const ranged = this.filterByRange(range);
    if (!shouldExcludeAgyClaude(options)) return ranged;
    return ranged.filter((record) => !isAgyClaudeRecord(record));
  }

  public getSummary(range: UsageRange = 'today', options?: UsageQueryOptions): UsageSummary {
    const filtered = this.selectRecords(range, options);
    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let estimatedCostUsd = 0;

    for (const record of filtered) {
      totalTokens += record.totalTokens || 0;
      inputTokens += record.input || 0;
      outputTokens += record.output || 0;
      reasoningTokens += record.reasoning || 0;
      cacheReadTokens += record.cacheRead || 0;
      cacheWriteTokens += record.cacheWrite || 0;
      estimatedCostUsd += record.estimatedCostUsd || 0;
    }

    return {
      totalTokens,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWriteTokens,
      estimatedCostUsd,
      requestCount: filtered.length,
    };
  }

  public getDailyTrend(days = 14, options?: UsageQueryOptions): DailyTrendPoint[] {
    const safeDays = Math.min(90, Math.max(1, days));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const map = new Map<string, DailyTrendPoint>();
    const source = shouldExcludeAgyClaude(options)
      ? this.records.filter((record) => !isAgyClaudeRecord(record))
      : this.records;

    for (let i = safeDays - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const dateStr = localDateKey(date);
      map.set(dateStr, {
        date: dateStr,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        requestCount: 0,
      });
    }

    for (const record of source) {
      const dateStr = localDateKey(new Date(record.timestamp));
      const point = map.get(dateStr);
      if (!point) continue;
      point.totalTokens += record.totalTokens || 0;
      point.inputTokens += record.input || 0;
      point.outputTokens += record.output || 0;
      point.estimatedCostUsd += record.estimatedCostUsd || 0;
      point.requestCount += 1;
    }

    return Array.from(map.values());
  }

  private groupRecords(records: TokenUsageRecord[], getKey: (record: TokenUsageRecord) => string): GroupedUsage[] {
    const totalAllTokens = records.reduce((sum, record) => sum + (record.totalTokens || 0), 0) || 1;
    const map = new Map<string, GroupedUsage>();

    for (const record of records) {
      const name = getKey(record) || 'unknown';
      let item = map.get(name);
      if (!item) {
        item = {
          name,
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          estimatedCostUsd: 0,
          requestCount: 0,
          percentage: 0,
        };
        map.set(name, item);
      }
      item.totalTokens += record.totalTokens || 0;
      item.inputTokens += record.input || 0;
      item.outputTokens += record.output || 0;
      item.reasoningTokens += record.reasoning || 0;
      item.estimatedCostUsd += record.estimatedCostUsd || 0;
      item.requestCount += 1;
    }

    const result = Array.from(map.values()).sort((a, b) => b.totalTokens - a.totalTokens);
    for (const item of result) {
      item.percentage = Number(((item.totalTokens / totalAllTokens) * 100).toFixed(1));
    }
    return result;
  }

  public getByModel(range: UsageRange = '7d', options?: UsageQueryOptions): GroupedUsage[] {
    return this.groupRecords(this.selectRecords(range, options), (record) => record.model);
  }

  public getByProvider(range: UsageRange = '7d', options?: UsageQueryOptions): GroupedUsage[] {
    return this.groupRecords(this.selectRecords(range, options), (record) => record.provider);
  }

  public getByClient(range: UsageRange = '7d', options?: UsageQueryOptions): GroupedUsage[] {
    return this.groupRecords(this.selectRecords(range, options), (record) => record.client || 'unknown');
  }

  public getRecentRecords(limit = 50, range: UsageRange = 'all', options?: UsageQueryOptions): TokenUsageRecord[] {
    const source = this.selectRecords(range, options);
    return source.slice(0, Math.min(200, Math.max(1, limit)));
  }

  public getLastSyncTime(): number {
    return this.lastSyncTime;
  }
}

export const usageStore = new UsageStore();
