export const USAGE_LOG_FORMATS = ['codex', 'claude', 'pi', 'grok', 'antigravity'] as const;
export type UsageLogFormat = (typeof USAGE_LOG_FORMATS)[number];

export interface CustomUsageSource {
  id: string;
  harnessName: string;
  directory: string;
  format: UsageLogFormat;
}

export interface TokenUsageRecord {
  id?: string;
  timestamp: number;
  client?: string; // 'codex' | 'pi' | 'grokbuild' | 'claude' | 'antigravity' | 'gemini' | 'opencode'
  harnessName?: string;
  harnessSourceId?: string;
  provider: string; // 'openai-codex' | 'anthropic' | 'antigravity' | 'xai' | ...
  model: string;
  input: number;
  output: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  pricingAsOf?: string;
  source?: string;
  sessionId?: string;
  userId?: string;
  /** Wait from request start to the first token, including thinking. Absent when it cannot be separated. */
  ttftMs?: number;
  /** Generation window after the first token. Output speed is `output / (decodeMs / 1000)`. */
  decodeMs?: number;
}

export interface UsageScanObserver {
  onFile: (file: string) => void;
  onFileError: (file: string) => void;
  onRecord: (record: TokenUsageRecord, file: string) => void;
}

export function usageClientName(record: TokenUsageRecord): string {
  return record.harnessName || record.client || 'unknown';
}

export function usageRecordId(record: TokenUsageRecord): string {
  if (typeof record.id === 'string' && record.id) return record.id;
  return `${record.client ?? 'unknown'}_${record.timestamp}_${record.totalTokens}_${record.model}`;
}

export interface UsageSummary {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number;
  requestCount: number;
}

export interface UsageScanProgress {
  running: boolean;
  completedSources: number;
  totalSources: number;
  lastSyncTime: number;
}

export interface DailyTrendPoint {
  date: string; // YYYY-MM-DD
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  estimatedCostUsd: number;
  requestCount: number;
  /** Median wait until the first token. Null when that day has no split measurement. */
  ttftMedianMs: number | null;
  /** Median output tokens per second after the first token. Null when that day has none. */
  tokensPerSecondMedian: number | null;
  ttftSamples: number;
  speedSamples: number;
}

export interface ScanSourceStatus {
  id: string;
  label: string;
  path: string;
  exists: boolean;
  filesScanned: number;
  records: number;
  note?: string;
  /** Machine-readable notes the UI translates. */
  noteCodes?: string[];
}

export interface ScanReport {
  lastSyncTime: number;
  recordCount: number;
  sources: ScanSourceStatus[];
}

export interface GroupedUsage {
  name: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  estimatedCostUsd: number;
  requestCount: number;
  percentage: number;
  ttftMedianMs?: number | null;
  tokensPerSecondMedian?: number | null;
  ttftSamples?: number;
  speedSamples?: number;
}

export type UsageRange = 'today' | '7d' | '30d' | 'all';
