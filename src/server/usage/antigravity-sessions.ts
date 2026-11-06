import fs from 'node:fs';
import path from 'node:path';
import type { TokenUsageRecord } from './types.js';

const MAX_FILES = 4000;
const MAX_FILE_BYTES = 80 * 1024 * 1024;
const KNOWN_APP_SUBDIRS = ['antigravity', 'antigravity-cli', 'antigravity-ide'] as const;

const USER_REQUEST_BLOCK_RE = /<USER_REQUEST>[\s\S]*?<\/USER_REQUEST>/g;
const SETTINGS_BLOCK_RE = /<USER_SETTINGS_CHANGE>([\s\S]*?)<\/USER_SETTINGS_CHANGE>/g;
const MODEL_SELECTION_RE = /changed setting `Model Selection` from [^\r\n]+? to ([^\r\n]+?)\.(?:\s|$)/g;
const SUBAGENT_CREATED_RE = /Created the following subagent:\s*\{[\s\S]*?"conversationId"\s*:\s*"([^"]+)"/;

interface ModelChange {
  stepIndex: number;
  model: string;
}

interface SubagentSpawn {
  childConversationId: string;
  parentConversationId: string;
  parentStepIndex: number;
  modelArg?: string;
}

interface ParsedAntigravityStep {
  stepIndex: number;
  timestamp: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  explicitModel?: string;
  isDone: boolean;
}

interface ParsedConversation {
  conversationId: string;
  appDataDir: string;
  steps: ParsedAntigravityStep[];
  modelChanges: ModelChange[];
  subagents: SubagentSpawn[];
}

interface FileCacheEntry {
  mtimeMs: number;
  size: number;
  fullMtimeMs: number;
  fullSize: number;
  conversation: ParsedConversation;
}

const fileCache = new Map<string, FileCacheEntry>();

export interface AntigravityScanResult {
  records: TokenUsageRecord[];
  filesScanned: number;
  exists: boolean;
  truncated: boolean;
  errors: number;
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function toEpoch(value: unknown): number | null {
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
  return null;
}

function asCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

function pickTranscriptFile(convDir: string): string | null {
  const logsDir = path.join(convDir, '.system_generated', 'logs');
  const compact = path.join(logsDir, 'transcript.jsonl');
  try {
    if (fs.statSync(compact).isFile()) return compact;
  } catch {}
  const full = path.join(logsDir, 'transcript_full.jsonl');
  try {
    if (fs.statSync(full).isFile()) return full;
  } catch {}
  return null;
}

/**
 * Resolves a configured path (`~/.gemini`, `~/.gemini/antigravity`, a `brain` folder, or a single conversation dir)
 * to the concrete `brain` directories (or conversation dirs) to scan, skipping unrelated backup directories.
 */
export function resolveAntigravityBrainDirs(configuredDir: string): string[] {
  const root = configuredDir.trim();
  if (!root) return [];

  if (pickTranscriptFile(root)) return [path.resolve(root)];

  const directBrain = path.join(root, 'brain');
  if (isDirectory(directBrain) || (KNOWN_APP_SUBDIRS as readonly string[]).includes(path.basename(root))) {
    return [path.resolve(directBrain)];
  }

  const appBrains = KNOWN_APP_SUBDIRS.map((sub) => path.resolve(root, sub, 'brain'));
  const existingAppBrains = appBrains.filter(isDirectory);
  if (existingAppBrains.length > 0) return existingAppBrains;

  if (path.basename(root) === '.gemini') {
    return [appBrains[0], appBrains[1]];
  }

  return [path.resolve(root)];
}

interface TranscriptTarget {
  conversationId: string;
  transcriptPath: string;
  fullTranscriptPath: string;
  appDataDir: string;
}

export function collectAntigravityTranscripts(brainOrConvDir: string): TranscriptTarget[] {
  const targets: TranscriptTarget[] = [];
  const direct = pickTranscriptFile(brainOrConvDir);
  if (direct) {
    const convDir = path.resolve(brainOrConvDir);
    const parent = path.dirname(convDir);
    targets.push({
      conversationId: path.basename(convDir),
      transcriptPath: direct,
      fullTranscriptPath: path.join(convDir, '.system_generated', 'logs', 'transcript_full.jsonl'),
      appDataDir: path.basename(parent) === 'brain' ? path.dirname(parent) : parent,
    });
    return targets;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(brainOrConvDir, { withFileTypes: true });
  } catch {
    return targets;
  }

  const resolvedRoot = path.resolve(brainOrConvDir);
  const appDataDir = path.basename(resolvedRoot) === 'brain' ? path.dirname(resolvedRoot) : resolvedRoot;

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'tempmediaStorage') continue;
    const convDir = path.join(resolvedRoot, entry.name);
    const transcriptPath = pickTranscriptFile(convDir);
    if (!transcriptPath) continue;
    targets.push({
      conversationId: entry.name,
      transcriptPath,
      fullTranscriptPath: path.join(convDir, '.system_generated', 'logs', 'transcript_full.jsonl'),
      appDataDir,
    });
  }
  return targets;
}

