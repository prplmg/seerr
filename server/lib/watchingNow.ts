import type {
  PartyExternalVideo,
  WatchingPerson,
  WatchingTitle,
} from '@server/interfaces/api/watchParty';

export type ActivityRow = {
  user_id: string;
  rating_key: string;
  grandparent_rating_key?: string;
  media_type: string;
  state: string;
  session_key?: string;
  machine_id?: string;
  started?: number;
  watched_status?: number;
  attribution?: {
    id: string;
    names: string[];
    canClaim: boolean;
    isMe: boolean;
    joined: boolean;
  };
  viewerIds?: number[];
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
  external?: PartyExternalVideo;
  canReturn?: boolean;
  returnTo?: { ratingKey: string; position: number; duration: number };
  controllerUserIds?: number[];
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
    if (!item) continue;
    const viewerIds = row.viewerIds ?? [
      plexToSeerr.get(String(row.user_id)) ?? -1,
    ];
    if (!row.attribution && !viewerIds.some((id) => visible(id))) continue;
    const title = ensure(item.tmdbId, type);
    if (row.attribution) (title.sessions ||= []).push(row.attribution);
    for (const personId of viewerIds) {
      const person = visible(personId);
      if (!person) continue;
      // The paused return tab is not a second current viewing session for the
      // same participant. Preserve other viewers and unrelated Plex activity.
      if (
        row.state === 'paused' &&
        parties.some(
          (p) =>
            p.external &&
            p.tmdbId === item.tmdbId &&
            p.mediaType === type &&
            p.userIds.includes(person.id)
        )
      )
        continue;
      if (!title.viewers.some((p) => p.id === person.id))
        title.viewers.push(person);
    }
  }
  for (const party of parties) {
    const members = [...new Set(party.userIds)]
      .map(visible)
      .filter((p): p is WatchingPerson => !!p);
    if (!members.length) continue;
    let external: PartyExternalVideo | undefined;
    if (party.external) {
      const id = party.external.videoId;
      if (party.external.provider !== 'youtube' || !/^[\w-]{11}$/.test(id))
        continue;
      external = {
        provider: 'youtube',
        videoId: id,
        title: party.external.title.slice(0, 200),
        url: `https://www.youtube.com/watch?v=${id}`,
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      };
    }
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
      canReturn: party.canReturn,
      canControl: party.controllerUserIds?.includes(viewerId) ?? false,
      external,
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
