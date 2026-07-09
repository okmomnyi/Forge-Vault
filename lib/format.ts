/** Format a KES price (stored as a NUMERIC string) with thousands separators. */
export function formatKes(value: string | number): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 'KSh —';
  return `KSh ${n.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
}

/** e.g. "2015–2019", "2015+", "up to 2019", or "" if no years given. */
export function formatYearRange(start: number | null, end: number | null): string {
  if (start && end) return `${start}–${end}`;
  if (start) return `${start}+`;
  if (end) return `up to ${end}`;
  return '';
}
