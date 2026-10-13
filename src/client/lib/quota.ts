import type { ProviderQuota, QuotaGroup, QuotaWindow } from '../types';

export function isClaudeQuotaGroup(group: QuotaGroup): boolean {
  return /claude/i.test(group.name || '');
}

export function collectQuotaWindows(
  quota: ProviderQuota,
  includeAgyClaude: boolean,
): { windows: QuotaWindow[]; groupLabel?: string; hiddenClaude: boolean; hasClaudeGroup: boolean } {
  if (quota.windows && quota.windows.length > 0) {
    return { windows: quota.windows, hiddenClaude: false, hasClaudeGroup: false };
  }

  const groups = quota.groups || [];
  if (groups.length === 0) {
    return { windows: [], hiddenClaude: false, hasClaudeGroup: false };
  }

  const claudeGroups = groups.filter(isClaudeQuotaGroup);
  const otherGroups = groups.filter((group) => !isClaudeQuotaGroup(group));
  const hasClaudeGroup = claudeGroups.length > 0;
  const hideClaude = hasClaudeGroup && !includeAgyClaude && otherGroups.length > 0;
  const visible = hideClaude ? otherGroups : groups;

  return {
    windows: visible.flatMap((group) => group.windows || []),
    groupLabel: visible.length === 1 ? visible[0].name : undefined,
    hiddenClaude: hideClaude,
    hasClaudeGroup,
  };
}
