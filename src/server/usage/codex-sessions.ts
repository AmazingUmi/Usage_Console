import type { TokenUsageRecord } from './types.js';
import { measureSplitSpeed } from './speed.js';

const TOOL_TYPE = /tool_call|function_call/i;

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

function numberOrZero(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function payloadOf(json: Record<string, unknown>): Record<string, unknown> | null {
  return json.payload && typeof json.payload === 'object' ? json.payload as Record<string, unknown> : null;
}

function itemType(payload: Record<string, unknown>): string {
  if (typeof payload.type === 'string') return payload.type;
  const item = payload.item;
  if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).type === 'string') {
    return (item as Record<string, unknown>).type as string;
  }
  return '';
}

/** One Codex rollout. Timing is attached only when the turn has no tool calls. */
export function parseCodexSession(lines: string[], sessionId?: string): TokenUsageRecord[] {
  let model = 'gpt-4o';
  let currentTurn: string | undefined;
  const tools = new Set<string>();
  let pendingTurn: string | undefined;
  const records: TokenUsageRecord[] = [];
  const indexByTurn = new Map<string, number>();

  for (const line of lines) {
    if (!line.trim()) continue;
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const payload = payloadOf(json);
    if (!payload) continue;

    if (json.type === 'turn_context' && typeof payload.model === 'string' && payload.model.trim()) {
      model = payload.model;
      continue;
    }
    if (json.type === 'event_msg' && payload.type === 'task_started' && typeof payload.turn_id === 'string') {
      currentTurn = payload.turn_id;
      continue;
    }
    if (json.type === 'response_item' && TOOL_TYPE.test(itemType(payload))) {
      const turnId = typeof payload.turn_id === 'string' ? payload.turn_id : currentTurn;
      if (turnId) tools.add(turnId);
      continue;
    }
    if (json.type === 'token_usage_record' && typeof payload.turn_id === 'string') {
      pendingTurn = payload.turn_id;
      continue;
    }
    if (json.type === 'event_msg' && payload.type === 'token_count') {
      const info = payload.info && typeof payload.info === 'object' ? payload.info as Record<string, unknown> : null;
      const usage = info?.last_token_usage && typeof info.last_token_usage === 'object'
        ? info.last_token_usage as Record<string, unknown>
        : null;
      if (!usage) continue;
      const turnId = pendingTurn;
      pendingTurn = undefined;
      const input = numberOrZero(usage.input_tokens);
      const output = numberOrZero(usage.output_tokens);
      records.push({
        timestamp: toEpoch(json.timestamp),
        client: 'codex',
        provider: 'openai-codex',
        model,
        input,
        output,
        reasoning: numberOrZero(usage.reasoning_output_tokens),
        cacheRead: numberOrZero(usage.cached_input_tokens),
        totalTokens: numberOrZero(usage.total_tokens) || (input + output),
        source: 'codex-session',
        sessionId,
      });
      if (turnId) indexByTurn.set(turnId, records.length - 1);
      continue;
    }
    if (json.type === 'event_msg' && payload.type === 'task_complete' && typeof payload.turn_id === 'string') {
      const index = indexByTurn.get(payload.turn_id);
      if (currentTurn === payload.turn_id) currentTurn = undefined;
      if (index == null) continue;
      const measured = measureSplitSpeed({
        durationMs: payload.duration_ms,
        ttftMs: payload.time_to_first_token_ms,
        outputTokens: records[index].output,
        hasTools: tools.has(payload.turn_id),
      });
      if (measured.ttftMs != null) records[index].ttftMs = measured.ttftMs;
      if (measured.decodeMs != null) records[index].decodeMs = measured.decodeMs;
    }
  }

  return records;
}
