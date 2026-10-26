export function reviewLookback(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return '28';
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= 365
    ? String(days)
    : undefined;
}
