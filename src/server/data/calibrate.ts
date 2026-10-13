import { usageStore } from '../usage/store.js';
import {
  attributeUsage,
  loadAccounts,
  loadUsageLedger,
  saveUsageLedger,
  upsertAccounts,
} from './library.js';
import { scanLocalIdentities } from '../identity/scan.js';
import type { ManagedAccount } from './library.js';

export async function calibrateData(): Promise<{ accounts: ManagedAccount[]; count: number }> {
  const identities = await scanLocalIdentities();
  const accounts = upsertAccounts(identities);
  const scanned = await usageStore.sync();
  const source = scanned > 0 ? usageStore.getAllRecords() : loadUsageLedger();
  const attributed = attributeUsage(source, accounts);
  usageStore.replaceRecords(attributed);
  saveUsageLedger(attributed);
  return { accounts, count: attributed.length };
}
