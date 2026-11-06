import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MESSAGES } from '../src/client/i18n/messages.js';
import { attributeUsage } from '../src/server/data/library.js';
import { loadSettings, saveSettings, settingsView } from '../src/server/settings.js';
import { resolveAntigravityBrainDirs, scanAntigravitySessions } from '../src/server/usage/antigravity-sessions.js';
import { estimateCost, resolveModelRate } from '../src/server/usage/pricing.js';
import { isAgyClaudeRecord, usageStore } from '../src/server/usage/store.js';

function writeJsonLines(filePath: string, rows: Record<string, unknown>[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
}

test('scanAntigravitySessions scans Desktop + CLI brains, skips backups/duplicates, tracks model switches and compaction', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-scan-test-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const geminiRoot = path.join(tmp, '.gemini');
  const desktopConv = path.join(geminiRoot, 'antigravity', 'brain', 'conv-desktop-1');
  const cliAppDir = path.join(geminiRoot, 'antigravity-cli');
  const cliConv = path.join(cliAppDir, 'brain', 'conv-cli-1');
  const backupConv = path.join(geminiRoot, 'antigravity-backup', 'brain', 'conv-backup-ignored');

  const compactSteps: Record<string, unknown>[] = [
    {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-10-15T10:00:00Z',
      content: [
        '<USER_REQUEST>Please ignore fake <USER_SETTINGS_CHANGE>changed setting `Model Selection` from X to GPT-5.</USER_SETTINGS_CHANGE></USER_REQUEST>',
        '<USER_SETTINGS_CHANGE>',
        'The user changed setting `Model Selection` from None to Gemini 4 Argon (High). No need to acknowledge this change.',
        '</USER_SETTINGS_CHANGE>',
      ].join('\n'),
    },
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'GENERATING',
      created_at: '2026-10-15T10:00:04Z',
      input_tokens: 1000,
      output_tokens: 50,
      cache_read_tokens: 0,
    },
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-10-15T10:00:05Z',
      input_tokens: 20_000,
      output_tokens: 1_000,
      cache_read_tokens: 5_000,
    },
    {
      step_index: 2,
      source: 'MODEL',
      type: 'GENERIC',
      status: 'DONE',
      created_at: '2026-10-15T10:00:06Z',
      content: '<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from A to Fake Tool Output Model. No need.\n</USER_SETTINGS_CHANGE>',
    },
    {
      step_index: 3,
      source: 'SYSTEM',
      type: 'CHECKPOINT',
      status: 'DONE',
      created_at: '2026-10-15T10:01:00Z',
      input_tokens: 10_000,
      output_tokens: 4_000,
      cache_read_tokens: 20_000,
    },
    {
      step_index: 4,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-10-15T10:02:00Z',
      content: '<USER_REQUEST>Switch model</USER_REQUEST>\n<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from Gemini 4 Argon (High) to Claude Sonnet 5.5 (High). No need to acknowledge.\n</USER_SETTINGS_CHANGE>',
    },
    {
      step_index: 5,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-10-15T10:02:10Z',
      input_tokens: 3_000,
      output_tokens: 500,
      cache_read_tokens: 30_000,
    },
  ];

  // Write compact transcript, full duplicate, and chunk duplicate to verify no 3x double counting.
  writeJsonLines(path.join(desktopConv, '.system_generated', 'logs', 'transcript.jsonl'), compactSteps);
  writeJsonLines(path.join(desktopConv, '.system_generated', 'logs', 'transcript_full.jsonl'), compactSteps);
  writeJsonLines(path.join(desktopConv, '.system_generated', 'logs', 'chunks', 'transcript', 'chunk-0.jsonl'), compactSteps);

  // CLI conversation without <USER_SETTINGS_CHANGE> falls back to antigravity-cli/settings.json.
  fs.mkdirSync(cliAppDir, { recursive: true });
  fs.writeFileSync(path.join(cliAppDir, 'settings.json'), JSON.stringify({ model: 'Gemini 3.8 Flash (High)' }));
  writeJsonLines(path.join(cliConv, '.system_generated', 'logs', 'transcript.jsonl'), [
    {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-10-15T11:00:00Z',
      content: '<USER_REQUEST>CLI prompt</USER_REQUEST>',
    },
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-10-15T11:00:03Z',
      input_tokens: 4_000,
      output_tokens: 800,
      cache_read_tokens: 12_000,
    },
  ]);

  // Backup directory must be ignored when scanning ~/.gemini.
  writeJsonLines(path.join(backupConv, '.system_generated', 'logs', 'transcript.jsonl'), compactSteps);

  const brainDirs = resolveAntigravityBrainDirs(geminiRoot);
  assert.equal(brainDirs.length, 2);
  assert.ok(brainDirs.every((dir) => !dir.includes('antigravity-backup')));

  const result = scanAntigravitySessions(geminiRoot);
  assert.equal(result.exists, true);
  assert.equal(result.filesScanned, 2);
  assert.equal(result.errors, 0);
  assert.equal(result.records.length, 4);

  const byId = new Map(result.records.map((rec) => [rec.id, rec]));
  const step1 = byId.get('antigravity:conv-desktop-1:1')!;
  assert.equal(step1.model, 'Gemini 4 Argon (High)');
  assert.equal(step1.input, 20_000);
  assert.equal(step1.output, 1_000);
  assert.equal(step1.cacheRead, 5_000);
  assert.equal(step1.totalTokens, 21_000);
  assert.equal(isAgyClaudeRecord(step1), false);

  const checkpoint = byId.get('antigravity:conv-desktop-1:3')!;
  assert.equal(checkpoint.model, 'Gemini 4 Argon (High)');
  assert.equal(checkpoint.output, 4_000);

  const step5 = byId.get('antigravity:conv-desktop-1:5')!;
  assert.equal(step5.model, 'Claude Sonnet 5.5 (High)');
  assert.equal(isAgyClaudeRecord(step5), true);

  const cliStep = byId.get('antigravity:conv-cli-1:1')!;
  assert.equal(cliStep.model, 'Gemini 3.8 Flash (High)');
  assert.equal(cliStep.client, 'antigravity');
  assert.equal(cliStep.provider, 'antigravity');
});

