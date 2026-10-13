import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ScanReport } from './usage/types.js';

export interface PathSettings {
  codexDir: string;
  piAgentDir: string;
  claudeProjectsDir: string;
  grokSessionsDir: string;
}

export type AccountType = 'gpt' | 'claude' | 'grok' | 'agy';

export interface ConsoleAccount {
  id: string;
  type: AccountType;
  label: string;
  userId?: string;
  notes?: string;
  email?: string;
  source?: 'scan' | 'login';
}

export interface StoredSettings {
  hideAgyClaude: boolean;
  paths: PathSettings;
  accounts: ConsoleAccount[];
  dataDir: string;
}

export interface RuntimePaths {
  home: string;
  codex: string;
  codexSessions: string;
  codexAuth: string;
  pi: string;
  piAgent: string;
  piQuotaMonitor: string;
  piQuotaReadings: string;
  piUsage: string;
  gemini: string;
  claudeProjects: string;
  /** Every Claude projects dir to scan: the configured one, or all default locations that exist. */
  claudeProjectsAll: string[];
  grokSessions: string;
}

const PATH_KEYS: (keyof PathSettings)[] = ['codexDir', 'piAgentDir', 'claudeProjectsDir', 'grokSessionsDir'];

const EMPTY_PATHS: PathSettings = {
  codexDir: '',
  piAgentDir: '',
  claudeProjectsDir: '',
  grokSessionsDir: '',
};

let storedCache: StoredSettings | null = null;
let runtimeCache: RuntimePaths | null = null;

export function defaultPaths(): PathSettings {
  const home = os.homedir();
  return {
    codexDir: path.join(home, '.codex'),
    piAgentDir: path.join(home, '.pi', 'agent'),
    claudeProjectsDir: path.join(home, '.claude', 'projects'),
    grokSessionsDir: path.join(home, '.grok', 'sessions'),
  };
}

function settingsFile(): string {
  return process.env.CONSOLE_SETTINGS_PATH || path.join(os.homedir(), '.usage-console', 'settings.json');
}

const ACCOUNT_TYPES = new Set<AccountType>(['gpt', 'claude', 'grok', 'agy']);

export function defaultDataDir(): string {
  return path.join(os.homedir(), '.usage-console');
}

function emptySettings(): StoredSettings {
  return { hideAgyClaude: true, paths: { ...EMPTY_PATHS }, accounts: [], dataDir: '' };
}

function sanitizeAccounts(input: unknown): ConsoleAccount[] {
  if (!Array.isArray(input)) return [];
  const accounts: ConsoleAccount[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (!ACCOUNT_TYPES.has(record.type as AccountType)) continue;
    let id = typeof record.id === 'string' ? record.id.trim() : '';
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || seen.has(id)) {
      id = `acc_${accounts.length}_${Date.now().toString(36)}`;
    }
    seen.add(id);
    const label = typeof record.label === 'string' ? record.label.trim().slice(0, 80) : '';
    accounts.push({ id, type: record.type as AccountType, label });
    if (accounts.length >= 24) break;
  }
  return accounts;
}

function sanitizeStoredPaths(input: unknown): PathSettings {
  const next = { ...EMPTY_PATHS };
  if (!input || typeof input !== 'object') return next;
  const record = input as Record<string, unknown>;
  for (const key of PATH_KEYS) {
    const value = record[key];
    if (typeof value === 'string') next[key] = value.trim();
  }
  return next;
}

export function loadSettings(): StoredSettings {
  if (storedCache) return storedCache;
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoredSettings>;
    storedCache = {
      hideAgyClaude: parsed.hideAgyClaude !== false,
      paths: sanitizeStoredPaths(parsed.paths),
      accounts: sanitizeAccounts(parsed.accounts),
      dataDir: typeof parsed.dataDir === 'string' ? parsed.dataDir.trim() : '',
    };
  } catch {
    storedCache = emptySettings();
  }
  return storedCache;
}

export function expandUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (trimmed.includes('\0')) throw new Error('路径包含非法字符');
  if (trimmed.length > 1024) throw new Error('路径过长');
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.resolve(path.join(os.homedir(), trimmed.slice(2)));
  }
  return path.resolve(trimmed);
}

function normalizeClaudeDir(dir: string): string {
  try {
    const projects = path.join(dir, 'projects');
    if (fs.existsSync(projects) && fs.statSync(projects).isDirectory()) {
      const directJsonl = fs.readdirSync(dir).some((name) => name.endsWith('.jsonl'));
      if (!directJsonl) return projects;
    }
  } catch {
    // A missing directory is still a valid configured path.
  }
  return dir;
}

/**
 * Claude Code writes transcripts to <config>/projects. The config dir is $CLAUDE_CONFIG_DIR (comma separated),
 * ~/.claude, or ~/.config/claude on newer Linux installs — scan every one that exists.
 */
