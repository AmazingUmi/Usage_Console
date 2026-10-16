import { usageStore } from '../usage/store.js';
import {
  attributeUsage,
  loadAccounts,
  loadUsageLedger,
  saveUsageLedger,
} from './library.js';
import type { ManagedAccount } from './library.js';

export async function calibrateData(): Promise<{ accounts: ManagedAccount[]; count: number }> {
  const accounts = loadAccounts();
  const scanned = await usageStore.sync();
  const source = scanned > 0 ? usageStore.getAllRecords() : loadUsageLedger();
  const attributed = attributeUsage(source, accounts);
  usageStore.replaceRecords(attributed);
  saveUsageLedger(attributed);
  return { accounts, count: attributed.length };
}
