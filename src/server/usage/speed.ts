import type { TokenUsageRecord } from './types.js';

/** Ignore tiny completions; their rate is mostly timer noise. */
export const MIN_SPEED_TOKENS = 32;
/** Ignore a generation window shorter than this; dividing by it explodes the rate. */
export const MIN_DECODE_MS = 200;
/** A longer wait is a stuck turn, not thinking time. */
export const MAX_TTFT_MS = 15 * 60 * 1000;

export interface SpeedGroup {
  model: string;
  client: string;
  ttftSamples: number;
  speedSamples: number;
  ttftMedianMs: number | null;
  ttftP90Ms: number | null;
  tokensPerSecondMedian: number | null;
  tokensPerSecondP90: number | null;
}

export interface SpeedReport {
  ttftSamples: number;
  speedSamples: number;
  requestCount: number;
  ttftMedianMs: number | null;
  tokensPerSecondMedian: number | null;
  groups: SpeedGroup[];
}

function positive(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Split one call into time-to-first-token and the generation window after it.
 * Tool turns are dropped: their duration includes tool execution, so neither number is model time.
 * Output speed is not computed here; the caller divides output tokens by `decodeMs`.
 */
export function measureSplitSpeed(input: {
  durationMs: unknown;
  ttftMs: unknown;
  outputTokens: unknown;
  hasTools: boolean;
}): { ttftMs?: number; decodeMs?: number } {
  if (input.hasTools) return {};
  const duration = positive(input.durationMs);
  const ttft = positive(input.ttftMs);
  const output = positive(input.outputTokens);
  const result: { ttftMs?: number; decodeMs?: number } = {};
  if (ttft != null && ttft <= MAX_TTFT_MS && (duration == null || ttft < duration)) {
    result.ttftMs = Math.round(ttft);
  }
  if (result.ttftMs != null && duration != null && output != null && output >= MIN_SPEED_TOKENS) {
    const decode = duration - result.ttftMs;
    if (decode >= MIN_DECODE_MS) result.decodeMs = Math.round(decode);
  }
  return result;
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (sorted.length - 1) * p;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

function tokensPerSecond(record: TokenUsageRecord): number | null {
  const decode = positive(record.decodeMs);
  const output = positive(record.output);
  if (decode == null || output == null) return null;
  const rate = output / (decode / 1000);
  return Number.isFinite(rate) ? rate : null;
}

/** One day's medians. Records without a split measurement contribute to neither side. */
export function speedWindow(records: TokenUsageRecord[]): {
  ttftMedianMs: number | null;
  tokensPerSecondMedian: number | null;
  ttftSamples: number;
  speedSamples: number;
} {
  const ttfts: number[] = [];
  const speeds: number[] = [];
  for (const record of records) {
    const ttft = positive(record.ttftMs);
    const speed = tokensPerSecond(record);
    if (ttft != null) ttfts.push(ttft);
    if (speed != null) speeds.push(speed);
  }
  return {
    ttftMedianMs: percentile(ttfts, 0.5),
    tokensPerSecondMedian: percentile(speeds, 0.5),
    ttftSamples: ttfts.length,
    speedSamples: speeds.length,
  };
}

export function summarizeSpeed(records: TokenUsageRecord[]): SpeedReport {
  const ttftValues: number[] = [];
  const speedValues: number[] = [];
  const groups = new Map<string, { model: string; client: string; ttfts: number[]; speeds: number[] }>();

  for (const record of records) {
    const ttft = positive(record.ttftMs);
    const speed = tokensPerSecond(record);
    if (ttft == null && speed == null) continue;
    const client = record.client || 'unknown';
    const model = record.model || 'unknown';
    const key = `${client}\0${model}`;
    let group = groups.get(key);
    if (!group) {
      group = { model, client, ttfts: [], speeds: [] };
      groups.set(key, group);
    }
    if (ttft != null) {
      ttftValues.push(ttft);
      group.ttfts.push(ttft);
    }
    if (speed != null) {
      speedValues.push(speed);
      group.speeds.push(speed);
    }
  }

  const listed = Array.from(groups.values()).map((group): SpeedGroup => ({
    model: group.model,
    client: group.client,
    ttftSamples: group.ttfts.length,
    speedSamples: group.speeds.length,
    ttftMedianMs: percentile(group.ttfts, 0.5),
    ttftP90Ms: percentile(group.ttfts, 0.9),
    tokensPerSecondMedian: percentile(group.speeds, 0.5),
    tokensPerSecondP90: percentile(group.speeds, 0.9),
  }));
  listed.sort((a, b) => b.speedSamples - a.speedSamples || b.ttftSamples - a.ttftSamples || a.model.localeCompare(b.model));

  return {
    ttftSamples: ttftValues.length,
    speedSamples: speedValues.length,
    requestCount: records.length,
    ttftMedianMs: percentile(ttftValues, 0.5),
    tokensPerSecondMedian: percentile(speedValues, 0.5),
    groups: listed,
  };
}
