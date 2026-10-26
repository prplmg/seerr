import { MediaRequestStatus } from '@server/constants/media';
import type { ListFilm } from './discoveryLists';
type Request = {
  id: number;
  requestedBy?: { id: number };
  status: number;
  createdAt: Date | string;
  media?: { mediaType: string; tmdbId: number };
};
export function requestedUnwatched(
  userId: number,
  requests: readonly Request[],
  seen: ReadonlySet<string>,
  available: ReadonlySet<string>,
  historyAvailable = true
): ListFilm[] {
  // An unavailable history source must not turn previously watched titles into suggestions.
  if (!historyAvailable) return [];
  const result: ListFilm[] = [],
    added = new Set<string>();
  for (const request of [...requests].sort(
    (a, b) =>
      (new Date(b.createdAt).getTime() || 0) -
        (new Date(a.createdAt).getTime() || 0) || b.id - a.id
  )) {
    const media = request.media;
    if (
      request.requestedBy?.id !== userId ||
      request.status === MediaRequestStatus.DECLINED ||
      !media ||
      !['movie', 'tv'].includes(media.mediaType)
    )
      continue;
    const key = `${media.mediaType}:${media.tmdbId}`;
    if (!available.has(key) || seen.has(key) || added.has(key)) continue;
    added.add(key);
    result.push({
      type: media.mediaType as 'movie' | 'tv',
      tmdbId: media.tmdbId,
    });
  }
  return result;
}
