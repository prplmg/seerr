import type { DiscoveryList, ListStore } from './discoveryLists';
import { popularListUrls } from './discoveryPopularLists';

// Explore-only editorial exclusion. Do not hide or delete saved/owned lists.
// TODO: replace this with an admin-only Explore visibility control.
const exploreExcludedUrls = new Set([
  'https://letterboxd.com/evegrissel/list/20-underseen-erotic-thrillers-1/',
]);

/** Input has already passed visibility checks. Never send other users' saves
 * to the client just to select this preview. No rotation or account mutation. */
export function exploreLists(
  lists: DiscoveryList[],
  store: Pick<ListStore, 'saved' | 'liked'>,
  visibleUserIds: number[],
  viewerId?: number
) {
  const unique = [...new Map(lists.map((l) => [l.id, l])).values()].filter(
    (list) =>
      !exploreExcludedUrls.has(list.url || '') &&
      (viewerId === undefined ||
        (list.ownerId !== viewerId &&
          !store.saved[viewerId]?.includes(list.id) &&
          !(list.url && store.liked[viewerId]?.includes(list.url))))
  );
  const associations = new Map(
    unique.map((list) => [
      list.id,
      visibleUserIds.filter(
        (id) =>
          list.ownerId === id ||
          store.saved[id]?.includes(list.id) ||
          (!!list.url && store.liked[id]?.includes(list.url))
      ),
    ])
  );
  const selected: DiscoveryList[] = [],
    usedUsers = new Set<number>();
  let affiliated = 0;
  let limit = 9;
  const add = (list: DiscoveryList) => {
    if (
      selected.length >= limit ||
      selected.some((item) => item.id === list.id)
    )
      return false;
    const users = associations.get(list.id)!;
    if (
      users.length &&
      (affiliated >= 3 || users.some((id) => usedUsers.has(id)))
    )
      return false;
    selected.push(list);
    if (users.length) affiliated++;
    users.forEach((id) => usedUsers.add(id));
    return true;
  };
  for (const url of popularListUrls) {
    const list = unique.find(
      (item) => item.source === 'letterboxd' && item.url === url
    );
    if (list) add(list);
    if (selected.length >= 9) break;
  }
  // Keep the six mixed slots separate: missing popular imports must not turn
  // this back into a catalogue-dominated row. Never bypass visibility checks.
  limit = selected.length + 6;
  const mixed = unique.filter(
    (item) => !popularListUrls.includes(item.url || '')
  );
  for (const list of mixed) if (associations.get(list.id)!.length) add(list);
  // Prefer other verified Letterboxd lists over catalogue-curated fillers.
  for (const list of mixed.filter((item) => item.source === 'letterboxd'))
    add(list);
  for (const list of mixed) add(list);
  return selected;
}
