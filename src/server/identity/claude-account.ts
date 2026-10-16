import type { ProviderQuota } from '../quota/types.js';
import { ClaudeHttpError, queryClaudeProfile, queryClaudeUsage } from './claude-subscription.js';
import type { OAuthCredential } from './credentials.js';
import { withToken } from './credentials.js';

/** Quota of a Claude account that logged in through this console, using its own refreshable OAuth grant. */

const PLAN_LABEL: Record<string, string> = { max: 'Max', pro: 'Pro', team: 'Team', enterprise: 'Enterprise', free: 'Free' };

const isUnauthorized = (err: unknown) => err instanceof ClaudeHttpError && err.status === 401;

/** Throws on failure (including ClaudeHttpError 401/429); the caller decides how to present it. */
export async function fetchClaudeAccountQuota(credential: OAuthCredential, label: string): Promise<ProviderQuota> {
  const accountId = credential.accountId;
  const result = await withToken('claude', credential, async (token) => {
    // Identity is cosmetic here; only an auth failure may abort, so withToken can refresh and retry.
    let plan: string | undefined;
    let email = credential.email;
    try {
      const profile = await queryClaudeProfile(token);
      plan = profile.plan;
      email = profile.email || email;
    } catch (err) {
      if (isUnauthorized(err)) throw err;
    }
    return { plan, email, subscription: await queryClaudeUsage(token, plan) };
  }, isUnauthorized);

  const displayName = `${label}${result.email ? ` (${result.email})` : ''}`;
  const planName = result.plan ? PLAN_LABEL[result.plan.toLowerCase()] || result.plan : undefined;
  if (!result.subscription) {
    return {
      provider: 'claude',
      displayName,
      plan: planName,
      capturedAt: Date.now(),
      status: 'warning',
      errorCode: 'no_subscription',
      errorMessage: 'Signed in, but this account returned no subscription quota (possibly an API-billed account).',
      accountId,
    };
  }
  return {
    provider: 'claude',
    displayName,
    plan: planName,
    capturedAt: result.subscription.capturedAt,
    status: 'ok',
    windows: result.subscription.windows,
    accountId,
  };
}
