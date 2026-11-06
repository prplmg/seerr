import animeList from '@server/api/animelist';
import { getMetadataProvider } from '@server/api/metadata';
import type { PlexLibraryItem, PlexMetadata } from '@server/api/plexapi';
import PlexAPI from '@server/api/plexapi';
import TheMovieDb from '@server/api/themoviedb';
import { ANIME_KEYWORD_ID } from '@server/api/themoviedb/constants';
import type {
  TmdbKeyword,
  TmdbTvDetails,
} from '@server/api/themoviedb/interfaces';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import cacheManager from '@server/lib/cache';
import type {
  MediaIds,
  ProcessableSeason,
  RunnableScanner,
  StatusBase,
} from '@server/lib/scanners/baseScanner';
import BaseScanner from '@server/lib/scanners/baseScanner';
import type { Library } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { uniqWith } from 'lodash';
import { PlexRetryQueue, plexRetryKey, plexRetryServer } from './retryQueue';

// Full and recent scans share mutable library state and one durable retry queue.
let plexScanRunning = false;
class MissingPlexGuid extends Error {}
class ScannerPlexAPI extends PlexAPI {
  public async refreshMetadata(ratingKey: string) {
    await this.axios.put(
      `/library/metadata/${encodeURIComponent(ratingKey)}/refresh`
    );
  }
}

