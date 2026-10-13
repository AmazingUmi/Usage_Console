import { L } from '../i18n.js';
import crypto from 'node:crypto';
import type { ClaudeSubscription } from './claude-subscription.js';
import { queryClaudeSubscription } from './claude-subscription.js';
import type { OAuthCredential } from './credentials.js';
import { credentialFromTokens } from './credentials.js';

interface PendingCodex {
  userCode: string;
  expiresAt: number;
}

interface PendingGrok {
  expiresAt: number;
  interval: number;
}

interface PendingClaude {
  verifier: string;
  state: string;
  expiresAt: number;
}

interface IdentifiedAccount {
  type: 'gpt' | 'claude' | 'grok';
  userId: string;
  email?: string;
  subscription?: ClaudeSubscription;
}

/** What a finished login hands back; the caller stores `credential` and must not send it to the browser. */
export interface LoginResult extends IdentifiedAccount {
  credential: OAuthCredential;
}

const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CLAUDE_REDIRECT = 'https://console.anthropic.com/oauth/code/callback';
const CLAUDE_SCOPE = 'user:inference user:profile user:sessions:claude_code user:mcp_servers user:file_upload';

const GROK_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const GROK_SCOPE = 'openid profile email offline_access grok-cli:access api:access';

const codexPending = new Map<string, PendingCodex>();
const grokPending = new Map<string, PendingGrok>();
const claudePending = new Map<string, PendingClaude>();

function jwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function codexIdentity(accessToken: string, idToken?: string): IdentifiedAccount {
  const payload = jwtPayload(idToken || '') || jwtPayload(accessToken);
  const auth = payload?.['https://api.openai.com/auth'];
  const claim = auth && typeof auth === 'object' ? auth as Record<string, unknown> : {};
  const userId = text(claim.chatgpt_account_id) || text(payload?.sub);
  if (!userId) throw new Error(L('登录成功，但没有识别到用户 ID，未保存账户', 'Signed in, but the user ID could not be identified; the account was not saved'));
  return { type: 'gpt', userId, email: text(payload?.email) || text(claim.email) || undefined };
}

export async function startCodexLogin(): Promise<{
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
}> {
  const res = await fetch('https://auth.openai.com/api/accounts/deviceauth/usercode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(L(`无法开始 Codex 登录（HTTP ${res.status}）`, `Could not start the Codex login (HTTP ${res.status})`));
  const data = await res.json() as Record<string, unknown>;
  const deviceCode = text(data.device_auth_id);
  const userCode = text(data.user_code);
  if (!deviceCode || !userCode) throw new Error(L('登录服务没有返回设备码', 'The login service returned no device code'));
  const expiresIn = Number(data.expires_in) || 600;
  codexPending.set(deviceCode, { userCode, expiresAt: Date.now() + expiresIn * 1000 });
  return {
    deviceCode,
    userCode,
    verificationUri: 'https://auth.openai.com/codex/device',
    interval: Number(data.interval) || 5,
  };
}

export async function pollCodexLogin(deviceCode: string): Promise<{ pending: true } | LoginResult> {
  const pending = codexPending.get(deviceCode);
  if (!pending) throw new Error(L('登录已失效，请重新开始', 'This login attempt expired; please start again'));
  if (pending.expiresAt <= Date.now()) {
    codexPending.delete(deviceCode);
    throw new Error(L('登录码已过期', 'The login code has expired'));
  }
  const poll = await fetch('https://auth.openai.com/api/accounts/deviceauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ device_auth_id: deviceCode, user_code: pending.userCode }),
    signal: AbortSignal.timeout(15000),
  });
  if (poll.status === 403 || poll.status === 404) return { pending: true };
  if (!poll.ok) throw new Error(L(`登录未完成（HTTP ${poll.status}）`, `Login did not complete (HTTP ${poll.status})`));
  const granted = await poll.json() as Record<string, unknown>;
  const tokenRes = await fetch('https://auth.openai.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: text(granted.authorization_code),
      redirect_uri: 'https://auth.openai.com/deviceauth/callback',
      client_id: CODEX_CLIENT_ID,
      code_verifier: text(granted.code_verifier),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!tokenRes.ok) throw new Error(L(`无法确认登录身份（HTTP ${tokenRes.status}）`, `Could not confirm the login identity (HTTP ${tokenRes.status})`));
  const tokens = await tokenRes.json() as Record<string, unknown>;
  codexPending.delete(deviceCode);
  const identity = codexIdentity(text(tokens.access_token), text(tokens.id_token));
  return { ...identity, credential: credentialFromTokens(identity.userId, tokens, identity.email) };
}

