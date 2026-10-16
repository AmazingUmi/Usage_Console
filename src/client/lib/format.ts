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

export function formatMillis(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

export function formatTokPerSec(value: number | null | undefined, locale?: string): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value >= 100
    ? Math.round(value).toLocaleString(locale)
    : value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
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

/** Compact countdown such as `1h50m`, `2d3h` or `45m`; language-neutral on purpose. */
export function formatCompactDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '<1m';
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 1) return '<1m';
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/** Age as one short unit (`5m`, `2h`, `3d`); null when it is under a minute. */
export function formatAgeShort(ms: number): string | null {
  const minutes = Math.floor(ms / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return null;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
