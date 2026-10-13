import fs from 'node:fs';
import path from 'node:path';
import type { TokenUsageRecord } from './types.js';

const MAX_FILES = 4000;
const MAX_FILE_BYTES = 80 * 1024 * 1024;

interface ParsedClaudeMessage {
  id: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  timestamp: number;
  sessionId?: string;
  hasStop: boolean;
}

interface FileCacheEntry {
  mtimeMs: number;
  size: number;
  messages: ParsedClaudeMessage[];
}

const fileCache = new Map<string, FileCacheEntry>();

export interface ClaudeScanResult {
  records: TokenUsageRecord[];
  filesScanned: number;
  exists: boolean;
  truncated: boolean;
  errors: number;
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

function pushJsonlChildren(dir: string, files: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(path.join(dir, entry.name));
    }
  }
}

function collectProjectFiles(projectDir: string, files: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = path.join(projectDir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(child);
      continue;
    }
    if (!entry.isDirectory()) continue;
    const subagents = path.join(child, 'subagents');
    pushJsonlChildren(subagents, files);
    const workflows = path.join(subagents, 'workflows');
    let workflowEntries: fs.Dirent[] = [];
    try {
      if (fs.existsSync(workflows)) workflowEntries = fs.readdirSync(workflows, { withFileTypes: true });
    } catch {
      workflowEntries = [];
    }
    for (const workflow of workflowEntries) {
      if (workflow.isDirectory()) pushJsonlChildren(path.join(workflows, workflow.name), files);
    }
  }
}

export function collectClaudeJsonlFiles(root: string): string[] {
  const files: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return files;
  }

  const directJsonl = entries.some((entry) => entry.isFile() && entry.name.endsWith('.jsonl'));
  if (directJsonl) collectProjectFiles(root, files);

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    collectProjectFiles(path.join(root, entry.name), files);
  }
  return files;
}

function preferMessage(next: ParsedClaudeMessage, current: ParsedClaudeMessage | undefined): boolean {
  if (!current) return true;
  if (next.hasStop !== current.hasStop) return next.hasStop;
  return next.output > current.output;
}

function parseFile(filePath: string): ParsedClaudeMessage[] {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return [];
  }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return [];

  const cached = fileCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.messages;

  const messages = new Map<string, ParsedClaudeMessage>();
  let sessionId: string | undefined;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!sessionId && typeof json.sessionId === 'string') sessionId = json.sessionId;
    if (json.type !== 'assistant' || !json.message || typeof json.message !== 'object') continue;

    const message = json.message as Record<string, unknown>;
    const usage = message.usage;
    if (!usage || typeof usage !== 'object') continue;
    const usageRecord = usage as Record<string, unknown>;
    const messageId = typeof message.id === 'string' && message.id.trim()
      ? message.id
      : typeof json.uuid === 'string'
        ? json.uuid
        : `${path.basename(filePath)}:${index}`;
    const timestamp = toEpoch(json.timestamp);
    if (timestamp == null) continue;

    const details = usageRecord.output_tokens_details;
    const thinking = details && typeof details === 'object'
      ? asCount((details as Record<string, unknown>).thinking_tokens)
      : 0;
    const parsed: ParsedClaudeMessage = {
      id: messageId,
      model: typeof message.model === 'string' && message.model.trim() ? message.model : 'unknown',
      input: asCount(usageRecord.input_tokens),
      output: asCount(usageRecord.output_tokens),
      cacheRead: asCount(usageRecord.cache_read_input_tokens),
      cacheWrite: asCount(usageRecord.cache_creation_input_tokens),
      reasoning: thinking,
      timestamp,
      sessionId,
      hasStop: typeof message.stop_reason === 'string' && message.stop_reason.length > 0,
    };
    if (parsed.input + parsed.output + parsed.cacheRead + parsed.cacheWrite <= 0) continue;
    const key = parsed.id;
    if (preferMessage(parsed, messages.get(key))) messages.set(key, parsed);
  }

  const result = Array.from(messages.values());
  fileCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, messages: result });
  return result;
}

export function scanClaudeConversations(root: string): ClaudeScanResult {
  if (!root || !fs.existsSync(root)) {
    return { records: [], filesScanned: 0, exists: false, truncated: false, errors: 0 };
  }

  let files = collectClaudeJsonlFiles(root);
  let truncated = false;
  if (files.length > MAX_FILES) {
    truncated = true;
    files = files
      .map((file) => {
        try {
          return { file, mtime: fs.statSync(file).mtimeMs };
        } catch {
          return { file, mtime: 0 };
        }
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, MAX_FILES)
      .map((item) => item.file);
  }

  const seen = new Set(files);
  for (const key of fileCache.keys()) {
    if (!seen.has(key)) fileCache.delete(key);
  }

  const byId = new Map<string, ParsedClaudeMessage>();
  let errors = 0;
  for (const file of files) {
    try {
      for (const message of parseFile(file)) {
        if (preferMessage(message, byId.get(message.id))) byId.set(message.id, message);
      }
    } catch {
      errors += 1;
    }
  }

  const records: TokenUsageRecord[] = Array.from(byId.values()).map((message) => ({
    id: `claude:${message.id}`,
    timestamp: message.timestamp,
    client: 'claude',
    provider: 'anthropic',
    model: message.model,
    input: message.input,
    output: message.output,
    reasoning: message.reasoning,
    cacheRead: message.cacheRead,
    cacheWrite: message.cacheWrite,
    totalTokens: message.input + message.output,
    source: 'claude-session',
    sessionId: message.sessionId,
  }));

  return {
    records,
    filesScanned: files.length,
    exists: true,
    truncated,
    errors,
  };
}
