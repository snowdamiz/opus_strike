export const LAMPORTS_PER_SOL = 1_000_000_000;

const numberFmt = new Intl.NumberFormat('en-US');

export type Numeric = number | string | null | undefined;

/** Coerce a possibly-stringified number (serialized BigInt) into a number. */
export function toNumber(value: Numeric): number {
  if (value == null) return NaN;
  if (typeof value === 'number') return value;
  const trimmed = value.trim();
  if (trimmed === '') return NaN;
  return Number(trimmed);
}

export function formatNumber(value: Numeric): string {
  const n = toNumber(value);
  if (Number.isNaN(n)) return '—';
  return numberFmt.format(n);
}

export function lamportsToSol(lamports: Numeric): number {
  const n = toNumber(lamports);
  if (Number.isNaN(n)) return 0;
  return n / LAMPORTS_PER_SOL;
}

export function solToLamports(sol: Numeric): number {
  const n = toNumber(sol);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * LAMPORTS_PER_SOL);
}

export function formatSol(lamports: Numeric, maxDecimals = 6): string {
  const sol = lamportsToSol(lamports);
  return `${sol.toLocaleString('en-US', { maximumFractionDigits: maxDecimals })} SOL`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || Number.isNaN(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatPercent(fraction: number | null | undefined, decimals = 0): string {
  if (fraction == null || Number.isNaN(fraction)) return '—';
  return `${(fraction * 100).toFixed(decimals)}%`;
}

export function formatBps(bps: number | null | undefined): string {
  if (bps == null || Number.isNaN(bps)) return '—';
  return `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}

export function truncateAddress(address: string | null | undefined, lead = 4, tail = 4): string {
  if (!address) return '—';
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

function toMillis(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function formatRelativeTime(value: string | number | null | undefined): string {
  const ms = toMillis(value);
  if (ms == null) return '—';
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? 'ago' : 'from now';
  const sec = Math.round(abs / 1000);
  if (sec < 60) return `${sec}s ${suffix}`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ${suffix}`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ${suffix}`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ${suffix}`;
  const month = Math.round(day / 30);
  if (month < 12) return `${month}mo ${suffix}`;
  return `${Math.round(month / 12)}y ${suffix}`;
}

export function formatDateTime(value: string | number | null | undefined): string {
  const ms = toMillis(value);
  if (ms == null) return '—';
  return new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
