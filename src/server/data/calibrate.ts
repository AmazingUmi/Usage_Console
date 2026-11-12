import { usageStore } from '../usage/store.js';
import type { CustomUsageSource, TokenUsageRecord } from '../usage/types.js';
import { loadSettings, resolveDataDir } from '../settings.js';
import {
  appendUsageLedger,
  attributeUsage,
  loadAccounts,
  loadUsageLedger,
} from './library.js';
import type { ManagedAccount } from './library.js';

let initialScan: Promise<void> | null = null;

interface UsageHistory {
  directory: string;
  byId: Map<string, TokenUsageRecord>;
  pending: Map<string, TokenUsageRecord>;
  records: TokenUsageRecord[];
  sources?: CustomUsageSource[];
}

let history: UsageHistory | undefined;

function newestFirst(records: Iterable<TokenUsageRecord>): TokenUsageRecord[] {
  return Array.from(records).sort((a, b) => b.timestamp - a.timestamp);
}

function changed(previous: TokenUsageRecord, scanned: TokenUsageRecord): boolean {
  if (previous === scanned) return false;
  for (const key of Object.keys(scanned) as Array<keyof TokenUsageRecord>) {
    if (scanned[key] !== undefined && previous[key] !== scanned[key]) return true;
  }
  return false;
}

function reconcileUsage(scanned: TokenUsageRecord[]): TokenUsageRecord[] {
  const directory = resolveDataDir();
  if (!history || history.directory !== directory) {
    const byId = loadUsageLedger();
    history = { directory, byId, pending: new Map(), records: newestFirst(byId.values()) };
  }
  const { byId, pending } = history;
  const store = (id: string, record: TokenUsageRecord) => {
    byId.set(id, record);
    pending.set(id, record);
  };

  for (const record of attributeUsage(scanned, loadAccounts())) {
    const id = record.id!;
    const previous = byId.get(id);
    if (!previous || changed(previous, record)) {
      store(id, previous ? { ...previous, ...record } : record);
    }
  }

  const sources = loadSettings().customUsageSources;
  if (history.sources !== sources) {
    const names = new Map(sources.map(({ id, harnessName }) => [id, harnessName]));
    for (const [id, record] of byId) {
      const harnessName = names.get(record.harnessSourceId ?? '');
      if (harnessName && harnessName !== record.harnessName) store(id, { ...record, harnessName });
    }
    history.sources = sources;
  }

  if (pending.size > 0) {
    appendUsageLedger(pending.values());
    pending.clear();
    history.records = newestFirst(byId.values());
  }
  return history.records;
}

export async function calibrateData(): Promise<{ accounts: ManagedAccount[]; count: number }> {
  const count = await usageStore.sync(reconcileUsage);
  return { accounts: loadAccounts(), count };
}

export async function ensureUsageReady(): Promise<void> {
  if (!initialScan && usageStore.getLastSyncTime() > 0) return;
  initialScan ??= usageStore.sync(reconcileUsage).then(() => undefined).finally(() => {
    initialScan = null;
  });
  await initialScan;
}

export async function refreshUsageCache(): Promise<void> {
  if (initialScan || usageStore.getLastSyncTime() === 0) {
    await ensureUsageReady();
  } else {
    await usageStore.sync(reconcileUsage);
  }
}
