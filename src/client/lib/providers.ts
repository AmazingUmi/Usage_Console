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
  gpt: 'GPT',
  claude: 'Claude',
  grok: 'Grok',
  agy: 'AGY',
};

function matchesType(quota: ProviderQuota, type: AccountType): boolean {
  return TYPE_MATCH[type].test(quota.provider) || TYPE_MATCH[type].test(quota.displayName);
}

/** Only accounts explicitly added in settings get a quota card. */
export function quotaCardsForAccounts(live: ProviderQuota[], accounts: ConsoleAccount[]): ProviderQuota[] {
  const used = new Set<ProviderQuota>();
  return accounts.map((account) => {
    const match = live.find((item) => !used.has(item) && item.accountId && item.accountId === account.userId)
      || live.find((item) => !used.has(item) && matchesType(item, account.type));
    const snapshot = account.subscription;
    if (match) {
      used.add(match);
      return {
        ...match,
        displayName: account.label || match.displayName,
        plan: match.plan || snapshot?.plan,
        windows: match.windows?.length ? match.windows : snapshot?.windows,
        capturedAt: match.capturedAt || snapshot?.capturedAt || 0,
        status: match.windows?.length || snapshot?.windows?.length ? 'ok' : match.status,
        userId: account.userId,
        notes: account.notes,
        accountCardId: account.id,
      };
    }
    if (snapshot?.windows?.length) {
      return {
        provider: TYPE_PROVIDER[account.type],
        displayName: account.label || account.email || ACCOUNT_TYPE_LABEL[account.type],
        plan: snapshot.plan || '订阅',
        capturedAt: snapshot.capturedAt,
        status: 'ok',
        windows: snapshot.windows,
        userId: account.userId,
        notes: account.notes,
        accountCardId: account.id,
      };
    }
    return {
      provider: TYPE_PROVIDER[account.type],
      displayName: account.label || account.email || ACCOUNT_TYPE_LABEL[account.type],
      capturedAt: 0,
      status: 'unconfigured',
      errorMessage: account.type === 'claude'
        ? '已链接账户，但还没有订阅额度。请重新认证登录一次，使用 Claude 订阅账号，而不是 API Key。'
        : '已识别账户，但本机当前登录读不到该账户额度。',
      userId: account.userId,
      notes: account.notes,
      accountCardId: account.id,
    };
  });
}
