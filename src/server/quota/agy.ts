import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ProviderQuota, QuotaGroup, QuotaWindow } from './types.js';

/**
 * Antigravity quota, read through the agy CLI itself: `agy --print /usage --output-format json`.
 * agy answers from its own logged-in session, so this console needs no OAuth client or token for it.
 * Requires agy to be installed and signed in on this machine. Takes ~8s, hence the cache and shared in-flight run.
 */

export const AGY_ACCOUNT_ID = 'agy-local';

const TIMEOUT_MS = 40_000;
const CACHE_MS = 30_000;
const MAX_OUTPUT = 1024 * 1024;

export class AgyUnavailableError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** AGY_BINARY, then PATH, then the locations agy installs itself to. Never run through a shell. */
export async function findAgyBinary(): Promise<string> {
  if (process.env.AGY_BINARY) return process.env.AGY_BINARY;
  const exe = process.platform === 'win32' ? 'agy.exe' : 'agy';
  const candidates = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, exe));
  candidates.push(
    path.join(os.homedir(), '.local', 'bin', exe),
    path.join(os.homedir(), '.gemini', 'bin', exe),
  );
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next location.
    }
  }
  throw new AgyUnavailableError('agy binary not found');
}

function run(binary: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const seconds = Math.ceil(TIMEOUT_MS / 1000) - 5;
    const child = spawn(binary, ['--print', '/usage', '--output-format', 'json', '--print-timeout', `${seconds}s`], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    let output = '';
    let settled = false;
    const stop = () => {
      if (!child.pid) return;
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill();
      } catch {
        // Already gone.
      }
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output);
    };
    const timer = setTimeout(() => {
      stop();
      finish(new Error('agy usage timed out'));
    }, TIMEOUT_MS);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      output += chunk;
      if (output.length > MAX_OUTPUT) {
        stop();
        finish(new Error('agy usage response too large'));
      }
    });
    child.on('error', () => finish(new AgyUnavailableError('agy binary failed to start')));
    child.on('close', (code) => finish(code === 0 ? undefined : new Error(`agy usage exited with code ${code}`)));
  });
}

function resetAt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e11 ? value * 1000 : value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

const WINDOW_MINUTES: Record<string, number> = { '5h': 300, weekly: 10080 };

export function parseAgyUsage(text: string): QuotaGroup[] {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('agy returned invalid JSON');
  }
  if (!isRecord(payload)) throw new Error('agy returned an unexpected response');
  const result = payload.event === 'result' && isRecord(payload.result) ? payload.result : payload;
  if (result.status !== undefined && result.status !== 'SUCCESS' && result.status !== 'OK') {
    throw new Error('agy usage command failed (is agy signed in?)');
  }
  const command = isRecord(result.command) ? result.command : undefined;
  const data = isRecord(command?.data) ? command.data : isRecord(result.data) ? result.data : undefined;
  if (!data || !Array.isArray(data.groups)) throw new Error('agy returned no quota groups');

  const groups: QuotaGroup[] = [];
  for (const raw of data.groups) {
    if (!isRecord(raw) || !Array.isArray(raw.buckets)) continue;
    const windows: QuotaWindow[] = [];
    for (const bucket of raw.buckets) {
      if (!isRecord(bucket)) continue;
      const fraction = Number(bucket.remaining_fraction ?? bucket.remainingFraction ?? bucket.remaining);
      if (!Number.isFinite(fraction)) continue;
      const reset = resetAt(bucket.reset_time ?? bucket.resetTime);
      const minutes = typeof bucket.window === 'string' ? WINDOW_MINUTES[bucket.window] : undefined;
      windows.push({
        label: String(bucket.name ?? bucket.id ?? 'Quota'),
        remainingPercent: Math.max(0, Math.min(100, fraction * 100)),
        ...(reset ? { resetAt: reset } : {}),
        ...(minutes ? { windowMinutes: minutes } : {}),
      });
    }
    if (windows.length > 0) groups.push({ name: String(raw.name ?? 'Quota group'), windows });
  }
  if (groups.length === 0) throw new Error('agy returned no quota groups');
  return groups;
}

let cached: { at: number; quota: ProviderQuota } | null = null;
let inflight: Promise<ProviderQuota> | null = null;

export async function queryAgyQuota(force = false): Promise<ProviderQuota> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.quota;
  if (inflight) return inflight;
  inflight = (async () => {
    const groups = parseAgyUsage(await run(await findAgyBinary()));
    const quota: ProviderQuota = {
      provider: 'antigravity',
      displayName: 'Google Antigravity',
      capturedAt: Date.now(),
      status: 'ok',
      groups,
      accountId: AGY_ACCOUNT_ID,
    };
    cached = { at: Date.now(), quota };
    return quota;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
