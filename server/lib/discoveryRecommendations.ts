import type { MovieReview } from '@server/entity/MovieReview';
import { communityRating } from './communityRating';
import { filmKey, type DiscoveryList, type ListFilm } from './discoveryLists';
export type TasteRating = ListFilm & {
  userId: number;
  rating: number;
  date: string;
};
export type Viewing = ListFilm & { userId: number; at?: number };
export function catalogueTasteRatings(rows: MovieReview[]): TasteRating[] {
  const groups = new Map<string, MovieReview[]>();
  for (const r of rows) {
    if (r.episodeNumber != null || r.seasonNumber != null) continue;
    const key = `${r.userId}:${r.mediaType}:${r.tmdbId}`;
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  const result: TasteRating[] = [];
  for (const group of groups.values()) {
    const rating = communityRating(group).average;
    if (rating === null) continue;
    const row = group[0];
    result.push({
      type: row.mediaType,
      tmdbId: row.tmdbId,
      userId: row.userId,
      rating,
      date: '1970-01-01T00:00:00Z',
    });
  }
  return result;
}
// Soft diversity: broad lists are not categories; only bounded, specific lists
// may lower the next pick. Never discard a candidate or change list ordering.
export function diversify<T extends ListFilm & { score: number }>(
  ranked: T[],
  lists: DiscoveryList[]
) {
  const groups = lists
    .filter((l) => l.items.length >= 2 && l.items.length <= 100)
    .map((l) => new Set(l.items.map(filmKey)));
  const used = groups.map(() => 0),
    remaining = [...ranked],
    result: T[] = [];
  while (remaining.length && result.length < 60) {
    let best = 0,
      bestScore = -Infinity;
    for (let i = 0; i < Math.min(remaining.length, 200); i++) {
      const key = filmKey(remaining[i]);
      const penalty = Math.max(
        0,
        ...groups.map((g, j) => (g.has(key) ? used[j] * 0.15 : 0))
      );
      const score = remaining[i].score - penalty;
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    }
    const [pick] = remaining.splice(best, 1);
    result.push(pick);
    groups.forEach((g, j) => {
      if (g.has(filmKey(pick))) used[j]++;
    });
  }
  return [...result, ...remaining];
}
export function latestRatings(rows: TasteRating[]) {
  const latest = new Map<string, TasteRating>();
  for (const r of rows) {
    if (
      !Number.isFinite(r.rating) ||
      r.rating < 0.5 ||
      r.rating > 5 ||
      !Number.isFinite(Date.parse(r.date))
    )
      continue;
    const key = `${r.userId}:${filmKey(r)}`,
      old = latest.get(key);
    if (!old || Date.parse(r.date) > Date.parse(old.date)) latest.set(key, r);
  }
  return [...latest.values()];
}
export function tasteNeighbours(userId: number, input: TasteRating[]) {
  const rows = latestRatings(input),
    mine = new Map(
      rows.filter((r) => r.userId === userId).map((r) => [filmKey(r), r.rating])
    );
  return [...new Set(rows.map((r) => r.userId))]
    .filter((id) => id !== userId)
    .map((id) => {
      const pairs = rows
        .filter((r) => r.userId === id && mine.has(filmKey(r)))
        .map((r) => [mine.get(filmKey(r))!, r.rating]);
      const n = pairs.length;
      if (n < 5) return { userId: id, overlap: n, similarity: 0 };
      const a = pairs.reduce((s, p) => s + p[0], 0) / n,
        b = pairs.reduce((s, p) => s + p[1], 0) / n;
      let numerator = 0,
        aa = 0,
        bb = 0;
      for (const [x, y] of pairs) {
        numerator += (x - a) * (y - b);
        aa += (x - a) ** 2;
        bb += (y - b) ** 2;
      }
      return {
        userId: id,
        overlap: n,
        similarity:
          aa && bb
            ? (Math.max(0, numerator / Math.sqrt(aa * bb)) * n) / (n + 10)
            : 0,
      };
    })
    .filter((n) => n.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity);
}
export function recommend(
  userIds: number[],
  input: TasteRating[],
  watched: Viewing[],
  candidates: ListFilm[]
) {
  const rows = latestRatings(input),
    seen = new Set(
      watched.filter((v) => userIds.includes(v.userId)).map(filmKey)
    );
  for (const r of rows) if (userIds.includes(r.userId)) seen.add(filmKey(r));
  const neighbours = new Map(
    userIds.map((id) => [id, tasteNeighbours(id, rows)])
  );
  const means = new Map(
    [...new Set(rows.map((r) => r.userId))].map((id) => {
      const r = rows.filter((r) => r.userId === id);
      return [id, r.reduce((s, r) => s + r.rating, 0) / r.length];
    })
  );
  const votesByFilm = new Map<string, TasteRating[]>();
  for (const r of rows) {
    if (userIds.includes(r.userId)) continue;
    const key = filmKey(r);
    const votes = votesByFilm.get(key);
    if (votes) votes.push(r);
    else votesByFilm.set(key, [r]);
  }
  return [...new Map(candidates.map((f) => [filmKey(f), f])).values()]
    .filter((f) => !seen.has(filmKey(f)))
    .map((f) => {
      const votes = votesByFilm.get(filmKey(f)) || [];
      const community =
        (votes.reduce((s, r) => s + r.rating, 0) + 3 * 5) / (votes.length + 5);
      const scores = userIds.map((id) => {
        const ns = neighbours.get(id)!;
        const weighted = votes
          .map((r) => ({ r, n: ns.find((n) => n.userId === r.userId) }))
          .filter((v) => v.n);
        const weight = weighted.reduce((s, v) => s + v.n!.similarity, 0);
        return weight
          ? community +
              weighted.reduce(
                (s, v) =>
                  s + v.n!.similarity * (v.r.rating - means.get(v.r.userId)!),
                0
              ) /
                (weight + 1)
          : community;
      });
      return {
        ...f,
        score: Math.min(...scores),
        supporters: votes.filter((v) => v.rating >= 4).map((v) => v.userId),
        matches:
          userIds.length === 1
            ? neighbours
                .get(userIds[0])!
                .filter((n) =>
                  votes.some((r) => r.userId === n.userId && r.rating >= 4)
                )
                .slice(0, 3)
            : [],
      };
    })
    .sort((a, b) => b.score - a.score || filmKey(a).localeCompare(filmKey(b)));
}

/** Explicit watchlists outrank inferred taste. Within each overlap count,
 * taste still decides, with a small bonus for each participant's named lists. */
export function prioritizeTogether<T extends ListFilm & { score: number }>(
  ranked: T[],
  userIds: number[],
  watchlists: (ListFilm & { userId: number })[],
  listInterests: (ListFilm & { userId: number })[]
) {
  const members = new Set(userIds);
  const index = (rows: (ListFilm & { userId: number })[]) => {
    const result = new Map<string, Set<number>>();
    for (const row of rows)
      if (members.has(row.userId)) {
        const key = filmKey(row);
        if (!result.has(key)) result.set(key, new Set());
        result.get(key)!.add(row.userId);
      }
    return result;
  };
  const watches = index(watchlists),
    lists = index(listInterests);
  return ranked
    .map((f) => ({
      ...f,
      watchlistCount: watches.get(filmKey(f))?.size || 0,
      listInterestCount: lists.get(filmKey(f))?.size || 0,
    }))
    .sort(
      (a, b) =>
        b.watchlistCount - a.watchlistCount ||
        b.score +
          b.listInterestCount * 0.15 -
          (a.score + a.listInterestCount * 0.15) ||
        filmKey(a).localeCompare(filmKey(b))
    );
}
export function listProgress(
  list: DiscoveryList,
  userId: number,
  watched: Viewing[],
  now: number
) {
  const keys = new Set(list.items.map(filmKey));
  // Build each historical membership index at most once per calculation.
  const history = [...list.history].reverse();
  const memberships = new Map<DiscoveryList['items'], Set<string>>();
  memberships.set(list.items, keys);
  const seen = new Set(
    watched
      .filter((w) => w.userId === userId && keys.has(filmKey(w)))
      .map(filmKey)
  );
  const recent = new Set(
    watched
      .filter((w) => {
        if (
          w.userId !== userId ||
          !w.at ||
          w.at > now ||
          w.at < now - 30 * 86400000
        )
          return false;
        // This is a recommendation based on overlap with the current list, not
        // a claim that the list caused a viewing. Before our first snapshot use
        // current membership; once history exists honor membership at the time.
        const historical = history.find((h) => h.at <= w.at!);
        const items =
          list.source === 'curated' || !historical
            ? list.items
            : historical.items;
        let membership = memberships.get(items);
        if (!membership) {
          membership = new Set(items.map(filmKey));
          memberships.set(items, membership);
        }
        return membership.has(filmKey(w));
      })
      .map(filmKey)
  );
  return {
    watched: seen.size,
    total: keys.size + (list.unmatched?.length || 0),
    remaining: keys.size - seen.size + (list.unmatched?.length || 0),
    recent: recent.size,
    activityScore: recent.size / Math.sqrt(Math.max(1, keys.size)),
  };
}
