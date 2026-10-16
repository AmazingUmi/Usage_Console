import fs from 'node:fs';
import path from 'node:path';
import { resolveDataDir } from '../settings.js';
import { proxyFetch as fetch } from '../network/proxy.js';

/**
 * Subscription logins owned by this console (OpenAI, Claude and Grok).
 *
 * An account added through "添加账户" authenticates against the provider's official OAuth flow and keeps
 * its own token pair here, so reading its quota never depends on Codex CLI, Claude Code, pi or any other tool,
 * and refreshing it cannot log those tools out (it is a separate grant).
 * The file lives in the data dir (never in the repo), is written 0600 but is not encrypted, and is separate from
 * accounts.json, which deliberately refuses anything that looks like a token.
 */

export type CredentialProvider = 'gpt' | 'claude' | 'grok';

export interface OAuthCredential {
  accountId: string;
  access: string;
  refresh: string;
  /** Epoch ms when `access` stops working. */
  expires: number;
  email?: string;
  updatedAt: number;
}

export class OAuthLoginError extends Error {}

const REFRESH: Record<CredentialProvider, {
  endpoints: string[];
  clientId: string;
  /** Standard OAuth servers (xAI) want a form body; OpenAI and Anthropic accept JSON. */
  form?: boolean;
  extra: Record<string, string>;
}> = {
  gpt: {
    endpoints: ['https://auth.openai.com/oauth/token'],
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    extra: { scope: 'openid profile email' },
  },
  claude: {
    endpoints: ['https://platform.claude.com/v1/oauth/token', 'https://console.anthropic.com/v1/oauth/token'],
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    extra: {},
  },
  grok: {
    endpoints: ['https://auth.x.ai/oauth2/token'],
    clientId: 'b1a00492-073a-47ea-816f-4c329264a828',
    form: true,
    extra: {},
  },
};

const EXPIRY_SKEW_MS = 2 * 60 * 1000;

type Store = Partial<Record<CredentialProvider, Record<string, OAuthCredential>>>;

function credentialsFile(): string {
  return path.join(resolveDataDir(), 'credentials.json');
}

function readStore(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(credentialsFile(), 'utf8')) as Store;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  const file = credentialsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}

export function listCredentials(provider: CredentialProvider): OAuthCredential[] {
  return Object.values(readStore()[provider] || {}).filter((item) => item?.accountId && item.refresh);
}

export function hasCredential(provider: CredentialProvider, accountId: string): boolean {
  return Boolean(readStore()[provider]?.[accountId]?.refresh);
}

export function saveCredential(provider: CredentialProvider, credential: OAuthCredential): void {
  const store = readStore();
  store[provider] = { ...store[provider], [credential.accountId]: credential };
  writeStore(store);
}

export function removeCredential(provider: CredentialProvider, accountId: string): void {
  const store = readStore();
  if (!store[provider] || !(accountId in store[provider]!)) return;
  delete store[provider]![accountId];
  writeStore(store);
}

export function credentialFromTokens(accountId: string, tokens: Record<string, unknown>, email?: string): OAuthCredential {
  const access = typeof tokens.access_token === 'string' ? tokens.access_token : '';
  const refresh = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : '';
  if (!access || !refresh) throw new Error('Signed in, but no refreshable token was returned; the account was not saved');
  const expiresIn = Number(tokens.expires_in) || 3600;
  return { accountId, access, refresh, expires: Date.now() + expiresIn * 1000, email, updatedAt: Date.now() };
}

const refreshing = new Map<string, Promise<OAuthCredential>>();

/** Refresh tokens rotate and are single use, so concurrent callers must share one refresh. */
function refreshCredential(provider: CredentialProvider, credential: OAuthCredential): Promise<OAuthCredential> {
  const key = `${provider}:${credential.accountId}`;
  const running = refreshing.get(key);
  if (running) return running;
  const job = (async () => {
    // Another caller may have refreshed while we waited; always start from what is on disk.
    const current = readStore()[provider]?.[credential.accountId] || credential;
    const spec = REFRESH[provider];
    let lastError: Error | null = null;
    for (const endpoint of spec.endpoints) {
      try {
        const fields = {
          grant_type: 'refresh_token',
          refresh_token: current.refresh,
          client_id: spec.clientId,
          ...spec.extra,
        };
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': spec.form ? 'application/x-www-form-urlencoded' : 'application/json',
            Accept: 'application/json',
          },
          body: spec.form ? new URLSearchParams(fields) : JSON.stringify(fields),
          signal: AbortSignal.timeout(15000),
        });
        if (res.status === 400 || res.status === 401) {
          throw new OAuthLoginError('Login expired or revoked; sign in again from "Add account"');
        }
        if (!res.ok) {
          lastError = new Error(`Token refresh failed (HTTP ${res.status})`);
          continue;
        }
        const data = (await res.json()) as Record<string, unknown>;
        const access = typeof data.access_token === 'string' ? data.access_token : '';
        if (!access) throw new Error('Token refresh returned no access token');
        const next: OAuthCredential = {
          ...current,
          access,
          refresh: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : current.refresh,
          expires: Date.now() + (Number(data.expires_in) || 3600) * 1000,
          updatedAt: Date.now(),
        };
        saveCredential(provider, next);
        return next;
      } catch (err) {
        if (err instanceof OAuthLoginError) throw err;
        lastError = err as Error;
      }
    }
    throw lastError || new Error('Token refresh failed');
  })().finally(() => {
    refreshing.delete(key);
  });
  refreshing.set(key, job);
  return job;
}

/**
 * Runs `query` with a working access token: refreshes first when the stored one is about to expire,
 * and once more if the server still answers 401.
 */
export async function withToken<T>(
  provider: CredentialProvider,
  credential: OAuthCredential,
  query: (token: string) => Promise<T>,
  isUnauthorized: (err: unknown) => boolean
): Promise<T> {
  let current = credential;
  if (!current.access || current.expires - EXPIRY_SKEW_MS <= Date.now()) current = await refreshCredential(provider, current);
  try {
    return await query(current.access);
  } catch (err) {
    if (!isUnauthorized(err)) throw err;
    return query((await refreshCredential(provider, current)).access);
  }
}