function cleanModelValue(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim().replace(/^"+|"+$/g, '').trim();
  if (!trimmed || trimmed.toLowerCase() === 'none') return undefined;
  return trimmed;
}

function extractModelsFromUserInput(content: string): string[] {
  if (!content.includes('USER_SETTINGS_CHANGE') || !content.includes('Model Selection')) return [];
  const stripped = content.replace(USER_REQUEST_BLOCK_RE, '');
  const found: string[] = [];

  for (const block of stripped.matchAll(SETTINGS_BLOCK_RE)) {
    for (const match of block[1].matchAll(MODEL_SELECTION_RE)) {
      const model = cleanModelValue(match[1]);
      if (model) found.push(model);
    }
  }
  if (found.length > 0) return found;

  // Handle compact transcripts where the opening <USER_SETTINGS_CHANGE> tag was inside the truncated middle.
  const closeIdx = stripped.lastIndexOf('</USER_SETTINGS_CHANGE>');
  if (closeIdx >= 0) {
    const tail = stripped.slice(Math.max(0, closeIdx - 600), closeIdx);
    for (const match of tail.matchAll(MODEL_SELECTION_RE)) {
      const model = cleanModelValue(match[1]);
      if (model) found.push(model);
    }
  }
  return found;
}

function extractSubagentCalls(toolCalls: unknown): Array<{ modelArg?: string }> {
  if (!Array.isArray(toolCalls)) return [];
  const calls: Array<{ modelArg?: string }> = [];
  for (const raw of toolCalls) {
    if (!raw || typeof raw !== 'object') continue;
    const call = raw as Record<string, unknown>;
    if (call.name !== 'invoke_subagent') continue;
    const args = call.args && typeof call.args === 'object' ? (call.args as Record<string, unknown>) : undefined;
    calls.push({ modelArg: cleanModelValue(args?.Model ?? args?.model) });
  }
  return calls;
}

function resolveSubagentOverride(modelArg: string | undefined): string | undefined {
  if (!modelArg) return undefined;
  const lower = modelArg.toLowerCase();
  if (lower === 'inherit' || lower === 'default' || lower === 'none') return undefined;
  if (lower === 'flash_lite' || lower === 'flash-lite') return 'Gemini Flash Lite';
  if (lower === 'flash') return 'Gemini Flash';
  if (lower === 'pro') return 'Gemini Pro';
  return modelArg;
}

function preferStep(next: ParsedAntigravityStep, current: ParsedAntigravityStep | undefined): boolean {
  if (!current) return true;
  if (next.isDone !== current.isDone) return next.isDone;
  return (next.input + next.output + next.cacheRead) >= (current.input + current.output + current.cacheRead);
}

function loadFullStepsByIndex(fullPath: string, maxBytes: number): Map<number, Record<string, unknown>> {
  const byStep = new Map<number, Record<string, unknown>>();
  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isFile() || stat.size > maxBytes) return byStep;
    const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (typeof parsed.step_index === 'number') byStep.set(parsed.step_index, parsed);
      } catch {}
    }
  } catch {}
  return byStep;
}

