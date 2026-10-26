import PlexAPI from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import type Media from '@server/entity/Media';
import { User } from '@server/entity/User';

type Episode = { season: number; episode: number; name: string };
const cache = new Map<
  string,
  { until: number; names: Map<number, string[]> }
>();
const pending = new Map<string, Promise<Map<number, string[]>>>();
const normalize = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

export function matchesAvailableEpisode(
  ep: Episode,
  names: Map<number, string[]>
) {
  const matches = names.get(ep.episode) || [];
  return matches.length === 1 && normalize(matches[0]) === normalize(ep.name);
}

// A season's availability is shared across users; privacy/filtering stays in
// the caller. Missing, failed, or ambiguous evidence never means available.
export async function availableReleaseEpisodes(
  media: Media,
  episodes: Episode[]
): Promise<Set<Episode>> {
  const available = new Set<Episode>();
  if (!media.ratingKey || !episodes.length) return available;
  const owner = await getRepository(User).findOne({
    where: { id: 1 },
    select: { id: true, plexToken: true },
    loadEagerRelations: false,
  });
  if (!owner?.plexToken) return available;
  const plex = new PlexAPI({ plexToken: owner.plexToken, timeout: 5000 });
  for (const season of new Set(episodes.map((e) => e.season))) {
    const key = `${media.tmdbId}:${media.ratingKey}:${season}`;
    const hit = cache.get(key);
    let names = hit && hit.until > Date.now() ? hit.names : undefined;
    if (!names) {
      let work = pending.get(key);
      if (!work) {
        work = (async () => {
          const result = new Map<number, string[]>();
          try {
            const seasons = (
              await plex.getChildrenMetadata(media.ratingKey!)
            ).filter((s) => s.type === 'season' && s.index === season);
            if (seasons.length === 1) {
              const rows = await plex.getChildrenMetadata(seasons[0].ratingKey);
              for (const row of rows)
                if (
                  row.type === 'episode' &&
                  String(row.grandparentRatingKey) ===
                    String(media.ratingKey) &&
                  row.parentIndex === season
                )
                  result.set(row.index, [
                    ...(result.get(row.index) || []),
                    row.title,
                  ]);
            }
          } catch {
            /* Do not show unverified episodes or retain stale positives. */
          }
          if (cache.size >= 200) cache.delete(cache.keys().next().value!);
          cache.set(key, { until: Date.now() + 60000, names: result });
          return result;
        })();
        pending.set(key, work);
      }
      try {
        names = await work;
      } finally {
        if (pending.get(key) === work) pending.delete(key);
      }
    }
    for (const ep of episodes)
      if (ep.season === season && matchesAvailableEpisode(ep, names))
        available.add(ep);
  }
  return available;
}
