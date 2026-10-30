/** Date-only diary entries use their recorded calendar day; playback uses its exact time. */
export function recentUnratedViewing(
  viewing: { date: string; occurredAt?: number } | null,
  ratings: { rating: number | null; publishedAt: string | Date }[],
  now = Date.now()
): boolean {
  if (!viewing) return false;
  const watchedAt = viewing.occurredAt ?? Date.parse(`${viewing.date}T00:00:00Z`);
  if (!Number.isFinite(watchedAt) || watchedAt > now || now - watchedAt > 30 * 86400000) return false;
  return !ratings.some(r => r.rating !== null && Date.parse(String(r.publishedAt)) >= watchedAt);
}
