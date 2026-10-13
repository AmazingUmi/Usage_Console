import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG } from '../config.js';
import type { ClaudeSubscription } from './claude-subscription.js';
import { ClaudeHttpError, queryClaudeProfile, queryClaudeUsage } from './claude-subscription.js';

/**
 * Reads the Claude Code login on this machine and turns it into quota windows.
 *
 * Claude Code keeps its OAuth credentials in one of:
 *   - macOS Keychain, service "Claude Code-credentials" (suffixed with a hash when CLAUDE_CONFIG_DIR is set)
 *   - <config dir>/.credentials.json, where the config dir is $CLAUDE_CONFIG_DIR, ~/.claude or ~/.config/claude
 *
 * The access token lives ~8 hours. When it has expired we refresh it the same way Claude Code does and
 * write the rotated tokens back to where they came from, otherwise Claude Code itself would be logged out.
 */

export type ClaudeLoginState = 'ok' | 'not_logged_in' | 'expired' | 'no_subscription' | 'error';

export interface ClaudeLocalStatus {
  state: ClaudeLoginState;
  message: string;
  checkedAt: number;
  source?: string;
  userId?: string;
  email?: string;
  organization?: string;
  plan?: string;
  expiresAt?: number;
  refreshed?: boolean;
  subscription?: ClaudeSubscription;
}

interface OAuthEntry {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
  subscriptionType?: string;
  rateLimitTier?: string;
  [key: string]: unknown;
}

interface CredentialSource {
  kind: 'file' | 'keychain';
  label: string;
  file?: string;
  service?: string;
  account?: string;
  raw: Record<string, unknown>;
  entryKey: string;
  entry: OAuthEntry;
}

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const TOKEN_ENDPOINTS = [
  'https://platform.claude.com/v1/oauth/token',
  'https://console.anthropic.com/v1/oauth/token',
];
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const CACHE_TTL_MS = 90 * 1000;
const EXPIRY_SKEW_MS = 2 * 60 * 1000;

let cached: ClaudeLocalStatus | null = null;
let inflight: Promise<ClaudeLocalStatus> | null = null;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function unique(list: string[]): string[] {
  return Array.from(new Set(list.filter(Boolean).map((item) => path.resolve(item))));
}

/** Every directory Claude Code may use as its config dir, most specific first. */
export function claudeConfigDirs(): string[] {
  const home = os.homedir();
  const fromEnv = (process.env.CLAUDE_CONFIG_DIR || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const dirs = [...fromEnv];
  // A custom "Claude 对话目录" like /mnt/c/Users/me/.claude/projects points at another config dir.
  const projects = CONFIG.paths.claudeProjects;
  if (projects && path.basename(projects) === 'projects') dirs.push(path.dirname(projects));
  dirs.push(path.join(home, '.claude'));
  dirs.push(path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'claude'));
  return unique(dirs);
}

function oauthEntry(raw: Record<string, unknown>): { key: string; entry: OAuthEntry } | null {
  for (const key of ['claudeAiOauth', 'claude.ai_oauth']) {
    const value = raw[key];
    if (value && typeof value === 'object' && text((value as OAuthEntry).accessToken)) {
      return { key, entry: value as OAuthEntry };
    }
  }
  return null;
}

function keychainServices(): string[] {
  const services = [KEYCHAIN_SERVICE];
  for (const dir of (process.env.CLAUDE_CONFIG_DIR || '').split(',').map((item) => item.trim()).filter(Boolean)) {
    const hash = crypto.createHash('sha256').update(dir).digest('hex').slice(0, 8);
    services.unshift(`${KEYCHAIN_SERVICE}-${hash}`);
  }
  return services;
}

