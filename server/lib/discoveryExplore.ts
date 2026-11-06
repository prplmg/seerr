import { createHash } from 'crypto';
import type { DiscoveryList, ListStore } from './discoveryLists';

// These exclusions apply to discovery, not a user's own saved-list library.
const exploreExcludedUrls = new Set([
  'https://letterboxd.com/evegrissel/list/20-underseen-erotic-thrillers-1',
  'https://letterboxd.com/o_zero/list/short-films-on-youtube',
]);
const canonicalUrl = (list: DiscoveryList) =>
  list.url?.toLowerCase().replace(/\/$/, '');
const calendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Merida',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** One shared daily selection. Callers must supply the same socially eligible
 * user IDs, never a viewer-specific subset. Private saves are used only to
 * select already-public lists; neither the associations nor user IDs escape. */
export function exploreLists(
  lists: DiscoveryList[],
  store: Pick<ListStore, 'saved' | 'liked'>,
  eligibleUserIds: number[],
  now = Date.now()
) {
  const day = calendar.format(now);
  const rank = (key: string) =>
    createHash('sha256').update(`${day}:${key}`).digest('hex');
  const ordered = <T>(rows: T[], key: (row: T) => string) =>
    rows
      .map((row) => ({ row, key: key(row), rank: rank(key(row)) }))
      .sort(
        (a, b) => a.rank.localeCompare(b.rank) || a.key.localeCompare(b.key)
      )
      .map(({ row }) => row);
  const seenIds = new Set<string>(),
    seenUrls = new Set<string>();
  const pool = ordered(lists, (l) => `list:${l.id}`).filter((list) => {
    const url = canonicalUrl(list);
    // An owner's visibility exception must not leak private or stale lists
    // into the common rotation, nor produce different pools across viewers.
    if (
      list.visibility !== 'public' ||
      list.unavailable ||
      list.deletedAt ||
      (url && exploreExcludedUrls.has(url)) ||
      (list.source === 'letterboxd' &&
        now - list.checkedAt >= (list.automatic ? 15 : 1) * 86400000) ||
      seenIds.has(list.id) ||
      (url && seenUrls.has(url))
    )
      return false;
    seenIds.add(list.id);
    if (url) seenUrls.add(url);
    return true;
  });
  const selected = pool.filter((l) => l.source === 'letterboxd').slice(0, 10);
  const selectedIds = new Set(selected.map((l) => l.id));
  const users = ordered([...new Set(eligibleUserIds)], (id) => `user:${id}`);
  const choices = new Map(
    users.map((userId) => [
      userId,
      pool.filter(
        (l) => l.ownerId === userId || store.saved[userId]?.includes(l.id)
      ),
    ])
  );

  // Find distinct representatives where possible, even when users share saves.
  // A greedy first choice could consume another user's only eligible list.
  const assigned = new Map<string, number>();
  const assign = (userId: number, visited: Set<string>): boolean => {
    for (const list of choices.get(userId) || []) {
      if (selectedIds.has(list.id) || visited.has(list.id)) continue;
      visited.add(list.id);
      const previous = assigned.get(list.id);
      if (previous === undefined || assign(previous, visited)) {
        assigned.set(list.id, userId);
        return true;
      }
    }
    return false;
  };
  for (const userId of users) assign(userId, new Set());
  for (const list of pool)
    if (assigned.has(list.id)) {
      selected.push(list);
      selectedIds.add(list.id);
    }
  // Users without a distinct candidate share representation by an existing
  // card. Never duplicate cards just to meet a user count.
  for (const list of pool) {
    if (selected.length >= 20) break;
    if (list.source === 'curated' && !selectedIds.has(list.id)) {
      selected.push(list);
      selectedIds.add(list.id);
    }
  }
  return selected;
}