const imdbRegex = new RegExp(/imdb:\/\/(tt[0-9]+)/);
const tmdbRegex = new RegExp(/tmdb:\/\/([0-9]+)/);
const tvdbRegex = new RegExp(/tvdb:\/\/([0-9]+)/);
const tmdbShowRegex = new RegExp(/themoviedb:\/\/([0-9]+)/);
const plexRegex = new RegExp(/plex:\/\//);
// Hama agent uses ASS naming, see details here:
// https://github.com/ZeroQI/Absolute-Series-Scanner/blob/master/README.md#forcing-the-movieseries-id
const hamaTvdbRegex = new RegExp(/hama:\/\/tvdb[0-9]?-([0-9]+)/);
const hamaAnidbRegex = new RegExp(/hama:\/\/anidb[0-9]?-([0-9]+)/);
const HAMA_AGENT = 'com.plexapp.agents.hama';

type SyncStatus = StatusBase & {
  currentLibrary: Library;
  libraries: Library[];
};

class PlexScanner
  extends BaseScanner<PlexLibraryItem>
  implements RunnableScanner<SyncStatus>
{
  private plexClient: ScannerPlexAPI;
  private libraries: Library[];
  private currentLibrary: Library;
  private isRecentOnly = false;
  private retryQueue = new PlexRetryQueue();
  private retryServer: string;

  public constructor(isRecentOnly = false) {
    super('Plex Scan', { bundleSize: 50 });
    this.isRecentOnly = isRecentOnly;
  }

  public status(): SyncStatus {
    return {
      running: this.running,
      progress: this.progress,
      total: this.totalSize ?? 0,
      currentLibrary: this.currentLibrary,
      libraries: this.libraries,
    };
  }

  public async run(): Promise<void> {
    if (plexScanRunning) return;
    const settings = getSettings();
    const sessionId = this.startRun();
    plexScanRunning = true;
    try {
      const userRepository = getRepository(User);
      const admin = await userRepository.findOne({
        select: { id: true, plexToken: true },
        where: { id: 1 },
      });

      if (!admin) {
        return this.log('No admin configured. Plex scan skipped.', 'warn');
      }

      this.plexClient = new ScannerPlexAPI({
        plexToken: admin.plexToken,
        timeout: 30_000,
      });

      this.libraries = settings.plex.libraries.filter(
        (library) => library.enabled
      );

      this.retryServer = plexRetryServer(settings.plex);
      const hasHama = await this.hasHamaAgent();
      if (hasHama) {
        await animeList.sync();
      }

      await this.retryFailedItems(sessionId);

      if (this.isRecentOnly) {
        for (const library of this.libraries) {
          this.currentLibrary = library;
          this.log(
            `Beginning to process recently added for library: ${library.name}`,
            'info',
            { lastScan: library.lastScan }
          );
          const libraryItems = await this.plexClient.getRecentlyAdded(
            library.id,
            library.lastScan
              ? {
                  // We remove 10 minutes from the last scan as a buffer
                  addedAt: library.lastScan - 1000 * 60 * 10,
                }
              : undefined,
            library.type
          );

          // Bundle items up by rating keys
          this.items = uniqWith(libraryItems, (mediaA, mediaB) => {
            if (mediaA.grandparentRatingKey && mediaB.grandparentRatingKey) {
              return (
                mediaA.grandparentRatingKey === mediaB.grandparentRatingKey
              );
            }

            if (mediaA.parentRatingKey && mediaB.parentRatingKey) {
              return mediaA.parentRatingKey === mediaB.parentRatingKey;
            }

            return mediaA.ratingKey === mediaB.ratingKey;
          });

          let itemError: unknown;
          await this.loop(
            async (item) => {
              try {
                await this.processItem(item);
              } catch (error) {
                // BaseScanner uses Promise.all. Defer persistence errors until
                // every sibling settles, keeping the shared scan guard held.
                itemError ??= error;
              }
            },
            { sessionId }
          );
          if (itemError) throw itemError;

          // After run completes, update last scan time
          const newLibraries = settings.plex.libraries.map((lib) => {
            if (lib.id === library.id) {
              return {
                ...lib,
                lastScan: Date.now(),
              };
            }
            return lib;
          });

          settings.plex.libraries = newLibraries;
          await settings.save();
        }
      } else {
        for (const library of this.libraries) {
          this.currentLibrary = library;
          this.log(`Beginning to process library: ${library.name}`, 'info');
          await this.paginateLibrary(library, { sessionId });
        }
      }
      this.log('Plex retry queue', 'info', this.retryQueue.summary());
      this.log(
        this.isRecentOnly
          ? 'Recently Added Scan Complete'
          : 'Full Scan Complete',
        'info'
      );
    } catch (e) {
      this.log('Scan interrupted', 'error', {
        errorMessage: e.message,
      });
    } finally {
      this.endRun(sessionId);
      plexScanRunning = false;
    }
  }

  private async paginateLibrary(
    library: Library,
    { start = 0, sessionId }: { start?: number; sessionId: string }
  ) {
    if (!this.running) {
      throw new Error('Sync was aborted.');
    }

    if (this.sessionId !== sessionId) {
      throw new Error('New session was started. Old session aborted.');
    }

    const response = await this.plexClient.getLibraryContents(library.id, {
      size: this.protectedBundleSize,
      offset: start,
    });

    this.progress = start;
    this.totalSize = response.totalSize;

    if (response.items.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      response.items.map((item) => this.processItem(item))
    );
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;

    if (response.items.length < this.protectedBundleSize) {
      return;
    }

    await new Promise<void>((resolve, reject) =>
      setTimeout(() => {
        this.paginateLibrary(library, {
          start: start + this.protectedBundleSize,
          sessionId,
        })
          .then(() => resolve())
          .catch((e) => reject(new Error(e.message)));
      }, this.protectedUpdateRate)
    );
  }

  private async retryFailedItems(sessionId: string) {
    const deadline = Date.now() + 30_000;
    const entries = this.retryQueue.due(
      this.retryServer,
      getSettings().plex.libraries
    );
    for (const entry of entries) {
      if (
        !this.running ||
        this.sessionId !== sessionId ||
        Date.now() >= deadline
      )
        break;
      const settings = getSettings().plex;
      if (plexRetryServer(settings) !== this.retryServer) break;
      const library = settings.libraries.find(
        (l) => l.id === entry.libraryId && l.enabled
      );
      if (!library || !this.retryQueue.claim(entry)) continue;
      this.currentLibrary = library;
      let metadata: PlexMetadata;
      try {
        metadata = await this.plexClient.getMetadata(entry.ratingKey);
      } catch (error) {
        // Only a Plex metadata 404 means deletion. TMDB/child lookup failures
        // in processItem remain retryable, including their own 404 responses.
        if (error.response?.status === 404) this.retryQueue.clear(entry);
        else this.retryQueue.fail(entry);
        continue;
      }
      if (!metadata) {
        this.retryQueue.fail(entry);
        continue;
      }
      const section = (
        metadata as PlexMetadata & { librarySectionID?: string | number }
      ).librarySectionID;
      const current = getSettings().plex;
      if (
        !this.running ||
        plexRetryServer(current) !== this.retryServer ||
        !current.libraries.some((l) => l.id === entry.libraryId && l.enabled)
      )
        continue;
      // Never import a moved item from a disabled/different library. Missing
      // membership metadata is ambiguous, so keep it for a later attempt.
      if (section === undefined) {
        this.retryQueue.fail(entry);
        continue;
      }
      if (
        String(section) !== entry.libraryId ||
        metadata.ratingKey !== entry.ratingKey
      ) {
        this.retryQueue.fail(entry);
        this.log(
          'Plex retry library/identity changed; retained for inspection',
          'warn',
          { ratingKey: entry.ratingKey, libraryId: entry.libraryId }
        );
        continue;
      }
      await this.processItem(metadata, true);
    }
  }

  private async processItem(plexitem: PlexLibraryItem, retry = false) {
    const entry = {
      server: this.retryServer,
      libraryId: this.currentLibrary.id,
      ratingKey: plexRetryKey(plexitem),
    };
    // Existing failures are owned by the bounded retry drain, even if the
    // recent overlap/full scan returns them again before their backoff expires.
    if (!retry && this.retryQueue.has(entry)) return;
    try {
      if (plexitem.type === 'movie') {
        await this.processPlexMovie(plexitem);
      } else if (
        plexitem.type === 'show' ||
        plexitem.type === 'episode' ||
        plexitem.type === 'season'
      ) {
        await this.processPlexShow(plexitem);
      }
    } catch (e) {
      const failure = this.retryQueue.fail(
        entry,
        Date.now(),
        e instanceof MissingPlexGuid
      );
      if (
        retry &&
        this.running &&
        plexRetryServer(getSettings().plex) === this.retryServer &&
        getSettings().plex.libraries.some(
          (l) => l.id === entry.libraryId && l.enabled
        ) &&
        e instanceof MissingPlexGuid &&
        this.retryQueue.claimRefresh(entry)
      ) {
        try {
          await this.plexClient.refreshMetadata(entry.ratingKey);
          this.log(
            'Requested one Plex metadata refresh for missing Guid; retry remains queued',
            'warn',
            entry
          );
        } catch (refreshError) {
          this.log(
            'Plex metadata refresh failed; manual metadata repair may be needed',
            'warn',
            { ...entry, errorMessage: refreshError.message }
          );
        }
      }
      if (e instanceof MissingPlexGuid && failure.repairNeeded) {
        this.log(
          'Plex Guid still missing after capped backoff; manual metadata repair needed. Daily retries retained.',
          'warn',
          entry
        );
      }
      this.log('Failed to process Plex media', 'error', {
        errorMessage: e.message,
        title: plexitem.title,
      });
      return;
    }
    this.retryQueue.clear(entry);
  }

  private async processPlexMovie(plexitem: PlexLibraryItem) {
    const mediaIds = await this.getMediaIds(plexitem);

    const has4k = plexitem.Media.some(
      (media) => media.videoResolution === '4k'
    );

    await this.processMovie(mediaIds.tmdbId, {
      is4k: has4k && this.enable4kMovie,
      mediaAddedAt: new Date(plexitem.addedAt * 1000),
      ratingKey: plexitem.ratingKey,
      title: plexitem.title,
    });
  }

  private async processPlexMovieByTmdbId(
    plexitem: PlexMetadata,
    tmdbId: number
  ) {
    const has4k = plexitem.Media.some(
      (media) => media.videoResolution === '4k'
    );

    await this.processMovie(tmdbId, {
      is4k: has4k && this.enable4kMovie,
      mediaAddedAt: new Date(plexitem.addedAt * 1000),
      ratingKey: plexitem.ratingKey,
      title: plexitem.title,
    });
  }

  private async getTvShow({
    tmdbId,
    tvdbId,
  }: {
    tmdbId?: number;
    tvdbId?: number;
  }): Promise<TmdbTvDetails> {
    let tvShow;

    if (tmdbId) {
      tvShow = await this.tmdb.getTvShow({
        tvId: Number(tmdbId),
      });
    } else if (tvdbId) {
      tvShow = await this.tmdb.getShowByTvdbId({
        tvdbId: Number(tvdbId),
      });
    } else {
      throw new Error('No ID provided');
    }

    const metadataProvider = tvShow.keywords.results.some(
      (keyword: TmdbKeyword) => keyword.id === ANIME_KEYWORD_ID
    )
      ? await getMetadataProvider('anime')
      : await getMetadataProvider('tv');

    if (!(metadataProvider instanceof TheMovieDb)) {
      tvShow = await metadataProvider.getTvShow({
        tvId: Number(tmdbId),
      });
    }

    return tvShow;
  }

  private async processPlexShow(plexitem: PlexLibraryItem) {
    const ratingKey =
      plexitem.grandparentRatingKey ??
      plexitem.parentRatingKey ??
      plexitem.ratingKey;
    const metadata = await this.plexClient.getMetadata(ratingKey, {
      includeChildren: true,
    });

    const mediaIds = await this.getMediaIds(metadata);

    // If the media is from HAMA, and doesn't have a TVDb ID, we will treat it
    // as a special HAMA movie
    if (mediaIds.tmdbId && !mediaIds.tvdbId && mediaIds.isHama) {
      await this.processHamaMovie(metadata, mediaIds.tmdbId);
      return;
    }

    // If the media is from HAMA and we have a TVDb ID, we will attempt
    // to process any specials that may exist
    if (mediaIds.tvdbId && mediaIds.isHama) {
      await this.processHamaSpecials(metadata, mediaIds.tvdbId);
    }

    const tvShow = await this.getTvShow({
      tmdbId: mediaIds.tmdbId,
    });

    const seasons = tvShow.seasons;
    const processableSeasons: ProcessableSeason[] = [];

    const settings = getSettings();
    const filteredSeasons = settings.main.enableSpecialEpisodes
      ? seasons
      : seasons.filter((sn) => sn.season_number !== 0);

    for (const season of filteredSeasons) {
      const matchedPlexSeason = metadata.Children?.Metadata.find(
        (md) => Number(md.index) === season.season_number
      );

      if (matchedPlexSeason) {
        // If we have a matched Plex season, get its children metadata so we can check details
        const episodes = await this.plexClient.getChildrenMetadata(
          matchedPlexSeason.ratingKey
        );
        // Total episodes that are in standard definition (not 4k)
        const totalStandard = episodes.filter((episode) =>
          !this.enable4kShow
            ? true
            : episode.Media.some((media) => media.videoResolution !== '4k')
        ).length;

        // Total episodes that are in 4k
        const total4k = this.enable4kShow
          ? episodes.filter((episode) =>
              episode.Media.some((media) => media.videoResolution === '4k')
            ).length
          : 0;

        processableSeasons.push({
          seasonNumber: season.season_number,
          episodes: totalStandard,
          episodes4k: total4k,
          totalEpisodes: season.episode_count,
        });
      } else {
        processableSeasons.push({
          seasonNumber: season.season_number,
          episodes: 0,
          episodes4k: 0,
          totalEpisodes: season.episode_count,
        });
      }
    }

    await this.processShow(
      mediaIds.tmdbId,
      mediaIds.tvdbId ?? tvShow.external_ids.tvdb_id,
      processableSeasons,
      {
        mediaAddedAt: new Date(metadata.addedAt * 1000),
        ratingKey: ratingKey,
        title: metadata.title,
      }
    );
  }

  private async getMediaIds(plexitem: PlexLibraryItem): Promise<MediaIds> {
    const mediaIds: Partial<MediaIds> = {};
    // Check if item is using new plex movie/tv agent
    if (plexitem.guid.match(plexRegex)) {
      const guidCache = cacheManager.getCache('plexguid');

      // Verify current Plex metadata even if a prior identity was cached. A
      // stale cache must not mask missing Guid or override a repaired match.
      const metadata =
        plexitem.Guid && plexitem.Guid.length > 0
          ? plexitem
          : await this.plexClient.getMetadata(plexitem.ratingKey);

      // If there is no Guid field at all, then we bail
      if (!metadata?.Guid?.length) {
        throw new MissingPlexGuid(
          'No Guid metadata for this title. Skipping. (Try refreshing the metadata in Plex for this media!)'
        );
      }

      // Map all IDs to MediaId object
      metadata.Guid.forEach((ref) => {
        if (ref.id.match(imdbRegex)) {
          mediaIds.imdbId = ref.id.match(imdbRegex)?.[1] ?? undefined;
        } else if (ref.id.match(tmdbRegex)) {
          const tmdbMatch = ref.id.match(tmdbRegex)?.[1];
          mediaIds.tmdbId = Number(tmdbMatch);
        } else if (ref.id.match(tvdbRegex)) {
          const tvdbMatch = ref.id.match(tvdbRegex)?.[1];
          mediaIds.tvdbId = Number(tvdbMatch);
        }
      });

      // If we got an IMDb ID, but no TMDB ID, lookup the TMDB ID with the IMDb ID
      if (mediaIds.imdbId && !mediaIds.tmdbId) {
        const tmdbMedia = await this.tmdb.getMediaByImdbId({
          imdbId: mediaIds.imdbId,
        });
        mediaIds.tmdbId = tmdbMedia.id;
      }

      if (mediaIds.tvdbId && !mediaIds.tmdbId) {
        const show = await this.tmdb.getShowByTvdbId({
          tvdbId: mediaIds.tvdbId,
        });
        mediaIds.tmdbId = show.id;
      }

      // Local identity override: Plex merges the 2007 series and 2023 revival.
      // Scope to the known TVDB identity and the exact ambiguous TMDB pair.
      if (
        mediaIds.tvdbId === 80552 &&
        metadata.Guid.some((ref) => ref.id === 'tmdb://11294') &&
        metadata.Guid.some((ref) => ref.id === 'tmdb://235884')
      ) {
        mediaIds.tmdbId = 11294;
      }

      // Cache GUIDs
      guidCache.data.set(plexitem.ratingKey, mediaIds);

      // Check if the agent is IMDb
    } else if (plexitem.guid.match(imdbRegex)) {
      const imdbMatch = plexitem.guid.match(imdbRegex);
      if (imdbMatch) {
        mediaIds.imdbId = imdbMatch[1];
        const tmdbMedia = await this.tmdb.getMediaByImdbId({
          imdbId: mediaIds.imdbId,
        });
        mediaIds.tmdbId = tmdbMedia.id;
      }
      // Check if the agent is TMDB
    } else if (plexitem.guid.match(tmdbRegex)) {
      const tmdbMatch = plexitem.guid.match(tmdbRegex);
      if (tmdbMatch) {
        mediaIds.tmdbId = Number(tmdbMatch[1]);
      }
      // Check if the agent is TVDb
    } else if (plexitem.guid.match(tvdbRegex)) {
      const matchedtvdb = plexitem.guid.match(tvdbRegex);

      // If we can find a tvdb Id, use it to get the full tmdb show details
      if (matchedtvdb) {
        const show = await this.tmdb.getShowByTvdbId({
          tvdbId: Number(matchedtvdb[1]),
        });

        mediaIds.tvdbId = Number(matchedtvdb[1]);
        mediaIds.tmdbId = show.id;
      }
      // Check if the agent (for shows) is TMDB
    } else if (plexitem.guid.match(tmdbShowRegex)) {
      const matchedtmdb = plexitem.guid.match(tmdbShowRegex);
      if (matchedtmdb) {
        mediaIds.tmdbId = Number(matchedtmdb[1]);
      }
      // Check for HAMA (with TVDb guid)
    } else if (plexitem.guid.match(hamaTvdbRegex)) {
      const matchedtvdb = plexitem.guid.match(hamaTvdbRegex);

      if (matchedtvdb) {
        const show = await this.tmdb.getShowByTvdbId({
          tvdbId: Number(matchedtvdb[1]),
        });

        mediaIds.tvdbId = Number(matchedtvdb[1]);
        mediaIds.tmdbId = show.id;
        // Set isHama to true, so we can know to add special processing to this item
        mediaIds.isHama = true;
      }
      // Check for HAMA (with anidb guid)
    } else if (plexitem.guid.match(hamaAnidbRegex)) {
      const matchedhama = plexitem.guid.match(hamaAnidbRegex);

      if (!animeList.isLoaded()) {
        this.log(
          `Hama ID ${plexitem.guid} detected, but library agent is not set to Hama`,
          'warn',
          { title: plexitem.title }
        );
      } else if (matchedhama) {
        const anidbId = Number(matchedhama[1]);
        const result = animeList.getFromAnidbId(anidbId);
        let tvShow: TmdbTvDetails | null = null;

        // Set isHama to true, so we can know to add special processing to this item
        mediaIds.isHama = true;

        // First try to lookup the show by TVDb ID
        if (result?.tvdbId) {
          const extResponse = await this.tmdb.getByExternalId({
            externalId: result.tvdbId,
            type: 'tvdb',
          });
          if (extResponse.tv_results[0]) {
            tvShow = await this.tmdb.getTvShow({
              tvId: extResponse.tv_results[0].id,
            });
            mediaIds.tvdbId = result.tvdbId;
            mediaIds.tmdbId = tvShow.id;
          } else {
            this.log(
              `Missing TVDB ${result.tvdbId} entry in TMDB for AniDB ${anidbId}`
            );
          }
        }

        if (!tvShow) {
          // if lookup of tvshow above failed, then try movie with tmdbid/imdbid
          // note - some tv shows have imdbid set too, that's why this need to go second
          if (result?.tmdbId) {
            mediaIds.tmdbId = result.tmdbId;
            mediaIds.imdbId = result?.imdbId;
          } else if (result?.imdbId) {
            const tmdbMovie = await this.tmdb.getMediaByImdbId({
              imdbId: result.imdbId,
            });
            mediaIds.tmdbId = tmdbMovie.id;
            mediaIds.imdbId = result.imdbId;
          }
        }
      }
    }

    if (!mediaIds.tmdbId) {
      throw new Error('Unable to find TMDB ID');
    }

    // We check above if we have the TMDB ID, so we can safely assert the type below
    return mediaIds as MediaIds;
  }

  // movies with hama agent actually are tv shows with at least one episode in it
  // try to get first episode of any season - cannot hardcode season or episode number
  // because sometimes user can have it in other season/ep than s01e01
  private async processHamaMovie(metadata: PlexMetadata, tmdbId: number) {
    const season = metadata.Children?.Metadata[0];
    if (season) {
      const episodes = await this.plexClient.getChildrenMetadata(
        season.ratingKey
      );
      if (episodes) {
        await this.processPlexMovieByTmdbId(episodes[0], tmdbId);
      }
    }
  }

  // this adds all movie episodes from specials season for Hama agent
  private async processHamaSpecials(metadata: PlexMetadata, tvdbId: number) {
    const specials = metadata.Children?.Metadata.find(
      (md) => Number(md.index) === 0
    );
    if (specials) {
      const episodes = await this.plexClient.getChildrenMetadata(
        specials.ratingKey
      );
      if (episodes) {
        for (const episode of episodes) {
          const special = animeList.getSpecialEpisode(tvdbId, episode.index);
          if (special) {
            if (special.tmdbId) {
              await this.processPlexMovieByTmdbId(episode, special.tmdbId);
            } else if (special.imdbId) {
              const tmdbMovie = await this.tmdb.getMediaByImdbId({
                imdbId: special.imdbId,
              });
              await this.processPlexMovieByTmdbId(episode, tmdbMovie.id);
            }
          }
        }
      }
    }
  }

  // checks if any of this.libraries has Hama agent set in Plex
  private async hasHamaAgent() {
    const plexLibraries = await this.plexClient.getLibraries();
    return this.libraries.some((library) =>
      plexLibraries.some(
        (plexLibrary) =>
          plexLibrary.agent === HAMA_AGENT && library.id === plexLibrary.key
      )
    );
  }
}

export const plexFullScanner = new PlexScanner();
export const plexRecentScanner = new PlexScanner(true);