function readKeychain(): CredentialSource | null {
  if (process.platform !== 'darwin') return null;
  for (const service of keychainServices()) {
    try {
      const raw = execFileSync('security', ['find-generic-password', '-s', service, '-w'], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const found = oauthEntry(parsed);
      if (!found) continue;
      let account = os.userInfo().username;
      try {
        const attrs = execFileSync('security', ['find-generic-password', '-s', service], {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        const match = attrs.match(/"acct"<blob>="([^"]*)"/);
        if (match?.[1]) account = match[1];
      } catch {
        // Keep the login user name, which is what Claude Code writes.
      }
      return {
        kind: 'keychain',
        label: `macOS 钥匙串 (${service})`,
        service,
        account,
        raw: parsed,
        entryKey: found.key,
        entry: found.entry,
      };
    } catch {
      // Not in the keychain under this name; try the next one or the files.
    }
  }
  return null;
}

function readCredentialFiles(): CredentialSource[] {
  const sources: CredentialSource[] = [];
  for (const dir of claudeConfigDirs()) {
    const file = path.join(dir, '.credentials.json');
    const raw = readJson(file);
    if (!raw) continue;
    const found = oauthEntry(raw);
    if (!found) continue;
    sources.push({ kind: 'file', label: file, file, raw, entryKey: found.key, entry: found.entry });
  }
  return sources;
}

/** Newest credential first: a stale copy in another config dir must not shadow the live one. */
function findCredentials(): CredentialSource | null {
  const all = [readKeychain(), ...readCredentialFiles()].filter((item): item is CredentialSource => Boolean(item));
  if (all.length === 0) return null;
  all.sort((a, b) => (Number(b.entry.expiresAt) || 0) - (Number(a.entry.expiresAt) || 0));
  return all[0];
}

function writeBack(source: CredentialSource, entry: OAuthEntry): void {
  const next = { ...source.raw, [source.entryKey]: entry };
  const body = JSON.stringify(next);
  if (source.kind === 'keychain' && source.service) {
    execFileSync('security', [
      'add-generic-password', '-U',
      '-s', source.service,
      '-a', source.account || os.userInfo().username,
      '-w', body,
    ], { timeout: 5000, stdio: 'ignore' });
    return;
  }
  if (!source.file) return;
  const temp = `${source.file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, body, { mode: 0o600 });
  fs.renameSync(temp, source.file);
}

async function refreshTokens(source: CredentialSource): Promise<OAuthEntry> {
  const refreshToken = text(source.entry.refreshToken);
  if (!refreshToken) throw new ClaudeHttpError(401, '登录已过期，且没有可用的刷新令牌');
  let lastError: Error | null = null;
  for (const endpoint of TOKEN_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT_ID }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 400 || res.status === 401) {
        throw new ClaudeHttpError(res.status, '刷新令牌已失效');
      }
      if (!res.ok) {
        lastError = new ClaudeHttpError(res.status, `刷新登录失败（HTTP ${res.status}）`);
        continue;
      }
      const data = await res.json() as Record<string, unknown>;
      const accessToken = text(data.access_token);
      if (!accessToken) throw new Error('刷新登录没有返回新令牌');
      const expiresIn = Number(data.expires_in) || 8 * 3600;
      const scope = text(data.scope);
      const entry: OAuthEntry = {
        ...source.entry,
        accessToken,
        refreshToken: text(data.refresh_token) || refreshToken,
        expiresAt: Date.now() + expiresIn * 1000,
        ...(scope ? { scopes: scope.split(/\s+/) } : {}),
      };
      writeBack(source, entry);
      return entry;
    } catch (err) {
      if (err instanceof ClaudeHttpError && (err.status === 400 || err.status === 401)) throw err;
      lastError = err as Error;
    }
  }
  throw lastError || new Error('刷新登录失败');
}

interface LocalAccountInfo {
  userId?: string;
  email?: string;
  organization?: string;
}

/** Claude Code mirrors the logged-in account in <config>/.claude.json or ~/.claude.json. */
function localAccountInfo(): LocalAccountInfo {
  const files = [
    ...claudeConfigDirs().map((dir) => path.join(dir, '.claude.json')),
    path.join(os.homedir(), '.claude.json'),
  ];
  for (const file of unique(files)) {
    const data = readJson(file);
    const account = data?.oauthAccount;
    if (!account || typeof account !== 'object') continue;
    const record = account as Record<string, unknown>;
    const userId = text(record.accountUuid);
    if (!userId) continue;
    return {
      userId,
      email: text(record.emailAddress) || undefined,
      organization: text(record.organizationName) || undefined,
    };
  }
  return {};
}

function planLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const map: Record<string, string> = { max: 'Max', pro: 'Pro', team: 'Team', enterprise: 'Enterprise', free: 'Free' };
  return map[value.toLowerCase()] || value;
}

async function inspect(): Promise<ClaudeLocalStatus> {
  const checkedAt = Date.now();
  const source = findCredentials();
  const local = localAccountInfo();
  if (!source) {
    return {
      state: 'not_logged_in',
      message: `本机没有找到 Claude Code 登录。已查找：${claudeConfigDirs().map((dir) => path.join(dir, '.credentials.json')).join('、')}${process.platform === 'darwin' ? '，以及 macOS 钥匙串' : ''}。请先运行 claude 并执行 /login。`,
      checkedAt,
      ...local,
    };
  }

  let entry = source.entry;
  let refreshed = false;
  const expiresAt = Number(entry.expiresAt) || 0;
  if (expiresAt && expiresAt - EXPIRY_SKEW_MS <= Date.now()) {
    try {
      entry = await refreshTokens(source);
      refreshed = true;
    } catch (err) {
      return {
        state: 'expired',
        message: `Claude Code 登录已过期，自动刷新失败：${(err as Error).message}。在终端运行一次 claude 即可恢复。`,
        checkedAt,
        source: source.label,
        expiresAt,
        plan: planLabel(text(entry.subscriptionType)),
        ...local,
      };
    }
  }

  const accessToken = text(entry.accessToken);
  const plan = planLabel(text(entry.subscriptionType));
  const base = {
    checkedAt,
    source: source.label,
    expiresAt: Number(entry.expiresAt) || undefined,
    refreshed,
    plan,
    ...local,
  };

  const scopes = Array.isArray(entry.scopes) ? entry.scopes.map(String) : [];
  if (scopes.length > 0 && !scopes.includes('user:profile') && !scopes.includes('user:inference')) {
    return { ...base, state: 'no_subscription', message: '本机 Claude Code 使用的是 API Key 登录，没有订阅额度可读。' };
  }

  // Profile is only for identity; a failure there must not hide the quota.
  let profile: Awaited<ReturnType<typeof queryClaudeProfile>> | null = null;
  try {
    profile = await queryClaudeProfile(accessToken);
  } catch {
    profile = null;
  }
  const identity = {
    userId: profile?.userId || local.userId,
    email: profile?.email || local.email,
    organization: profile?.organization || local.organization,
    plan: planLabel(profile?.plan) || plan,
  };

  try {
    const subscription = await queryClaudeUsage(accessToken, identity.plan);
    if (!subscription) {
      return {
        ...base,
        ...identity,
        state: 'no_subscription',
        message: '已检测到 Claude Code 登录，但该账户没有返回订阅额度（可能是 API 计费账户）。',
      };
    }
    return { ...base, ...identity, state: 'ok', message: refreshed ? '已自动刷新登录并读取额度' : '已读取本机 Claude Code 登录', subscription };
  } catch (err) {
    const status = err instanceof ClaudeHttpError ? err.status : 0;
    if (status === 401) {
      return {
        ...base,
        ...identity,
        state: 'expired',
        message: 'Claude Code 登录已失效（HTTP 401）。在终端运行一次 claude 或 /login 后点刷新。',
      };
    }
    if (status === 429 && cached?.subscription) {
      return { ...cached, checkedAt, message: '额度接口限流（HTTP 429），显示上一次读数' };
    }
    return { ...base, ...identity, state: 'error', message: `读取 Claude 额度失败：${(err as Error).message}` };
  }
}

/** Cached for 90s: the usage endpoint rate-limits aggressively and several callers poll it. */
export async function getClaudeLocalStatus(force = false): Promise<ClaudeLocalStatus> {
  if (!force && cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) return cached;
  if (inflight) return inflight;
  inflight = inspect()
    .then((status) => {
      cached = status;
      return status;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function lastClaudeLocalStatus(): ClaudeLocalStatus | null {
  return cached;
}
