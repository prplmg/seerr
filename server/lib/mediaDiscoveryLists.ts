import {
  allLists,
  filmKey,
  visibleList,
  type ListFilm,
  type ListStore,
} from './discoveryLists';

/** Membership only: no Plex history, recommendation ranking or remote lookups. */
export function mediaDiscoveryLists(
  store: ListStore,
  viewerId: number,
  film: ListFilm,
  now = Date.now(),
  blocked: ReadonlySet<string> = new Set()
) {
  if (blocked.has(filmKey(film))) return [];
  return allLists(store)
    .filter(
      (list) =>
        visibleList(list, viewerId, now) &&
        list.items.some(
          (item) => item.type === film.type && item.tmdbId === film.tmdbId
        )
    )
    .map((list) => ({
      id: list.id,
      title: list.title,
      creator: list.creator,
      source: list.source,
      total: list.items.filter((item) => !blocked.has(filmKey(item))).length,
      saved: !!store.saved[viewerId]?.includes(list.id),
    }))
    .sort(
      (a, b) =>
        Number(b.saved) - Number(a.saved) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id)
    );
}
