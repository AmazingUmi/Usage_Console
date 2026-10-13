import type { ProviderQuota } from '../types';

const PROVIDER_SLOTS = [
  { provider: 'codex', displayName: 'OpenAI Codex', match: /codex|openai/i },
  { provider: 'claude', displayName: 'Claude', match: /claude|anthropic/i },
  { provider: 'grok', displayName: 'xAI Grok', match: /grok|xai/i },
  { provider: 'antigravity', displayName: 'Antigravity', match: /antigravity|gemini|google/i },
] as const;

function matchesSlot(quota: ProviderQuota, slot: (typeof PROVIDER_SLOTS)[number]): boolean {
  return slot.match.test(quota.provider) || slot.match.test(quota.displayName);
}

export function withProviderPlaceholders(providers: ProviderQuota[]): ProviderQuota[] {
  const extras: ProviderQuota[] = [];
  const ordered: ProviderQuota[] = [];
  const used = new Set<ProviderQuota>();

  for (const slot of PROVIDER_SLOTS) {
    const matches = providers.filter((item) => matchesSlot(item, slot));
    if (matches.length === 0) {
      ordered.push({
        provider: slot.provider,
        displayName: slot.displayName,
        capturedAt: 0,
        status: 'unconfigured',
      });
      continue;
    }
    for (const item of matches) {
      ordered.push(item);
      used.add(item);
    }
  }

  for (const item of providers) {
    if (!used.has(item)) extras.push(item);
  }

  return [...ordered, ...extras];
}
