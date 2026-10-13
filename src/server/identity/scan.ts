import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import type { AccountType } from '../settings.js';
import type { ClaudeSubscription } from './claude-subscription.js';
import { getClaudeLocalStatus } from './claude-local.js';

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

export async function loadLocalClaudeIdentity(force = false): Promise<ScannedIdentity | null> {
  const status = await getClaudeLocalStatus(force);
  if (!status.userId) return null;
  return {
    type: 'claude',
    source: 'scan',
    userId: status.userId,
    email: status.email,
    subscription: status.subscription,
  };
}

async function scanClaude(into: ScannedIdentity[]): Promise<void> {
  const identity = await loadLocalClaudeIdentity();
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
