export function formatTokens(num: number | null | undefined): string {
  const n = Number(num);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function formatUsd(num: number | null | undefined, digits = 3): string {
  const n = Number(num);
  if (!Number.isFinite(n)) return '$0.00';
  return `$${n.toFixed(digits)}`;
}

export function formatCnyFromUsd(num: number | null | undefined, rate = 7.25): string {
  const n = Number(num);
  if (!Number.isFinite(n)) return '¥0.00';
  return `¥${(n * rate).toFixed(2)}`;
}

export function formatDateTime(timestamp: number | null | undefined): string {
  const n = Number(timestamp);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const date = new Date(n);
  if (Number.isNaN(date.getTime())) return '—';
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${month}/${day} ${hh}:${mm}:${ss}`;
}

export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
