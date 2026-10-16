import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCodexSession } from '../src/server/usage/codex-sessions.js';
import { measureSplitSpeed, percentile, speedWindow, summarizeSpeed } from '../src/server/usage/speed.js';
import type { TokenUsageRecord } from '../src/server/usage/types.js';

function line(value: unknown): string {
  return JSON.stringify(value);
}

function turn(id: string, model: string, output: number, durationMs: number, ttftMs: number, tool = false): string[] {
  const usage = {
    input_tokens: 100,
    output_tokens: output,
    reasoning_output_tokens: 40,
    total_tokens: 100 + output,
  };
  return [
    line({ timestamp: '2026-10-11T13:54:42.530Z', type: 'event_msg', payload: { type: 'task_started', turn_id: id } }),
    line({ timestamp: '2026-10-11T13:54:42.531Z', type: 'turn_context', payload: { model } }),
    ...(tool ? [line({ timestamp: '2026-10-11T13:54:43.000Z', type: 'response_item', payload: { type: 'function_call' } })] : []),
    line({ timestamp: '2026-10-11T13:54:45.853Z', type: 'token_usage_record', payload: { turn_id: id, usage } }),
    line({ timestamp: '2026-10-11T13:54:45.854Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: usage } } }),
    line({
      timestamp: '2026-10-11T13:54:45.855Z',
      type: 'event_msg',
      payload: { type: 'task_complete', turn_id: id, duration_ms: durationMs, time_to_first_token_ms: ttftMs },
    }),
  ];
}

test('clean Codex turns keep time-to-first-token and output window separate', () => {
  const [clean, tooled, shortOutput] = [
    ...parseCodexSession(turn('clean', 'gpt-6-sol', 100, 3324, 2915)),
    ...parseCodexSession(turn('tools', 'gpt-6-sol', 100, 151001, 3000, true)),
    ...parseCodexSession(turn('short', 'gpt-6-luna', 10, 4000, 1000)),
  ];

  assert.equal(clean.ttftMs, 2915);
  assert.equal(clean.decodeMs, 409);
  assert.equal(clean.output, 100);
  assert.equal(clean.reasoning, 40);
  assert.equal(tooled.ttftMs, undefined);
  assert.equal(tooled.decodeMs, undefined);
  assert.equal(shortOutput.ttftMs, 1000);
  assert.equal(shortOutput.decodeMs, undefined);

  const report = summarizeSpeed([clean, tooled, shortOutput]);
  assert.equal(report.ttftSamples, 2);
  assert.equal(report.speedSamples, 1);
  assert.equal(report.tokensPerSecondMedian, 100 / (409 / 1000));
});

test('a tool call does not poison the next turn, and unusable windows are dropped', () => {
  const records = parseCodexSession([
    ...turn('tools', 'gpt-6-sol', 80, 20000, 3000, true),
    ...turn('after', 'gpt-6-luna', 80, 5000, 2000),
  ]);
  assert.equal(records[0].model, 'gpt-6-sol');
  assert.equal(records[0].ttftMs, undefined);
  assert.equal(records[1].model, 'gpt-6-luna');
  assert.equal(records[1].ttftMs, 2000);
  assert.equal(records[1].decodeMs, 3000);

  assert.deepEqual(measureSplitSpeed({ durationMs: 1000, ttftMs: 1500, outputTokens: 100, hasTools: false }), {});
  assert.deepEqual(measureSplitSpeed({ durationMs: 1000, ttftMs: 16 * 60 * 1000, outputTokens: 100, hasTools: false }), {});
  assert.deepEqual(measureSplitSpeed({ durationMs: 2100, ttftMs: 2000, outputTokens: 100, hasTools: false }), { ttftMs: 2000 });
});

test('a day keeps time-to-first-token and output speed as separate medians', () => {
  const window = speedWindow([
    { timestamp: 1, provider: 'openai-codex', model: 'a', input: 1, output: 100, totalTokens: 101, ttftMs: 1000, decodeMs: 1000 },
    { timestamp: 2, provider: 'openai-codex', model: 'a', input: 1, output: 50, totalTokens: 51, ttftMs: 3000, decodeMs: 500 },
    { timestamp: 3, provider: 'openai-codex', model: 'a', input: 1, output: 10, totalTokens: 11 },
  ]);
  assert.equal(window.ttftSamples, 2);
  assert.equal(window.speedSamples, 2);
  assert.equal(window.ttftMedianMs, 2000);
  assert.equal(window.tokensPerSecondMedian, 100);
  assert.deepEqual(speedWindow([]), { ttftMedianMs: null, tokensPerSecondMedian: null, ttftSamples: 0, speedSamples: 0 });
});

test('speed summary uses median and p90, not the mean', () => {
  const records: TokenUsageRecord[] = [100, 200, 300, 1000].map((ttftMs, index) => ({
    timestamp: index + 1,
    client: 'codex',
    provider: 'openai-codex',
    model: 'gpt-6-sol',
    input: 1,
    output: 100,
    totalTokens: 101,
    ttftMs,
    decodeMs: 1000,
  }));
  const report = summarizeSpeed(records);
  assert.equal(report.groups[0].ttftMedianMs, 250);
  assert.equal(report.groups[0].ttftP90Ms, percentile([100, 200, 300, 1000], 0.9));
  assert.equal(report.groups[0].tokensPerSecondMedian, 100);
  assert.equal(report.requestCount, 4);
});
