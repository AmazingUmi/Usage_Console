import fsSync from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import type { RuntimePaths } from '../settings.js';
import { usageClientName, usageRecordId, type TokenUsageRecord, type UsageSummary, type DailyTrendPoint, type GroupedUsage, type UsageRange, type ScanReport, type ScanSourceStatus, type UsageScanProgress, type UsageLogFormat, type UsageScanObserver } from './types.js';
import { estimateCost } from './pricing.js';
import { scanAntigravitySessions } from './antigravity-sessions.js';
import { scanClaudeConversations } from './claude-sessions.js';
import { readCodexSession } from './codex-sessions.js';
import { readJsonlLines } from './jsonl.js';
import { speedWindow, summarizeSpeed, type SpeedReport } from './speed.js';

function toEpoch(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
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
  return 0;
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
  return options?.excludeAgyClaude === true;
}

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

interface SessionFile {
  path: string;
  mtime: number;
  version: string;
}

function findRecentFiles(dir: string, predicate: (name: string) => boolean, maxFiles: number): SessionFile[] {
  const list: SessionFile[] = [];
  const walk = (current: string) => {
    try {
      for (const entry of fsSync.readdirSync(current, { withFileTypes: true })) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) walk(fullPath);
        else if (predicate(entry.name)) {
          try {
            const stat = fsSync.statSync(fullPath);
            if (stat.isFile()) {
              list.push({
                path: fullPath,
                mtime: stat.mtimeMs,
                version: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`,
              });
            }
          } catch {}
        }
      }
    } catch {}
  };
  walk(dir);
  list.sort((a, b) => b.mtime - a.mtime);
  return list.slice(0, maxFiles);
}

async function* readPiUsage(file: string): AsyncIterableIterator<TokenUsageRecord> {
  for await (const line of readJsonlLines(file)) {
    if (!line.trim()) continue;
    try {
      const json = JSON.parse(line);
      if (json.type !== 'message' || !json.message?.usage) continue;
      const usage = json.message.usage;
      yield {
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
        sessionId: file,
      };
    } catch {}
  }
}

async function* readGrokUsage(file: string): AsyncIterableIterator<TokenUsageRecord> {
  for await (const line of readJsonlLines(file)) {
    if (!line.trim()) continue;
    try {
      const json = JSON.parse(line);
      const update = json.params?.update;
      if (update?.sessionUpdate !== 'turn_completed' || !update.usage) continue;
      const usage = update.usage;
      yield {
        timestamp: toEpoch(json.timestamp),
        client: 'grokbuild',
        provider: 'xai',
        model: Object.keys(usage.modelUsage || {})[0] || 'grok-4.6-build',
        input: usage.inputTokens || 0,
        output: usage.outputTokens || 0,
        reasoning: usage.reasoningTokens || 0,
        cacheRead: usage.cachedReadTokens || 0,
        totalTokens: usage.totalTokens || ((usage.inputTokens || 0) + (usage.outputTokens || 0)),
        estimatedCostUsd: usage.costUsdTicks ? usage.costUsdTicks * 1e-10 : undefined,
        source: 'grok-session',
        sessionId: file,
      };
    } catch {}
  }
}

const FILE_READERS = {
  codex: { read: readCodexSession, matches: (name: string) => name.endsWith('.jsonl'), limit: 200 },
  pi: { read: readPiUsage, matches: (name: string) => name.endsWith('.jsonl'), limit: 400 },
  grok: { read: readGrokUsage, matches: (name: string) => name === 'updates.jsonl', limit: 300 },
};

type SessionFileFormat = keyof typeof FILE_READERS;
type PreparedUsageRecord = TokenUsageRecord & { id: string };

interface CachedSessionFile {
  version: string;
  records: PreparedUsageRecord[];
}

// Only freshly parsed records are normalized here. Cached records are shared with the last scan.
function prepareRecord(record: TokenUsageRecord): PreparedUsageRecord | null {
  const billable = (record.totalTokens || 0) + (record.input || 0) + (record.output || 0)
    + (record.cacheRead || 0) + (record.cacheWrite || 0);
  if (!record.timestamp || !Number.isFinite(record.timestamp) || !Number.isFinite(billable) || billable <= 0) return null;
  if (typeof record.model !== 'string' || typeof record.provider !== 'string') return null;
  record.id = usageRecordId(record);
  record.input ||= 0;
  record.output ||= 0;
  record.reasoning = Number.isFinite(record.reasoning) ? record.reasoning : 0;
  record.cacheRead ||= 0;
  record.cacheWrite ||= 0;
  if (typeof record.estimatedCostUsd !== 'number' || !Number.isFinite(record.estimatedCostUsd) || record.estimatedCostUsd <= 0) {
    record.estimatedCostUsd = undefined;
    record.estimatedCostUsd = estimateCost(record);
  }
  return record as PreparedUsageRecord;
}

interface UsageSource {
  format: UsageLogFormat;
  roots: string[];
  harnessName?: string;
  harnessSourceId?: string;
  status: ScanSourceStatus;
  errors: number;
}

type ReconcileUsage = (records: TokenUsageRecord[]) => TokenUsageRecord[];

function isDirectory(root: string): boolean {
  try { return fsSync.statSync(root).isDirectory(); } catch { return false; }
}

function createSource(format: UsageLogFormat, id: string, label: string, roots: string[], harnessSourceId?: string): UsageSource {
  return {
    format,
    roots,
    harnessName: harnessSourceId ? label : undefined,
    harnessSourceId,
    status: {
      id, label, path: roots.join('，'),
      exists: roots.some(isDirectory),
      filesScanned: 0, records: 0,
    },
    errors: 0,
  };
}

function canonicalRoot(root: string): string {
  try { return fsSync.realpathSync.native(root); } catch { return root; }
}

function findSource(file: string, sources: UsageSource[]): UsageSource | undefined {
  let closest: UsageSource | undefined;
  let closestLength = -1;
  for (const source of sources) {
    for (const root of source.roots) {
      const relative = path.relative(root, file);
      if (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && root.length > closestLength) {
        closest = source;
        closestLength = root.length;
      }
    }
  }
  return closest;
}

class UsageStore {
  private records: TokenUsageRecord[] = [];
  private lastSyncTime = 0;
  private inflightSync: Promise<number> | null = null;
  private inflightPaths: RuntimePaths | null = null;
  private scanSources: ScanSourceStatus[] = [];
  private pendingSources: ScanSourceStatus[] = [];
  private activeSourceCount = 0;
  private readonly scanListeners = new Set<(progress: UsageScanProgress) => void>();
  private readonly fileCaches: Record<SessionFileFormat, Map<string, CachedSessionFile>> = {
    codex: new Map(),
    pi: new Map(),
    grok: new Map(),
  };

  private noteSource(status: ScanSourceStatus): void {
    this.pendingSources.push(status);
    this.publishScanProgress();
  }

  private scanProgress(): UsageScanProgress {
    return {
      running: this.activeSourceCount > 0,
      completedSources: this.activeSourceCount > 0 ? this.pendingSources.length : 0,
      totalSources: this.activeSourceCount,
      lastSyncTime: this.lastSyncTime,
    };
  }

  private publishScanProgress(): void {
    if (this.scanListeners.size === 0) return;
    const progress = this.scanProgress();
    for (const listener of this.scanListeners) listener(progress);
  }

  public subscribeScanProgress(listener: (progress: UsageScanProgress) => void): () => void {
    this.scanListeners.add(listener);
    listener(this.scanProgress());
    return () => { this.scanListeners.delete(listener); };
  }

  public async sync(reconcile: ReconcileUsage): Promise<number> {
    const paths = CONFIG.paths;
    if (this.inflightSync) {
      if (this.inflightPaths === paths) return this.inflightSync;
      // A save during a scan must collect the updated directories before reporting success.
      await this.inflightSync.catch(() => {});
      return this.sync(reconcile);
    }
    this.inflightPaths = paths;
    this.inflightSync = this.runSync(paths, reconcile).finally(() => {
      this.inflightSync = null;
      this.inflightPaths = null;
      this.activeSourceCount = 0;
      this.publishScanProgress();
    });
    return this.inflightSync;
  }

  private async runSync(paths: RuntimePaths, reconcile: ReconcileUsage): Promise<number> {
    const loadedRecords: TokenUsageRecord[] = [];
    const seenSignatures = new Set<string>();
    this.pendingSources = [];

    const addRecord = (record: PreparedUsageRecord, source: UsageSource): void => {
      if (seenSignatures.has(record.id)) return;
      seenSignatures.add(record.id);
      const { harnessName, harnessSourceId } = source;
      loadedRecords.push(harnessSourceId ? { ...record, harnessName, harnessSourceId } : record);
      source.status.records += 1;
    };

    const builtins = [
      createSource('pi', 'pi-session', 'Pi 会话', [path.join(paths.piAgent, 'sessions')]),
      createSource('grok', 'grok', 'Grok 会话', [paths.grokSessions]),
      createSource('codex', 'codex', 'Codex 会话', [paths.codexSessions]),
      createSource('claude', 'claude', 'Claude 对话', paths.claudeProjectsAll),
      createSource('antigravity', 'antigravity', 'Antigravity 会话', paths.antigravityBrainAll),
    ];
    const custom = paths.customUsageSources.map((source) =>
      createSource(source.format, `custom:${source.id}`, source.harnessName, source.roots, source.id));
    this.activeSourceCount = builtins.length + custom.length;
    this.publishScanProgress();
    await Promise.all(builtins.map((builtin) => {
      const matching = custom.filter((source) => source.format === builtin.format);
      const group = [builtin, ...matching];
      if (matching.length > 0) {
        for (const source of group) source.roots = source.roots.map(canonicalRoot);
      }
      return this.scanGroup(group, addRecord);
    }));

    this.records = reconcile(loadedRecords);
    this.scanSources = this.pendingSources;
    this.lastSyncTime = Date.now();
    return this.records.length;
  }

  private async scanGroup(sources: UsageSource[], addRecord: (record: PreparedUsageRecord, source: UsageSource) => void): Promise<void> {
    const [builtin, ...custom] = sources;
    const format = builtin.format;
    const directories = Array.from(new Set(sources.flatMap((source) => source.roots)));
    const owners = new Map<string, UsageSource>();
    const observer: UsageScanObserver = {
      onFile: (file) => {
        const source = findSource(file, custom) ?? builtin;
        owners.set(file, source);
        source.status.filesScanned += 1;
      },
      onFileError: (file) => {
        const source = owners.get(file) ?? builtin;
        source.errors += 1;
      },
      onRecord: (record, file) => {
        const prepared = prepareRecord(record);
        if (prepared) addRecord(prepared, owners.get(file) ?? builtin);
      },
    };
    try {
      if (format === 'claude' || format === 'antigravity') {
        const result = format === 'claude'
          ? scanClaudeConversations(directories, observer)
          : scanAntigravitySessions(directories, observer);
        for (const source of sources) {
          if (!source.status.exists) continue;
          source.status.noteCodes = ['dedupe'];
          if (result.truncated) {
            const note = custom.length > 0 ? 'format-truncated' : 'truncated';
            source.status.noteCodes.push(`${note}:${result.filesScanned}`);
          }
        }
      } else {
        await this.scanSessionFiles(format, builtin, custom, addRecord);
      }
    } catch (error) {
      for (const source of sources) source.status.note = (error as Error).message;
    }
    for (const source of sources) {
      const { status } = source;
      if (source.errors) (status.noteCodes ??= []).push(`errors:${source.errors}`);
      if (source.harnessName && status.exists && status.records === 0 && !status.note) {
        (status.noteCodes ??= []).push('no-usage');
      }
      this.noteSource(status);
    }
  }

  private async scanSessionFiles(
    format: SessionFileFormat,
    builtin: UsageSource,
    custom: UsageSource[],
    addRecord: (record: PreparedUsageRecord, source: UsageSource) => void,
  ): Promise<void> {
    const scanner = FILE_READERS[format];
    const roots = new Set([...custom, builtin].flatMap((source) => source.roots));
    const files = new Map<string, SessionFile>();
    for (const root of roots) {
      for (const file of findRecentFiles(root, scanner.matches, scanner.limit)) files.set(file.path, file);
    }
    const cache = this.fileCaches[format];
    for (const file of cache.keys()) {
      if (!files.has(file)) cache.delete(file);
    }

    for (const [file, { version }] of files) {
      const source = findSource(file, custom) ?? builtin;
      source.status.filesScanned += 1;
      const cached = cache.get(file);
      if (cached?.version === version) {
        for (const record of cached.records) addRecord(record, source);
        continue;
      }

      cache.delete(file);
      const records: PreparedUsageRecord[] = [];
      try {
        for await (const record of await scanner.read(file)) {
          const prepared = prepareRecord(record);
          if (!prepared) continue;
          records.push(prepared);
          addRecord(prepared, source);
        }
        cache.set(file, { version, records });
      } catch {
        source.errors += 1;
      }
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
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        estimatedCostUsd: 0,
        requestCount: 0,
        ttftMedianMs: null,
        tokensPerSecondMedian: null,
        ttftSamples: 0,
        speedSamples: 0,
      });
    }

    const byDay = new Map<string, TokenUsageRecord[]>();
    for (const record of source) {
      const dateStr = localDateKey(new Date(record.timestamp));
      const point = map.get(dateStr);
      if (!point) continue;
      point.totalTokens += record.totalTokens || 0;
      point.inputTokens += record.input || 0;
      point.outputTokens += record.output || 0;
      point.cacheReadTokens += record.cacheRead || 0;
      point.cacheWriteTokens += record.cacheWrite || 0;
      point.reasoningTokens += record.reasoning || 0;
      point.estimatedCostUsd += record.estimatedCostUsd || 0;
      point.requestCount += 1;
      const bucket = byDay.get(dateStr);
      if (bucket) bucket.push(record);
      else byDay.set(dateStr, [record]);
    }

    for (const point of map.values()) {
      Object.assign(point, speedWindow(byDay.get(point.date) ?? []));
    }

    return Array.from(map.values());
  }

  private groupRecords(records: TokenUsageRecord[], getKey: (record: TokenUsageRecord) => string): GroupedUsage[] {
    const totalAllTokens = records.reduce((sum, record) => sum + (record.totalTokens || 0), 0) || 1;
    const map = new Map<string, GroupedUsage>();
    const buckets = new Map<string, TokenUsageRecord[]>();

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
        buckets.set(name, []);
      }
      item.totalTokens += record.totalTokens || 0;
      item.inputTokens += record.input || 0;
      item.outputTokens += record.output || 0;
      item.reasoningTokens += record.reasoning || 0;
      item.estimatedCostUsd += record.estimatedCostUsd || 0;
      item.requestCount += 1;
      buckets.get(name)?.push(record);
    }

    const result = Array.from(map.values()).sort((a, b) => b.totalTokens - a.totalTokens);
    for (const item of result) {
      item.percentage = Number(((item.totalTokens / totalAllTokens) * 100).toFixed(1));
      Object.assign(item, speedWindow(buckets.get(item.name) ?? []));
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
    return this.groupRecords(this.selectRecords(range, options), usageClientName);
  }

  public getSpeed(range: UsageRange = '7d', options?: UsageQueryOptions): SpeedReport {
    return summarizeSpeed(this.selectRecords(range, options));
  }

  public getRecentRecords(limit = 50, range: UsageRange = 'all', options?: UsageQueryOptions): TokenUsageRecord[] {
    const source = this.selectRecords(range, options);
    return source.slice(0, Math.min(200, Math.max(1, limit)));
  }

  public getAllRecords(): TokenUsageRecord[] {
    return this.records;
  }

  public getLastSyncTime(): number {
    return this.lastSyncTime;
  }

  public getScanReport(): ScanReport {
    return {
      lastSyncTime: this.lastSyncTime,
      recordCount: this.records.length,
      sources: this.scanSources,
    };
  }
}

export const usageStore = new UsageStore();