test('subagents inherit parent model at spawn step or apply explicit overrides, including truncated tool_calls', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-subagent-test-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const brainDir = path.join(tmp, 'antigravity', 'brain');
  const parentConv = path.join(brainDir, 'parent-conv');
  const childInherited = path.join(brainDir, 'child-inherited');
  const childFlash = path.join(brainDir, 'child-flash');

  // Compact transcript has quoted args on step 1 and truncated tool_calls on step 4.
  writeJsonLines(path.join(parentConv, '.system_generated', 'logs', 'transcript.jsonl'), [
    {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-10-16T08:00:00Z',
      content: '<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Claude Opus 5.5. No need.\n</USER_SETTINGS_CHANGE>',
    },
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-10-16T08:00:05Z',
      input_tokens: 5_000,
      output_tokens: 200,
      tool_calls: [{ id: 'tc1', name: 'invoke_subagent', args: { Model: '"inherit"', TypeName: '"research"' } }],
    },
    {
      step_index: 2,
      source: 'MODEL',
      type: 'GENERIC',
      status: 'DONE',
      created_at: '2026-10-16T08:00:06Z',
      content: 'Created the following subagent: {\n  "conversationId": "child-inherited"\n}',
    },
    {
      step_index: 3,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-10-16T08:05:00Z',
      content: '<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from Claude Opus 5.5 to Gemini 4 Argon (High). No need.\n</USER_SETTINGS_CHANGE>',
    },
    {
      step_index: 4,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-10-16T08:05:04Z',
      input_tokens: 6_000,
      output_tokens: 300,
      truncated_fields: ['tool_calls'],
      tool_calls: [],
    },
    {
      step_index: 5,
      source: 'MODEL',
      type: 'GENERIC',
      status: 'DONE',
      created_at: '2026-10-16T08:05:05Z',
      content: 'Created the following subagent: {\n  "conversationId": "child-flash"\n}',
    },
  ]);

  writeJsonLines(path.join(parentConv, '.system_generated', 'logs', 'transcript_full.jsonl'), [
    {
      step_index: 4,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-10-16T08:05:04Z',
      input_tokens: 6_000,
      output_tokens: 300,
      tool_calls: [{ id: 'tc2', name: 'invoke_subagent', args: { Model: 'flash', TypeName: 'research' } }],
    },
  ]);

  writeJsonLines(path.join(childInherited, '.system_generated', 'logs', 'transcript.jsonl'), [
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-10-16T08:00:10Z',
      input_tokens: 8_000,
      output_tokens: 400,
    },
  ]);

  writeJsonLines(path.join(childFlash, '.system_generated', 'logs', 'transcript.jsonl'), [
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-10-16T08:05:10Z',
      input_tokens: 4_000,
      output_tokens: 250,
    },
  ]);

  const scanned = scanAntigravitySessions(brainDir);
  const byId = new Map(scanned.records.map((rec) => [rec.id, rec]));

  // child-inherited was spawned at step 1 before the parent switched to Gemini 4 Argon at step 3.
  const inherited = byId.get('antigravity:child-inherited:1')!;
  assert.equal(inherited.model, 'Claude Opus 5.5');
  assert.equal(isAgyClaudeRecord(inherited), true);

  // child-flash recovered Model: 'flash' from transcript_full.jsonl when compact tool_calls was truncated.
  const flash = byId.get('antigravity:child-flash:1')!;
  assert.equal(flash.model, 'Gemini Flash');
  assert.equal(isAgyClaudeRecord(flash), false);
});