function parseConversationTarget(target: TranscriptTarget): ParsedConversation | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target.transcriptPath);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;

  let fullMtimeMs = 0;
  let fullSize = 0;
  if (target.fullTranscriptPath !== target.transcriptPath) {
    try {
      const fullStat = fs.statSync(target.fullTranscriptPath);
      if (fullStat.isFile()) {
        fullMtimeMs = fullStat.mtimeMs;
        fullSize = fullStat.size;
      }
    } catch {}
  }

  const cached = fileCache.get(target.transcriptPath);
  if (
    cached
    && cached.mtimeMs === stat.mtimeMs
    && cached.size === stat.size
    && cached.fullMtimeMs === fullMtimeMs
    && cached.fullSize === fullSize
  ) {
    return cached.conversation;
  }

  const lines = fs.readFileSync(target.transcriptPath, 'utf8').split('\n');
  let fullByStep: Map<number, Record<string, unknown>> | null = null;
  const getFullStep = (stepIndex: number): Record<string, unknown> | undefined => {
    if (target.fullTranscriptPath === target.transcriptPath || fullSize === 0) return undefined;
    if (!fullByStep) fullByStep = loadFullStepsByIndex(target.fullTranscriptPath, MAX_FILE_BYTES);
    return fullByStep.get(stepIndex);
  };

  const stepsByIndex = new Map<number, ParsedAntigravityStep>();
  const modelChanges: ModelChange[] = [];
  const subagents: SubagentSpawn[] = [];
  let pendingSubagents: Array<{ modelArg?: string; parentStepIndex: number }> = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    const line = lines[lineIdx];
    if (!line.trim()) continue;
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const stepIndex = typeof json.step_index === 'number' && Number.isInteger(json.step_index)
      ? json.step_index
      : lineIdx;
    const truncated = Array.isArray(json.truncated_fields) ? json.truncated_fields : [];

    if (json.type === 'USER_INPUT') {
      let content = typeof json.content === 'string' ? json.content : '';
      let models = extractModelsFromUserInput(content);
      if (models.length === 0 && truncated.includes('content')) {
        const fullStep = getFullStep(stepIndex);
        if (typeof fullStep?.content === 'string') {
          content = fullStep.content;
          models = extractModelsFromUserInput(content);
        }
      }
      for (const model of models) {
        modelChanges.push({ stepIndex, model });
      }
      continue;
    }

    if (json.type === 'PLANNER_RESPONSE') {
      let toolCalls = json.tool_calls;
      if (truncated.includes('tool_calls')) {
        const fullStep = getFullStep(stepIndex);
        if (fullStep?.tool_calls !== undefined) toolCalls = fullStep.tool_calls;
      }
      pendingSubagents = extractSubagentCalls(toolCalls).map((item) => ({
        modelArg: item.modelArg,
        parentStepIndex: stepIndex,
      }));
    } else if (json.type === 'GENERIC') {
      let content = typeof json.content === 'string' ? json.content : '';
      let match = content.match(SUBAGENT_CREATED_RE);
      if (!match && pendingSubagents.length > 0 && truncated.includes('content')) {
        const fullStep = getFullStep(stepIndex);
        if (typeof fullStep?.content === 'string') {
          content = fullStep.content;
          match = content.match(SUBAGENT_CREATED_RE);
        }
      }
      if (match?.[1]) {
        const pending = pendingSubagents.shift();
        subagents.push({
          childConversationId: match[1],
          parentConversationId: target.conversationId,
          parentStepIndex: pending?.parentStepIndex ?? stepIndex,
          modelArg: pending?.modelArg,
        });
      }
      continue;
    }

    const hasTokens = json.input_tokens !== undefined
      || json.output_tokens !== undefined
      || json.cache_read_tokens !== undefined
      || json.cache_write_tokens !== undefined;
    if (!hasTokens) continue;

    const timestamp = toEpoch(json.created_at ?? json.timestamp);
    if (timestamp == null) continue;

    const input = asCount(json.input_tokens);
    const output = asCount(json.output_tokens);
    const cacheRead = asCount(json.cache_read_tokens);
    const cacheWrite = asCount(json.cache_write_tokens);
    const reasoning = asCount(json.thinking_tokens ?? json.reasoning_tokens);
    if (input + output + cacheRead + cacheWrite <= 0) continue;

    const directModel = cleanModelValue(json.model);
    const parsedStep: ParsedAntigravityStep = {
      stepIndex,
      timestamp,
      input,
      output,
      cacheRead,
      cacheWrite,
      reasoning,
      explicitModel: directModel,
      isDone: json.status === 'DONE',
    };
    if (preferStep(parsedStep, stepsByIndex.get(stepIndex))) {
      stepsByIndex.set(stepIndex, parsedStep);
    }
  }

  modelChanges.sort((a, b) => a.stepIndex - b.stepIndex);
  const steps = Array.from(stepsByIndex.values()).sort((a, b) => a.stepIndex - b.stepIndex);
  const conversation: ParsedConversation = {
    conversationId: target.conversationId,
    appDataDir: target.appDataDir,
    steps,
    modelChanges,
    subagents,
  };

  fileCache.set(target.transcriptPath, {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    fullMtimeMs,
    fullSize,
    conversation,
  });
  return conversation;
}

