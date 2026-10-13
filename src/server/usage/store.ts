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
    const seenSignatures = new Set<string>();

    const addRecord = (rec: TokenUsageRecord) => {
      // Signature for deduplication across files
      const sig = `${rec.client}_${rec.timestamp}_${rec.totalTokens}_${rec.model}`;
      if (seenSignatures.has(sig)) return;
      seenSignatures.add(sig);
      rec.estimatedCostUsd = rec.estimatedCostUsd || estimateCost(rec);
      loadedRecords.push(rec);
    };

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

              addRecord({
                ...raw,
                client: 'pi',
                provider: raw.provider || 'antigravity',
                input: raw.input || 0,
                output: raw.output || 0,
                reasoning: raw.reasoning || 0,
                cacheRead: raw.cacheRead || 0,
                cacheWrite: raw.cacheWrite || 0,
              });
            } catch {}
          }
        }
      }
    } catch (err) {
      console.warn(`[UsageStore] Could not read pi usage directory:`, (err as Error).message);
    }

    // 2. Ingest Pi Native Sessions (~/.pi/agent/sessions/**/*.jsonl)
    try {
      const piSessionsDir = path.join(CONFIG.paths.home, '.pi', 'agent', 'sessions');
      if (fsSync.existsSync(piSessionsDir)) {
        const walk = (d: string) => {
          try {
            for (const f of fsSync.readdirSync(d, { withFileTypes: true })) {
              const p = path.join(d, f.name);
              if (f.isDirectory()) walk(p);
              else if (f.name.endsWith('.jsonl')) {
                const content = fsSync.readFileSync(p, 'utf8');
                for (const line of content.split('\n')) {
                  if (!line.trim()) continue;
                  try {
                    const j = JSON.parse(line);
                    if (j.type === 'message' && j.message?.usage) {
                      const u = j.message.usage;
                      const ts = j.message.timestamp || (j.timestamp ? new Date(j.timestamp).getTime() : Date.now());
                      addRecord({
                        timestamp: ts,
                        client: 'pi',
                        provider: j.message.provider || 'antigravity',
                        model: j.message.model || 'unknown',
                        input: u.input || 0,
                        output: u.output || 0,
                        reasoning: u.reasoning || 0,
                        cacheRead: u.cacheRead || 0,
                        cacheWrite: u.cacheWrite || 0,
                        totalTokens: u.totalTokens || ((u.input || 0) + (u.output || 0)),
                        estimatedCostUsd: u.cost?.total,
                        source: 'pi-session',
                        sessionId: p,
                      });
                    }
                  } catch {}
                }
              }
            }
          } catch {}
        };
        walk(piSessionsDir);
      }
    } catch (err) {
      console.warn(`[UsageStore] Could not read native pi sessions:`, (err as Error).message);
    }

    // 3. Ingest Grok Build sessions (~/.grok/sessions/**/updates.jsonl)
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
                  addRecord({
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
                  });
                }
              } catch {}
            }
          } catch {}
        }
      }
    } catch (err) {
      console.warn(`[UsageStore] Could not read grok sessions:`, (err as Error).message);
    }

    // 4. Ingest Codex sessions (~/.codex/sessions/**/rollout-*.jsonl)
    try {
      const codexDir = CONFIG.paths.codexSessions;
      if (fsSync.existsSync(codexDir)) {
        const findRecentCodexFiles = (dir: string, maxFiles = 200): string[] => {
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

        const recentCodexFiles = findRecentCodexFiles(codexDir, 200);
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
                  addRecord({
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
                  });
                }
              } catch {}
            }
          } catch {}
        }
      }
    } catch (err) {
      console.warn(`[UsageStore] Could not read codex sessions:`, (err as Error).message);
    }

    // 5. Ingest Claude Code sessions (~/.claude/projects/**/*.jsonl)
    try {
      const claudeDir = path.join(CONFIG.paths.home, '.claude', 'projects');
      if (fsSync.existsSync(claudeDir)) {
        const walk = (d: string) => {
          try {
            for (const f of fsSync.readdirSync(d, { withFileTypes: true })) {
              const p = path.join(d, f.name);
              if (f.isDirectory()) walk(p);
              else if (f.name.endsWith('.jsonl')) {
                const content = fsSync.readFileSync(p, 'utf8');
                for (const line of content.split('\n')) {
                  if (!line.trim()) continue;
                  try {
                    const j = JSON.parse(line);
                    if (j.message?.usage) {
                      const u = j.message.usage;
                      const ts = j.timestamp ? new Date(j.timestamp).getTime() : Date.now();
                      const input = u.input_tokens || 0;
                      const output = u.output_tokens || 0;
                      const reasoning = u.output_tokens_details?.thinking_tokens || 0;
                      const cacheRead = u.cache_read_input_tokens || 0;
                      const cacheWrite = u.cache_creation_input_tokens || 0;
                      addRecord({
                        timestamp: ts,
                        client: 'claude',
                        provider: 'anthropic',
                        model: j.message.model || 'claude-3-5-sonnet',
                        input,
                        output,
                        reasoning,
                        cacheRead,
                        cacheWrite,
                        totalTokens: input + output,
                        source: 'claude-session',
                        sessionId: p,
                      });
                    }
                  } catch {}
                }
              }
            }
          } catch {}
        };
        walk(claudeDir);
      }
    } catch (err) {
      console.warn(`[UsageStore] Could not read claude sessions:`, (err as Error).message);
    }

    // Sort descending by timestamp
    loadedRecords.sort((a, b) => b.timestamp - a.timestamp);
    this.records = loadedRecords;
    this.lastSyncTime = Date.now();
    return this.records.length;
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
      case 'yesterday': {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const startOfYesterday = new Date(startOfDay.getTime() - 24 * 3600 * 1000);
        const endOfYesterday = startOfDay.getTime();
        return this.records.filter(r => r.timestamp >= startOfYesterday.getTime() && r.timestamp < endOfYesterday);
      }
      case '7d':
        startTime = now - 7 * 24 * 3600 * 1000;
        break;
      case '30d':
        startTime = now - 30 * 24 * 3600 * 1000;
        break;
      case 'all':
      default:
        startTime = 0;
        break;
    }

    return this.records.filter(r => r.timestamp >= startTime);
  }

  public getSummary(range: UsageRange = 'today'): UsageSummary {
    const filtered = this.filterByRange(range);
    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;
    let cachedTokens = 0;
    let estimatedCostUsd = 0;

    for (const r of filtered) {
      totalTokens += r.totalTokens;
      inputTokens += r.input;
      outputTokens += r.output;
      reasoningTokens += r.reasoning || 0;
      cachedTokens += (r.cacheRead || 0);
      estimatedCostUsd += (r.estimatedCostUsd || 0);
    }

    return {
      totalTokens,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cachedTokens,
      estimatedCostUsd,
      requestCount: filtered.length,
    };
  }

  public getDailyTrend(days = 14): DailyTrendPoint[] {
    const now = new Date();
    const map = new Map<string, DailyTrendPoint>();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 3600 * 1000);
      const dateStr = d.toISOString().split('T')[0];
      map.set(dateStr, {
        date: dateStr,
        tokens: 0,
        requests: 0,
        costUsd: 0,
      });
    }

    for (const r of this.records) {
      const dateStr = new Date(r.timestamp).toISOString().split('T')[0];
      const point = map.get(dateStr);
      if (point) {
        point.tokens += r.totalTokens;
        point.requests += 1;
        point.costUsd += r.estimatedCostUsd || 0;
      }
    }

    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  private groupRecords(records: TokenUsageRecord[], getKey: (r: TokenUsageRecord) => string): GroupedUsage[] {
    const totalAllTokens = records.reduce((sum, r) => sum + r.totalTokens, 0) || 1;
    const map = new Map<string, GroupedUsage>();

    for (const r of records) {
      const name = getKey(r) || 'unknown';
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
      item.totalTokens += r.totalTokens;
      item.inputTokens += r.input;
      item.outputTokens += r.output;
      item.reasoningTokens += r.reasoning || 0;
      item.estimatedCostUsd += r.estimatedCostUsd || 0;
      item.requestCount += 1;
    }

    const result = Array.from(map.values()).sort((a, b) => b.totalTokens - a.totalTokens);
    for (const item of result) {
      item.percentage = Number(((item.totalTokens / totalAllTokens) * 100).toFixed(1));
    }
    return result;
  }

  public getByModel(range: UsageRange = '7d'): GroupedUsage[] {
    const filtered = this.filterByRange(range);
    return this.groupRecords(filtered, r => r.model);
  }

  public getByProvider(range: UsageRange = '7d'): GroupedUsage[] {
    const filtered = this.filterByRange(range);
    return this.groupRecords(filtered, r => r.provider);
  }

  public getByClient(range: UsageRange = '7d'): GroupedUsage[] {
    const filtered = this.filterByRange(range);
    return this.groupRecords(filtered, r => r.client || 'unknown');
  }

  public getRecentRecords(limit = 50): TokenUsageRecord[] {
    return this.records.slice(0, limit);
  }

  public getLastSyncTime(): number {
    return this.lastSyncTime;
  }
}

export const usageStore = new UsageStore();
