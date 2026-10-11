import source from '@server/data/curated-lists.json';
import releaseDates from '@server/data/curated-release-dates.json';
import { createHash } from 'crypto';

export type CuratedList = {
  id: string;
  title: { en: string; es?: string };
  description: { en: string; es?: string };
  items: { type: 'movie' | 'tv'; tmdbId: number; title?: string }[];
};
export function validateLists(data: unknown): CuratedList[] {
  const input = data as { version?: number; lists?: CuratedList[] };
  if (input?.version !== 1 || !Array.isArray(input.lists))
    throw Error('Invalid curated list format');
  const ids = new Set<string>();
  for (const list of input.lists) {
    if (
      !list ||
      !/^[a-z0-9-]+$/.test(list.id) ||
      ids.has(list.id) ||
      !list.title?.en ||
      !list.description?.en ||
      !Array.isArray(list.items) ||
      !list.items.length
    )
      throw Error('Invalid curated category');
    ids.add(list.id);
    for (const item of list.items) {
      if (
        !item ||
        !['movie', 'tv'].includes(item.type) ||
        !Number.isSafeInteger(item.tmdbId) ||
        item.tmdbId < 1
      )
        throw Error(`Invalid item in ${list.id}`);
    }
  }
  return input.lists;
}
export function newestFirst(
  lists: CuratedList[],
  dates: Record<string, string | null> = releaseDates
) {
  return lists.map((list) => ({
    ...list,
    // Stable ties preserve curation; undated titles come last. No runtime lookups.
    items: [...list.items].sort((a, b) =>
      (dates[`${b.type}:${b.tmdbId}`] || '').localeCompare(
        dates[`${a.type}:${a.tmdbId}`] || ''
      )
    ),
  }));
}
export const curatedLists = newestFirst(validateLists(source));
export function dailyCategories(
  lists = curatedLists,
  now = new Date(),
  limit: 15 | 25 = 15
) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Merida',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  // Deterministic rank: same selection/order for all users, locales and restarts.
  const results = lists
    .map((list) => ({
      list,
      rank: createHash('sha256')
        .update(`curated-v1:${day}:${list.id}`)
        .digest('hex'),
    }))
    .sort(
      (a, b) =>
        a.rank.localeCompare(b.rank) || a.list.id.localeCompare(b.list.id)
    )
    .slice(0, limit)
    .map(({ list }) => {
      // Daily artwork selection is independent of the newest-first viewing order.
      const covers = list.items
        .map((item) => ({
          item,
          rank: createHash('sha256')
            .update(`curated-art-v1:${day}:${list.id}:${item.type}:${item.tmdbId}`)
            .digest('hex'),
        }))
        .sort((a, b) => a.rank.localeCompare(b.rank))
        .slice(0, 5)
        .map(({ item }) => item);
      return {
        id: list.id,
        title: list.title,
        description: list.description,
        count: list.items.length,
        cover: covers[0],
        covers,
      };
    });
  return { day, timezone: 'America/Merida', results };
}