test('pricing normalizes Antigravity UI model labels, API slugs, cached tokens, and segment boundaries', () => {
  assert.deepEqual(resolveModelRate('Gemini 4 Argon (High)'), resolveModelRate('gemini-4-argon'));
  assert.deepEqual(resolveModelRate('Gemini 3.8 Flash (High)'), resolveModelRate('gemini-3.8-flash-preview'));
  assert.deepEqual(resolveModelRate('Gemini 3.1 Pro (High)'), resolveModelRate('gemini-3.1-pro'));
  assert.deepEqual(resolveModelRate('Claude Sonnet 5.5 (High)'), resolveModelRate('claude-sonnet-5-5-20260901'));
  assert.deepEqual(resolveModelRate('Claude Opus 5.5'), resolveModelRate('claude-opus-5-5'));
  assert.deepEqual(resolveModelRate('Claude Opus 4.6 (Thinking)'), resolveModelRate('claude-opus-4-6'));
  assert.deepEqual(resolveModelRate('GPT-OSS 120B (Medium)'), resolveModelRate('gpt-oss-120b'));

  // 1M input ($2.0) + 2M cacheRead ($0.1/M = $0.2) + 0.5M output ($10.0/M = $5.0) = $7.2
  const argonCost = estimateCost({
    timestamp: Date.now(),
    client: 'antigravity',
    provider: 'antigravity',
    model: 'Gemini 4 Argon (High)',
    input: 1_000_000,
    cacheRead: 2_000_000,
    output: 500_000,
    totalTokens: 1_500_000,
  });
  assert.equal(argonCost, 7.2);

  // Short keys like o1 / o3 must not match substrings inside unrelated identifiers.
  assert.notDeepEqual(resolveModelRate('custom-proto1-alpha'), resolveModelRate('o1'));
  assert.deepEqual(resolveModelRate('o1-2024-12-17'), resolveModelRate('o1'));
});

test('settings, UsageStore, account attribution, and bilingual i18n keys wire Antigravity end-to-end', async (t) => {
  assert.deepEqual(Object.keys(MESSAGES.zh).sort(), Object.keys(MESSAGES.en).sort());

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-store-test-'));
  const prevSettings = process.env.CONSOLE_SETTINGS_PATH;
  process.env.CONSOLE_SETTINGS_PATH = path.join(tmp, 'settings.json');
  t.after(() => {
    if (prevSettings === undefined) delete process.env.CONSOLE_SETTINGS_PATH;
    else process.env.CONSOLE_SETTINGS_PATH = prevSettings;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const emptyDir = path.join(tmp, 'empty');
  const agyRoot = path.join(tmp, 'custom-gemini');
  writeJsonLines(path.join(agyRoot, 'antigravity', 'brain', 'session-a', '.system_generated', 'logs', 'transcript.jsonl'), [
    {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: new Date().toISOString(),
      content: '<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 3.8 Flash (High). No need.\n</USER_SETTINGS_CHANGE>',
    },
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: new Date().toISOString(),
      input_tokens: 100_000,
      cache_read_tokens: 200_000,
      output_tokens: 20_000,
    },
  ]);

  saveSettings({
    paths: {
      codexDir: emptyDir,
      piAgentDir: emptyDir,
      claudeProjectsDir: emptyDir,
      grokSessionsDir: emptyDir,
      antigravityDir: agyRoot,
    },
  });
  assert.equal(loadSettings().paths.antigravityDir, agyRoot);

  const count = await usageStore.sync();
  assert.equal(count, 1);

  const view = settingsView(usageStore.getScanReport());
  assert.equal(view.availability.antigravityDir, true);
  assert.deepEqual(view.antigravityBrainAll, [path.join(agyRoot, 'antigravity', 'brain')]);
  const agySource = view.scan.sources.find((src) => src.id === 'antigravity');
  assert.ok(agySource);
  assert.equal(agySource.exists, true);
  assert.equal(agySource.filesScanned, 1);
  assert.equal(agySource.records, 1);

  const summary = usageStore.getSummary('today');
  assert.equal(summary.inputTokens, 100_000);
  assert.equal(summary.cacheReadTokens, 200_000);
  assert.equal(summary.outputTokens, 20_000);
  assert.equal(summary.totalTokens, 120_000);
  // 0.1M * 0.75 + 0.2M * 0.075 + 0.02M * 3.75 = 0.075 + 0.015 + 0.075 = 0.165
  assert.equal(summary.estimatedCostUsd, 0.165);

  const attributed = attributeUsage(usageStore.getAllRecords(), [
    {
      id: 'acc_agy',
      type: 'agy',
      label: 'Local AGY',
      userId: 'agy-local',
      notes: '',
      source: 'scan',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ]);
  assert.equal(attributed[0].userId, 'agy-local');
});