function defaultClaudeProjectDirs(): string[] {
  const home = os.homedir();
  const dirs = (process.env.CLAUDE_CONFIG_DIR || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((dir) => normalizeClaudeDir(expandUserPath(dir)));
  dirs.push(path.join(home, '.claude', 'projects'));
  dirs.push(path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'claude', 'projects'));
  const uniqueDirs = Array.from(new Set(dirs.map((dir) => path.resolve(dir))));
  const existing = uniqueDirs.filter((dir) => fs.existsSync(dir));
  return existing.length > 0 ? existing : [uniqueDirs[uniqueDirs.length - 2]];
}

function computeRuntimePaths(): RuntimePaths {
  const settings = loadSettings();
  const defaults = defaultPaths();
  const pick = (key: keyof PathSettings) => expandUserPath(settings.paths[key]) || defaults[key];
  const codexDir = pick('codexDir');
  const piAgentDir = pick('piAgentDir');
  const claudeProjectsDir = normalizeClaudeDir(pick('claudeProjectsDir'));
  const claudeProjectsAll = settings.paths.claudeProjectsDir
    ? [claudeProjectsDir]
    : defaultClaudeProjectDirs();
  const grokSessionsDir = pick('grokSessionsDir');
  return {
    home: os.homedir(),
    codex: codexDir,
    codexSessions: path.join(codexDir, 'sessions'),
    codexAuth: path.join(codexDir, 'auth.json'),
    pi: path.dirname(piAgentDir),
    piAgent: piAgentDir,
    piQuotaMonitor: path.join(piAgentDir, 'pi-quota-monitor'),
    piQuotaReadings: path.join(piAgentDir, 'pi-quota-monitor', 'quota-readings'),
    piUsage: path.join(piAgentDir, 'pi-quota-monitor', 'usage'),
    gemini: path.join(os.homedir(), '.gemini'),
    claudeProjects: claudeProjectsAll.find((dir) => fs.existsSync(dir)) || claudeProjectsDir,
    claudeProjectsAll,
    grokSessions: grokSessionsDir,
  };
}

export function resolveRuntimePaths(): RuntimePaths {
  if (!runtimeCache) runtimeCache = computeRuntimePaths();
  return runtimeCache;
}

function invalidateRuntimePaths(): void {
  runtimeCache = null;
}

function toOverride(value: unknown, fallback: string): string {
  if (typeof value !== 'string') throw new Error('路径必须是字符串');
  const trimmed = value.trim();
  if (!trimmed) return '';
  const expanded = expandUserPath(trimmed);
  return expanded === fallback ? '' : expanded;
}

export function resolveDataDir(): string {
  const configured = loadSettings().dataDir;
  return (configured ? expandUserPath(configured) : '') || defaultDataDir();
}

export function saveSettings(patch: {
  hideAgyClaude?: boolean;
  paths?: Partial<PathSettings>;
  accounts?: ConsoleAccount[];
  dataDir?: string;
}): StoredSettings {
  const current = loadSettings();
  const defaults = defaultPaths();
  const nextPaths = { ...current.paths };
  if (patch.paths) {
    for (const key of PATH_KEYS) {
      if (patch.paths[key] !== undefined) nextPaths[key] = toOverride(patch.paths[key], defaults[key]);
    }
  }
  const next: StoredSettings = {
    hideAgyClaude: typeof patch.hideAgyClaude === 'boolean' ? patch.hideAgyClaude : current.hideAgyClaude,
    paths: nextPaths,
    accounts: patch.accounts ? sanitizeAccounts(patch.accounts) : current.accounts,
    dataDir: patch.dataDir !== undefined
      ? (patch.dataDir.trim() && expandUserPath(patch.dataDir) !== defaultDataDir() ? expandUserPath(patch.dataDir) : '')
      : current.dataDir,
  };
  const file = settingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(temp, file);
  storedCache = next;
  invalidateRuntimePaths();
  return next;
}

function pathExists(target: string): boolean {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

export function settingsView(scan: ScanReport) {
  const stored = loadSettings();
  const defaults = defaultPaths();
  const runtime = resolveRuntimePaths();
  const display: PathSettings = {
    codexDir: stored.paths.codexDir || defaults.codexDir,
    piAgentDir: stored.paths.piAgentDir || defaults.piAgentDir,
    claudeProjectsDir: stored.paths.claudeProjectsDir || defaults.claudeProjectsDir,
    grokSessionsDir: stored.paths.grokSessionsDir || defaults.grokSessionsDir,
  };
  const resolved: PathSettings = {
    codexDir: runtime.codex,
    piAgentDir: runtime.piAgent,
    claudeProjectsDir: runtime.claudeProjects,
    grokSessionsDir: runtime.grokSessions,
  };
  return {
    hideAgyClaude: stored.hideAgyClaude,
    paths: display,
    defaults,
    resolved,
    claudeProjectsAll: runtime.claudeProjectsAll,
    availability: {
      codexDir: pathExists(resolved.codexDir),
      piAgentDir: pathExists(resolved.piAgentDir),
      claudeProjectsDir: runtime.claudeProjectsAll.some(pathExists),
      grokSessionsDir: pathExists(resolved.grokSessionsDir),
    },
    accounts: stored.accounts,
    dataDir: stored.dataDir || defaultDataDir(),
    scan,
  };
}
