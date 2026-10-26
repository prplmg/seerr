import type { TasteRating, Viewing } from './discoveryRecommendations';
export function recentUnrated(
  userId: number,
  watched: readonly Viewing[],
  ratings: readonly TasteRating[],
  now = Date.now()
) {
  const rated = new Set(
    ratings
      .filter((r) => r.userId === userId && r.type === 'movie')
      .map((r) => r.tmdbId)
  );
  const latest = new Map<number, Viewing>();
  for (const w of watched) {
    if (
      w.userId !== userId ||
      w.type !== 'movie' ||
      !w.at ||
      w.at > now ||
      w.at < now - 8 * 86400000 ||
      rated.has(w.tmdbId)
    )
      continue;
    if ((latest.get(w.tmdbId)?.at || 0) < w.at) latest.set(w.tmdbId, w);
  }
  return [...latest.values()]
    .sort((a, b) => b.at! - a.at!)
    .map(({ type, tmdbId }) => ({ type, tmdbId }));
}
