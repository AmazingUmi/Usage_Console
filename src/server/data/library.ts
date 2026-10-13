import fs from 'node:fs';
import path from 'node:path';
import type { AccountType, ConsoleAccount } from '../settings.js';
import { resolveDataDir } from '../settings.js';
import type { QuotaWindow } from '../quota/types.js';
import type { TokenUsageRecord } from '../usage/types.js';

export interface AccountSubscription {
  plan?: string;
  capturedAt: number;
  windows: QuotaWindow[];
}

export interface ManagedAccount extends ConsoleAccount {
  userId: string;
  notes: string;
  email?: string;
  source: 'scan' | 'login';
  subscription?: AccountSubscription;
  createdAt: number;
  updatedAt: number;
}

const TOKEN_KEY = /token|oauth|secret|refresh|password|credential/i;

function accountsFile(): string {
  return path.join(resolveDataDir(), 'accounts.json');
}

function usageFile(): string {
  return path.join(resolveDataDir(), 'usage.jsonl');
}

function ensureDir(): void {
  fs.mkdirSync(resolveDataDir(), { recursive: true });
}

function cleanText(value: unknown, max = 80): string {
  return typeof value === 'string' ? value.replace(/\0/g, '').trim().slice(0, max) : '';
}

export function sanitizeAccount(input: unknown): ManagedAccount | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (TOKEN_KEY.test(key)) return null;
  }
  const type = record.type;
  if (type !== 'gpt' && type !== 'claude' && type !== 'grok' && type !== 'agy') return null;
  const userId = cleanText(record.userId, 160);
  if (!userId) return null;
  const id = /^[A-Za-z0-9_-]{1,80}$/.test(String(record.id || ''))
    ? String(record.id)
    : `acc_${userId.slice(0, 12)}_${type}`;
  const now = Date.now();
  return {
    id,
    type,
    userId,
    label: cleanText(record.label, 80),
    notes: cleanText(record.notes, 1000),
    email: cleanText(record.email, 160) || undefined,
    source: record.source === 'login' ? 'login' : 'scan',
    subscription: sanitizeSubscription(record.subscription),
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : now,
  };
}

function sanitizeSubscription(input: unknown): AccountSubscription | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  const windows = Array.isArray(record.windows) ? record.windows.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const window = item as Record<string, unknown>;
    const remainingPercent = Number(window.remainingPercent);
    if (!Number.isFinite(remainingPercent)) return [];
    return [{
      label: cleanText(window.label, 40) || 'Subscription',
      remainingPercent: Math.max(0, Math.min(100, remainingPercent)),
      ...(typeof window.resetAt === 'number' ? { resetAt: window.resetAt } : {}),
      ...(typeof window.windowMinutes === 'number' ? { windowMinutes: window.windowMinutes } : {}),
    }];
  }) : [];
  if (windows.length === 0) return undefined;
  return {
    plan: cleanText(record.plan, 40) || undefined,
    capturedAt: typeof record.capturedAt === 'number' ? record.capturedAt : Date.now(),
    windows,
  };
}

export function loadAccounts(): ManagedAccount[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(accountsFile(), 'utf8')) as unknown;
    const list = Array.isArray(parsed) ? parsed : [];
    const accounts: ManagedAccount[] = [];
    const seen = new Set<string>();
    for (const item of list) {
      const account = sanitizeAccount(item);
      if (!account) continue;
      const key = `${account.type}:${account.userId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      accounts.push(account);
    }
    return accounts;
  } catch {
    return [];
  }
}

export function saveAccounts(accounts: ManagedAccount[]): ManagedAccount[] {
  const clean = accounts.map(sanitizeAccount).filter((item): item is ManagedAccount => Boolean(item));
  ensureDir();
  const file = accountsFile();
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(clean, null, 2)}\n`);
  fs.renameSync(temp, file);
  return clean;
}

