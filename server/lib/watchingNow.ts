import type {
  WatchingPerson,
  WatchingTitle,
} from '@server/interfaces/api/watchParty';

export type ActivityRow = {
  user_id: string;
  rating_key: string;
  grandparent_rating_key?: string;
  media_type: string;
  state: string;
};
export type PartySnapshot = {
  id: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  ratingKey: string;
  userIds: number[];
  position: number;
  duration: number;
  paused: boolean;
  switchStatus?: 'loading' | 'ready' | 'failed';
};
type MediaIdentity = {
  tmdbId: number;
  mediaType: string;
  ratingKey?: string | null;
  ratingKey4k?: string | null;
};

// Identity is ALWAYS a Seerr user ID. Shared Plex profiles do not merge party members.
export function mergeWatchingNow(
  activity: ActivityRow[],
  parties: PartySnapshot[],
  media: MediaIdentity[],
  users: Map<number, WatchingPerson>,
  plexToSeerr: Map<string, number>,
  hidden: number[],
  viewerId: number
): WatchingTitle[] {
  const hiddenIds = new Set(hidden);
  const visible = (id: number) =>
    !hiddenIds.has(id) ? users.get(id) : undefined;
  const titles = new Map<string, WatchingTitle>();
  const ensure = (tmdbId: number, mediaType: 'movie' | 'tv') => {
    const key = `${mediaType}:${tmdbId}`;
    if (!titles.has(key))
      titles.set(key, { tmdbId, mediaType, viewers: [], parties: [] });
    return titles.get(key)!;
  };
  const byKey = new Map<string, MediaIdentity>();
  for (const item of media)
    for (const key of [item.ratingKey, item.ratingKey4k])
      if (key) byKey.set(`${item.mediaType}:${key}`, item);
  for (const row of activity) {
    if (
      !['playing', 'paused', 'buffering'].includes(row.state) ||
      !['movie', 'episode'].includes(row.media_type)
    )
      continue;
    const type = row.media_type === 'episode' ? 'tv' : 'movie';
    const item = byKey.get(
      `${type}:${type === 'tv' ? row.grandparent_rating_key : row.rating_key}`
    );
    const person = visible(plexToSeerr.get(String(row.user_id)) ?? -1);
    if (!item || !person) continue;
    const title = ensure(item.tmdbId, type);
    if (!title.viewers.some((p) => p.id === person.id))
      title.viewers.push(person);
  }
  for (const party of parties) {
    const members = [...new Set(party.userIds)]
      .map(visible)
      .filter((p): p is WatchingPerson => !!p);
    if (!members.length) continue;
    const title = ensure(party.tmdbId, party.mediaType);
    title.parties.push({
      id: party.id,
      members,
      mine: party.userIds.includes(viewerId),
      position: party.position,
      duration: party.duration,
      paused: party.paused,
      ratingKey: party.ratingKey,
      switchStatus: party.switchStatus,
    });
  }
  for (const title of titles.values()) {
    const grouped = new Set(
      title.parties.flatMap((p) => p.members.map((m) => m.id))
    );
    title.viewers = title.viewers.filter((p) => !grouped.has(p.id));
    title.parties.sort(
      (a, b) => Number(b.mine) - Number(a.mine) || a.id.localeCompare(b.id)
    );
  }
  return [...titles.values()].sort(
    (a, b) =>
      Number(b.parties.some((p) => p.mine)) -
        Number(a.parties.some((p) => p.mine)) ||
      a.mediaType.localeCompare(b.mediaType) ||
      a.tmdbId - b.tmdbId
  );
}
