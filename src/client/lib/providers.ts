import type { AccountType, ConsoleAccount, ProviderQuota } from '../types';

const TYPE_MATCH: Record<AccountType, RegExp> = {
  gpt: /codex|openai|gpt/i,
  claude: /claude|anthropic/i,
  grok: /grok|xai/i,
  agy: /antigravity|gemini|google/i,
};

const TYPE_PROVIDER: Record<AccountType, string> = {
  gpt: 'codex',
  claude: 'claude',
  grok: 'grok',
  agy: 'antigravity',
};

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  gpt: 'OpenAI',
  claude: 'Claude',
  grok: 'Grok',
  agy: 'AGY',
};

function matchesType(quota: ProviderQuota, type: AccountType): boolean {
  return TYPE_MATCH[type].test(quota.provider) || TYPE_MATCH[type].test(quota.displayName);
}

function stripEmail(name: string): string {
  return name.replace(/\s*\([^)]*@[^)]*\)\s*$/, '');
}

/**
 * One card per added account. What a card shows is decided here, in this order:
 *  1. needs a console login and has none            -> "not signed in" (known from settings, no waiting)
 *  2. quota not read yet (or the login just landed)  -> "loading"; the server being unreachable shows an error
 *  3. the server's reading                           -> ok / stale / rate limited / failed / login expired
 */
export function quotaCardsForAccounts(
  live: ProviderQuota[],
  accounts: ConsoleAccount[],
  state: { loaded: boolean; reachable: boolean },
): ProviderQuota[] {
  const used = new Set<ProviderQuota>();
  return accounts.map((account) => {
    const needsLogin = account.type !== 'agy';
    const base = {
      userId: account.userId,
      email: account.email,
      notes: account.notes,
      accountCardId: account.id,
      accountType: account.type,
      ownLogin: account.ownLogin,
      provider: TYPE_PROVIDER[account.type],
      displayName: account.label || ACCOUNT_TYPE_LABEL[account.type],
      capturedAt: 0,
    };

    if (needsLogin && !account.ownLogin) {
      return { ...base, status: 'unconfigured' as const, errorCode: 'login_required' as const };
    }

    const match = live.find((item) => !used.has(item) && item.accountId && item.accountId === account.userId)
      || live.find((item) => !used.has(item) && !item.accountId && matchesType(item, account.type));
    // Right after a login the server may still hold the "not signed in" card from before it; wait for the new read.
    const outdated = match?.errorCode === 'login_required';

    if (!match || outdated || !state.loaded) {
      if (match) used.add(match);
      return state.loaded || state.reachable
        ? { ...base, status: 'loading' as const }
        : { ...base, status: 'error' as const, errorCode: 'offline' as const };
    }

    used.add(match);
    return {
      ...match,
      ...base,
      displayName: account.label || stripEmail(match.displayName),
      plan: match.plan,
      capturedAt: match.capturedAt,
    };
  });
}
