import type { MovieReview } from '@server/entity/MovieReview';

type RatingRow = Pick<
  MovieReview,
  | 'id'
  | 'userId'
  | 'source'
  | 'entryKind'
  | 'rating'
  | 'publishedAt'
  | 'updatedAt'
  | 'episodeNumber'
>;

/** One vote per member, across local and imported entries. Import timestamps
 * must not make an old Letterboxd rating look newer than a local edit. */
export function communityRating(rows: readonly RatingRow[]) {
  const users = new Map<number, RatingRow[]>();
  for (const row of rows) {
    if (row.episodeNumber != null) continue;
    users.set(row.userId, [...(users.get(row.userId) || []), row]);
  }
  const stamp = (row: RatingRow) =>
    row.source === 'local' ? row.updatedAt : row.publishedAt;
  const newest = (values: RatingRow[]) =>
    values.sort(
      (a, b) =>
        stamp(b).localeCompare(stamp(a)) ||
        (a.source === b.source
          ? b.id.localeCompare(a.id)
          : a.source === 'local'
            ? -1
            : 1)
    )[0];
  const ratings: number[] = [];
  for (const entries of users.values()) {
    const local = newest(
      entries.filter((r) => r.source === 'local' && r.rating != null)
    );
    const imported = entries.filter((r) => r.source === 'letterboxd');
    const summary = newest(imported.filter((r) => r.entryKind === 'summary'));
    // A current film summary, including a removed rating, supersedes historical
    // diary ratings. Before full reconciliation, fall back to the latest RSS rating.
    const remote = summary || newest(imported.filter((r) => r.rating != null));
    const latest = newest([local, remote].filter((r): r is RatingRow => !!r));
    if (
      latest?.rating != null &&
      Number.isFinite(latest.rating) &&
      latest.rating >= 0.5 &&
      latest.rating <= 5
    )
      ratings.push(latest.rating);
  }
  return {
    average: ratings.length
      ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length
      : null,
    count: ratings.length,
  };
}
