import PlexAPI from '@server/api/plexapi';
import { MediaStatus } from '@server/constants/media';
import { appDataPath } from '@server/utils/appDataVolume';
import path from 'path';
import { discoveryMedia, discoveryPlexOwner } from './discoveryDatabaseCache';
import { discoveryPlexChildren } from './discoveryPlexEpisodes';
import { discoveryFileStamp } from './discoverySharedCache';
import {
  unfinishedSeries,
  validEpisode,
  type CompletedEpisode,
  type EpisodeNumber,
} from './unfinishedSeries';

// Shared availability evidence only; never cache a user's watching progress.
export async function unfinishedSeriesData(
  userId: number,
  history: CompletedEpisode[]
) {
  const ids = new Set(
    history
      .filter((e) => e.userId === userId && validEpisode(e))
      .map((e) => e.tmdbId)
  );
  if (!ids.size) return [];
  const [media, owner] = await Promise.all([
    discoveryMedia(),
    discoveryPlexOwner(),
  ]);
  if (!owner?.plexToken) return [];
  const plex = new PlexAPI({ plexToken: owner.plexToken, timeout: 5000 });
  const settings = discoveryFileStamp([
    path.join(appDataPath(), 'settings.json'),
  ]);
  const children = (key: string) =>
    discoveryPlexChildren(settings, owner.plexToken!, key, () =>
      plex.getChildrenMetadata(key)
    );
  const candidates = media
    .filter(
      (m) =>
        m.mediaType === 'tv' &&
        ids.has(m.tmdbId) &&
        (m.ratingKey || m.ratingKey4k) &&
        m.status !== MediaStatus.BLOCKLISTED &&
        m.status4k !== MediaStatus.BLOCKLISTED &&
        ([MediaStatus.PARTIALLY_AVAILABLE, MediaStatus.AVAILABLE].includes(
          m.status
        ) ||
          [MediaStatus.PARTIALLY_AVAILABLE, MediaStatus.AVAILABLE].includes(
            m.status4k
          ))
    )
    .flatMap((m) =>
      [
        ...new Set(
          [m.ratingKey, m.ratingKey4k].filter((key): key is string => !!key)
        ),
      ].map((ratingKey) => ({ ...m, ratingKey }))
    );
  const latest = new Map<number, EpisodeNumber>();
  const failed = new Set<number>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(2, candidates.length) }, async () => {
      while (next < candidates.length) {
        const m = candidates[next++];
        try {
          const episode = await (async () => {
            const seasons = (await children(m.ratingKey!))
              .filter((s) => s.type === 'season' && s.index > 0)
              .sort((a, b) => b.index - a.index);
            for (const season of seasons) {
              const episodes = (await children(season.ratingKey))
                .filter(
                  (e) =>
                    e.type === 'episode' &&
                    String(e.grandparentRatingKey) === String(m.ratingKey) &&
                    e.parentIndex === season.index &&
                    e.index > 0
                )
                .sort((a, b) => b.index - a.index);
              if (episodes.length)
                return { season: season.index, episode: episodes[0].index };
            }
            return undefined;
          })();
          if (
            discoveryFileStamp([path.join(appDataPath(), 'settings.json')]) !==
            settings
          )
            throw Error('Plex settings changed');
          const previous = latest.get(m.tmdbId);
          if (
            episode &&
            (!previous ||
              episode.season > previous.season ||
              (episode.season === previous.season &&
                episode.episode > previous.episode))
          )
            latest.set(m.tmdbId, episode);
        } catch {
          failed.add(m.tmdbId);
          /* Unknown availability must not create a suggestion. */
        }
      }
    })
  );
  for (const id of failed) latest.delete(id);
  return unfinishedSeries(userId, history, latest);
}
