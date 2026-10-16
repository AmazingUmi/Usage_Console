import type { ProviderQuota, QuotaGroup, QuotaWindow } from '../types';

/** Shorter windows first (5 hours, then weekly), whatever order the provider listed them in. */
function windowRank(window: QuotaWindow): number {
  if (window.windowMinutes) return window.windowMinutes;
  const label = window.label || '';
  if (/5\s*-?\s*hour|five\s*hour|5\s*小时/i.test(label)) return 300;
  if (/week|每周/i.test(label)) return 10080;
  return Number.MAX_SAFE_INTEGER;
}

export function sortWindows(windows: QuotaWindow[]): QuotaWindow[] {
  return windows
    .map((window, index) => ({ window, index }))
    .sort((a, b) => windowRank(a.window) - windowRank(b.window) || a.index - b.index)
    .map((item) => item.window);
}

export function isClaudeQuotaGroup(group: QuotaGroup): boolean {
  return /claude/i.test(group.name || '');
}

export function collectQuotaWindows(
  quota: ProviderQuota,
  includeAgyClaude: boolean,
): { windows: QuotaWindow[]; groupLabel?: string; hiddenClaude: boolean; hasClaudeGroup: boolean } {
  if (quota.windows && quota.windows.length > 0) {
    return { windows: sortWindows(quota.windows), hiddenClaude: false, hasClaudeGroup: false };
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
    windows: visible.flatMap((group) => sortWindows(group.windows || [])),
    groupLabel: visible.length === 1 ? visible[0].name : undefined,
    hiddenClaude: hideClaude,
    hasClaudeGroup,
  };
}