export function startClaudeLogin(): { state: string; authorizeUrl: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  claudePending.set(state, { verifier, state, expiresAt: Date.now() + 10 * 60 * 1000 });
  const url = new URL('https://claude.ai/oauth/authorize');
  url.searchParams.set('code', 'true');
  url.searchParams.set('client_id', CLAUDE_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', CLAUDE_REDIRECT);
  url.searchParams.set('scope', CLAUDE_SCOPE);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  return { state, authorizeUrl: url.toString() };
}

export async function finishClaudeLogin(state: string, rawCode: string): Promise<LoginResult> {
  const pending = claudePending.get(state);
  if (!pending || pending.expiresAt <= Date.now()) {
    claudePending.delete(state);
    throw new Error(L('登录已失效，请重新开始', 'This login attempt expired; please start again'));
  }
  const code = rawCode.trim().split('#')[0];
  if (!code) throw new Error(L('请粘贴登录页返回的 code', 'Paste the code shown on the login page'));
  const tokenRes = await fetch('https://console.anthropic.com/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: CLAUDE_REDIRECT,
      client_id: CLAUDE_CLIENT_ID,
      code_verifier: pending.verifier,
      state,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!tokenRes.ok) throw new Error(L(`Claude 登录未完成（HTTP ${tokenRes.status}）`, `Claude login did not complete (HTTP ${tokenRes.status})`));
  const tokens = await tokenRes.json() as Record<string, unknown>;
  const accessToken = text(tokens.access_token);
  claudePending.delete(state);
  const identified = await queryClaudeSubscription(accessToken);
  if (!identified.subscription) {
    throw new Error(L('已识别账户，但没有读到 Claude 订阅额度。请确认登录的是 Pro/Max/Team 订阅，而不是 API Key。', 'The account was identified but no Claude subscription quota was returned. Make sure you signed in with a Pro/Max/Team subscription, not an API key.'));
  }
  return {
    type: 'claude',
    userId: identified.userId,
    email: identified.email,
    subscription: identified.subscription,
    credential: credentialFromTokens(identified.userId, tokens, identified.email),
  };
}

/** xAI uses a standard RFC 8628 device flow against auth.x.ai, with the same public client as Grok CLI. */
export async function startGrokLogin(): Promise<{
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
}> {
  const res = await fetch('https://auth.x.ai/oauth2/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: GROK_CLIENT_ID, scope: GROK_SCOPE }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(L(`无法开始 Grok 登录（HTTP ${res.status}）`, `Could not start the Grok login (HTTP ${res.status})`));
  const data = await res.json() as Record<string, unknown>;
  const deviceCode = text(data.device_code);
  const userCode = text(data.user_code);
  if (!deviceCode || !userCode) throw new Error(L('登录服务没有返回设备码', 'The login service returned no device code'));
  const interval = Number(data.interval) || 5;
  grokPending.set(deviceCode, { expiresAt: Date.now() + (Number(data.expires_in) || 600) * 1000, interval });
  return {
    deviceCode,
    userCode,
    verificationUri: text(data.verification_uri_complete) || text(data.verification_uri) || 'https://auth.x.ai/device',
    interval,
  };
}

export async function pollGrokLogin(deviceCode: string): Promise<{ pending: true } | LoginResult> {
  const pending = grokPending.get(deviceCode);
  if (!pending) throw new Error(L('登录已失效，请重新开始', 'This login attempt expired; please start again'));
  if (pending.expiresAt <= Date.now()) {
    grokPending.delete(deviceCode);
    throw new Error(L('登录码已过期', 'The login code has expired'));
  }
  const res = await fetch('https://auth.x.ai/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: GROK_CLIENT_ID,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const tokens = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    const code = text(tokens.error);
    if (code === 'authorization_pending' || code === 'slow_down') return { pending: true };
    grokPending.delete(deviceCode);
    throw new Error(code === 'access_denied' ? L('你在授权页拒绝了登录', 'You declined the login on the authorization page') : L(`Grok 登录未完成（${code || `HTTP ${res.status}`}）`, `Grok login did not complete (${code || `HTTP ${res.status}`})`));
  }
  grokPending.delete(deviceCode);
  const payload = jwtPayload(text(tokens.id_token)) || jwtPayload(text(tokens.access_token));
  const userId = text(payload?.sub) || text(payload?.principal_id);
  if (!userId) throw new Error(L('登录成功，但没有识别到用户 ID，未保存账户', 'Signed in, but the user ID could not be identified; the account was not saved'));
  const email = text(payload?.email) || undefined;
  return { type: 'grok', userId, email, credential: credentialFromTokens(userId, tokens, email) };
}
