import PlexAPI from '@server/api/plexapi';
import type Media from '@server/entity/Media';
import { appDataPath } from '@server/utils/appDataVolume';
import path from 'path';
import { discoveryPlexOwner } from './discoveryDatabaseCache';
import { matchesAvailableEpisode } from './discoveryEpisodeAvailability';
import { discoveryPlexChildren } from './discoveryPlexEpisodes';
import { discoveryFileStamp } from './discoverySharedCache';

type Episode = { season: number; episode: number; name: string };

// Same exact Plex identity rules and 60s evidence window as the original
// checker. Cache raw season evidence, never per-user releases or episode refs.
export async function cachedReleaseEpisodes<T extends Episode>(
  media: Media,
  episodes: T[]
) {
  const available = new Set<T>();
  if (!media.ratingKey || !episodes.length) return available;
  const owner = await discoveryPlexOwner();
  if (!owner?.plexToken) return available;
  const settings = () =>
    discoveryFileStamp([path.join(appDataPath(), 'settings.json')]);
  const initial = settings();
  const plex = new PlexAPI({ plexToken: owner.plexToken, timeout: 5000 });
  const children = (key: string) =>
    discoveryPlexChildren(initial, owner.plexToken!, key, () =>
      plex.getChildrenMetadata(key)
    );
  for (const season of new Set(episodes.map((e) => e.season))) {
    const result = await (async () => {
      const names = new Map<number, string[]>();
      try {
        const seasons = (await children(media.ratingKey!)).filter(
          (s) => s.type === 'season' && s.index === season
        );
        if (seasons.length === 1) {
          const rows = await children(seasons[0].ratingKey);
          for (const row of rows)
            if (
              row.type === 'episode' &&
              String(row.grandparentRatingKey) === String(media.ratingKey) &&
              row.parentIndex === season
            )
              names.set(row.index, [
                ...(names.get(row.index) || []),
                row.title,
              ]);
        }
        if (settings() !== initial) throw Error('Plex settings changed');
        return { names, successful: true };
      } catch {
        return { names: new Map<number, string[]>(), successful: false };
      }
    })();
    for (const ep of episodes)
      if (ep.season === season && matchesAvailableEpisode(ep, result.names))
        available.add(ep);
  }
  if (settings() !== initial) return new Set<T>();
  return available;
}