export function upsertAccounts(found: Array<Omit<ManagedAccount, 'id' | 'createdAt' | 'updatedAt' | 'label' | 'notes'> & {
  label?: string;
  notes?: string;
}>): ManagedAccount[] {
  const current = loadAccounts();
  const now = Date.now();
  for (const item of found) {
    const userId = cleanText(item.userId, 160);
    if (!userId) continue;
    const existing = current.find((account) => account.type === item.type && account.userId === userId);
    if (existing) {
      if (!existing.email && item.email) existing.email = cleanText(item.email, 160) || undefined;
      if (item.subscription) existing.subscription = item.subscription;
      existing.updatedAt = now;
      continue;
    }
    current.push({
      id: `acc_${item.type}_${userId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24)}_${now.toString(36)}`,
      type: item.type,
      userId,
      label: cleanText(item.label, 80),
      notes: cleanText(item.notes, 1000),
      email: cleanText(item.email, 160) || undefined,
      source: item.source,
      subscription: item.subscription,
      createdAt: now,
      updatedAt: now,
    });
  }
  return saveAccounts(current);
}

export function updateAccount(id: string, patch: { label?: string; notes?: string }): ManagedAccount | null {
  const accounts = loadAccounts();
  const account = accounts.find((item) => item.id === id);
  if (!account) return null;
  if (patch.label !== undefined) account.label = cleanText(patch.label, 80);
  if (patch.notes !== undefined) account.notes = cleanText(patch.notes, 1000);
  account.updatedAt = Date.now();
  saveAccounts(accounts);
  return account;
}

export function removeAccount(id: string): boolean {
  const accounts = loadAccounts();
  const next = accounts.filter((item) => item.id !== id);
  if (next.length === accounts.length) return false;
  saveAccounts(next);
  return true;
}

function publicUsage(record: TokenUsageRecord): TokenUsageRecord {
  const copy = { ...record } as Record<string, unknown>;
  for (const key of Object.keys(copy)) {
    if (TOKEN_KEY.test(key)) delete copy[key];
  }
  return copy as unknown as TokenUsageRecord;
}

export function loadUsageLedger(): TokenUsageRecord[] {
  try {
    return fs.readFileSync(usageFile(), 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => publicUsage(JSON.parse(line) as TokenUsageRecord));
  } catch {
    return [];
  }
}

export function saveUsageLedger(records: TokenUsageRecord[]): void {
  ensureDir();
  const file = usageFile();
  const temp = `${file}.${process.pid}.tmp`;
  const body = records.map((record) => JSON.stringify(publicUsage(record))).join('\n');
  fs.writeFileSync(temp, body ? `${body}\n` : '');
  fs.renameSync(temp, file);
}

export function attributeUsage(records: TokenUsageRecord[], accounts: ManagedAccount[]): TokenUsageRecord[] {
  const only = (type: AccountType) => accounts.filter((account) => account.type === type);
  const gpt = only('gpt');
  const claude = only('claude');
  const grok = only('grok');
  const agy = only('agy');
  return records.map((record) => {
    if (record.userId) return record;
    const client = record.client || '';
    const provider = record.provider || '';
    let userId = '';
    if ((client === 'codex' || /codex|openai/i.test(provider)) && gpt.length === 1) userId = gpt[0].userId;
    else if ((client === 'claude' || /anthropic/i.test(provider)) && claude.length === 1) userId = claude[0].userId;
    else if ((client === 'grokbuild' || /xai|grok/i.test(provider)) && grok.length === 1) userId = grok[0].userId;
    else if (/antigravity|gemini/i.test(provider) && agy.length === 1) userId = agy[0].userId;
    return userId ? { ...record, userId } : record;
  });
}

export function copyDataIfMissing(fromDir: string, toDir: string): void {
  if (!fromDir || fromDir === toDir) return;
  fs.mkdirSync(toDir, { recursive: true });
  for (const name of ['accounts.json', 'usage.jsonl', 'credentials.json']) {
    const source = path.join(fromDir, name);
    const target = path.join(toDir, name);
    if (fs.existsSync(source) && !fs.existsSync(target)) fs.copyFileSync(source, target);
  }
}
