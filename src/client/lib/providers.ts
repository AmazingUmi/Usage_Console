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

function stripEmail(name: string): string {
  return name.replace(/\s*\([^)]*@[^)]*\)\s*$/, '');
}

/** Only accounts explicitly added in settings get a quota card. */
export function quotaCardsForAccounts(live: ProviderQuota[], accounts: ConsoleAccount[]): ProviderQuota[] {
  const used = new Set<ProviderQuota>();
  return accounts.map((account) => {
    const match = live.find((item) => !used.has(item) && item.accountId && item.accountId === account.userId)
      || live.find((item) => !used.has(item) && !item.accountId && matchesType(item, account.type))
      || live.find((item) => !used.has(item) && matchesType(item, account.type) && !accounts.some((other) => other.userId === item.accountId));
    const snapshot = account.subscription;
    const base = {
      userId: account.userId,
      email: account.email,
      notes: account.notes,
      accountCardId: account.id,
    };
    if (match) {
      used.add(match);
      const liveWindows = match.windows?.length ? match.windows : undefined;
      const stale = !liveWindows && snapshot?.windows?.length && match.status !== 'ok';
      return {
        ...match,
        ...base,
        displayName: account.label || stripEmail(match.displayName),
        plan: match.plan || snapshot?.plan,
        windows: liveWindows || snapshot?.windows,
        capturedAt: liveWindows ? match.capturedAt : snapshot?.capturedAt || match.capturedAt || 0,
        status: stale ? 'warning' : match.status,
        errorMessage: stale
          ? `${match.errorMessage || '实时读取失败'}（下方为上次读数）`
          : match.errorMessage,
      };
    }
    if (snapshot?.windows?.length) {
      return {
        ...base,
        provider: TYPE_PROVIDER[account.type],
        displayName: account.label || ACCOUNT_TYPE_LABEL[account.type],
        plan: snapshot.plan || '订阅',
        capturedAt: snapshot.capturedAt,
        status: 'warning',
        errorMessage: '本机当前登录不是这个账户，显示的是上次读数。',
        windows: snapshot.windows,
      };
    }
    return {
      ...base,
      provider: TYPE_PROVIDER[account.type],
      displayName: account.label || ACCOUNT_TYPE_LABEL[account.type],
      capturedAt: 0,
      status: 'unconfigured',
      errorMessage: account.type === 'claude'
        ? '本机 Claude Code 当前登录的不是这个账户，或尚未登录。运行 claude 并 /login 后点刷新。'
        : '已识别账户，但本机当前登录读不到该账户额度。',
    };
  });
}