function readAppDefaultModel(appDataDir: string, cache: Map<string, string | undefined>): string | undefined {
  if (cache.has(appDataDir)) return cache.get(appDataDir);
  let resolved: string | undefined;
  try {
    const raw = fs.readFileSync(path.join(appDataDir, 'settings.json'), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    resolved = cleanModelValue(parsed.model);
  } catch {
    resolved = undefined;
  }
  cache.set(appDataDir, resolved);
  return resolved;
}

function changeBeforeOrAt(changes: ModelChange[], stepIndex: number): string | undefined {
  let active: string | undefined;
  for (const change of changes) {
    if (change.stepIndex <= stepIndex) active = change.model;
    else break;
  }
  return active;
}

export function scanAntigravitySessions(roots: string | string[]): AntigravityScanResult {
  const inputRoots = Array.isArray(roots) ? roots : [roots];
  const candidateDirs = Array.from(new Set(inputRoots.flatMap((root) => resolveAntigravityBrainDirs(root))));
  const existing = candidateDirs.filter((dir) => dir && fs.existsSync(dir));
  if (existing.length === 0) {
    return { records: [], filesScanned: 0, exists: false, truncated: false, errors: 0 };
  }

  const byTranscript = new Map<string, TranscriptTarget>();
  for (const dir of existing) {
    for (const target of collectAntigravityTranscripts(dir)) {
      byTranscript.set(target.transcriptPath, target);
    }
  }

  let targets = Array.from(byTranscript.values());
  let truncated = false;
  if (targets.length > MAX_FILES) {
    truncated = true;
    targets = targets
      .map((target) => {
        try {
          return { target, mtime: fs.statSync(target.transcriptPath).mtimeMs };
        } catch {
          return { target, mtime: 0 };
        }
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, MAX_FILES)
      .map((item) => item.target);
  }

  const seenPaths = new Set(targets.map((target) => target.transcriptPath));
  for (const key of fileCache.keys()) {
    if (!seenPaths.has(key)) fileCache.delete(key);
  }

  const conversations = new Map<string, ParsedConversation>();
  const subagentLinks = new Map<string, SubagentSpawn>();
  let errors = 0;

  for (const target of targets) {
    try {
      const parsed = parseConversationTarget(target);
      if (!parsed) continue;
      const prev = conversations.get(parsed.conversationId);
      if (!prev || parsed.steps.length >= prev.steps.length) {
        conversations.set(parsed.conversationId, parsed);
      }
      for (const spawn of parsed.subagents) {
        subagentLinks.set(spawn.childConversationId, spawn);
      }
    } catch {
      errors += 1;
    }
  }

  const appModelCache = new Map<string, string | undefined>();
  const resolveModelAt = (conversationId: string, stepIndex: number, depth = 0): string => {
    if (depth > 8) return 'unknown';
    const conv = conversations.get(conversationId);
    if (conv) {
      const changed = changeBeforeOrAt(conv.modelChanges, stepIndex);
      if (changed) return changed;
    }

    const spawn = subagentLinks.get(conversationId);
    if (spawn) {
      const override = resolveSubagentOverride(spawn.modelArg);
      if (override) return override;
      if (spawn.parentConversationId !== conversationId) {
        const inherited = resolveModelAt(spawn.parentConversationId, spawn.parentStepIndex, depth + 1);
        if (inherited !== 'unknown') return inherited;
      }
    }

    if (conv) {
      const appDefault = readAppDefaultModel(conv.appDataDir, appModelCache);
      if (appDefault) return appDefault;
      if (conv.modelChanges.length > 0) return conv.modelChanges[0].model;
    }
    return 'unknown';
  };

  const recordsById = new Map<string, TokenUsageRecord>();
  for (const conv of conversations.values()) {
    for (const step of conv.steps) {
      const id = `antigravity:${conv.conversationId}:${step.stepIndex}`;
      const model = step.explicitModel || resolveModelAt(conv.conversationId, step.stepIndex);
      const record: TokenUsageRecord = {
        id,
        timestamp: step.timestamp,
        client: 'antigravity',
        provider: 'antigravity',
        model,
        input: step.input,
        output: step.output,
        reasoning: step.reasoning,
        cacheRead: step.cacheRead,
        cacheWrite: step.cacheWrite,
        totalTokens: step.input + step.output,
        source: 'antigravity-session',
        sessionId: conv.conversationId,
      };
      recordsById.set(id, record);
    }
  }

  return {
    records: Array.from(recordsById.values()),
    filesScanned: targets.length,
    exists: true,
    truncated,
    errors,
  };
}
