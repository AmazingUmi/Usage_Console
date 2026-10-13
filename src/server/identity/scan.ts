import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import type { AccountType } from '../settings.js';
import type { ClaudeSubscription } from './claude-subscription.js';
import { queryClaudeSubscription } from './claude-subscription.js';

export interface ScannedIdentity {
  type: AccountType;
  userId: string;
  email?: string;
  source: 'scan';
  subscription?: ClaudeSubscription;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function jwtPayload(token: unknown): Record<string, unknown> | null {
  if (typeof token !== 'string' || token.split('.').length < 2) return null;
  try {
    const json = Buffer.from(token.split('.')[1], 'base64url').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function scanCodexFile(file: string, into: ScannedIdentity[]): void {
  const data = readJson(file);
  if (!data) return;
  const tokens = data.tokens && typeof data.tokens === 'object' ? data.tokens as Record<string, unknown> : data;
  const payload = jwtPayload(tokens.id_token) || jwtPayload(tokens.access_token) || jwtPayload(data.access);
  const authClaim = payload?.['https://api.openai.com/auth'];
  const claim = authClaim && typeof authClaim === 'object' ? authClaim as Record<string, unknown> : {};
  const userId = text(tokens.account_id) || text(data.accountId) || text(claim.chatgpt_account_id) || text(payload?.sub);
  if (!userId) return;
  into.push({
    type: 'gpt',
    userId,
    email: text(payload?.email) || text(claim.email) || undefined,
    source: 'scan',
  });
}

export function claudeAccessTokenFromCredential(raw: string): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entry = (parsed.claudeAiOauth || parsed['claude.ai_oauth']) as Record<string, unknown> | undefined;
    return text(entry?.accessToken);
  } catch {
    return '';
  }
}

export async function loadLocalClaudeIdentity(): Promise<ScannedIdentity | null> {
  const accessToken = claudeAccessTokenFromCredential(claudeCredentialJson());
  if (!accessToken) return null;
  return claudeProfile(accessToken);
}

async function claudeProfile(accessToken: string): Promise<ScannedIdentity | null> {
  try {
    const identified = await queryClaudeSubscription(accessToken);
    return { type: 'claude', source: 'scan', ...identified, subscription: identified.subscription || undefined };
  } catch {
    return null;
  }
}

function claudeCredentialJson(): string {
  if (process.platform === 'darwin') {
    try {
      return execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], {
        encoding: 'utf8',
        timeout: 4000,
      }).trim();
    } catch {
      // Fall through to the credentials file.
    }
  }
  const file = path.join(CONFIG.paths.home, '.claude', '.credentials.json');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

async function scanClaude(into: ScannedIdentity[]): Promise<void> {
  const raw = claudeCredentialJson();
  if (!raw) return;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }
  const entry = (parsed.claudeAiOauth || parsed['claude.ai_oauth']) as Record<string, unknown> | undefined;
  const accessToken = text(entry?.accessToken);
  if (!accessToken) return;
  const identity = await claudeProfile(accessToken);
  if (identity) into.push(identity);
}

function scanGrok(into: ScannedIdentity[]): void {
  const auth = readJson(path.join(CONFIG.paths.piAgent, 'auth.json'));
  const xai = auth?.xai && typeof auth.xai === 'object' ? auth.xai as Record<string, unknown> : null;
  if (!xai) return;
  const payload = jwtPayload(xai.access);
  const userId = text(payload?.sub) || text(payload?.user_id);
  if (!userId) return;
  into.push({ type: 'grok', userId, email: text(payload?.email) || undefined, source: 'scan' });
}

export async function scanLocalIdentities(): Promise<ScannedIdentity[]> {
  const found: ScannedIdentity[] = [];
  scanCodexFile(CONFIG.paths.codexAuth, found);
  const accountsDir = path.join(CONFIG.paths.piQuotaMonitor, 'accounts');
  if (fs.existsSync(accountsDir)) {
    for (const name of fs.readdirSync(accountsDir)) {
      if (name.endsWith('.json') && name !== 'current.json') scanCodexFile(path.join(accountsDir, name), found);
    }
  }
  scanGrok(found);
  try {
    await scanClaude(found);
  } catch {
    // Identity scan must not fail the usage calibration.
  }
  const unique = new Map<string, ScannedIdentity>();
  for (const item of found) unique.set(`${item.type}:${item.userId}`, item);
  return Array.from(unique.values());
}
