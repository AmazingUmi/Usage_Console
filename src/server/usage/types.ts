export interface TokenUsageRecord {
  id?: string;
  timestamp: number;
  client?: string; // 'codex' | 'pi' | 'grokbuild' | 'claude' | 'gemini' | 'opencode'
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
  /** Machine-readable notes (`dedupe`, `truncated:N`, `errors:N`) the UI translates. */
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
