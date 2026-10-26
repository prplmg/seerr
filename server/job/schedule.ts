import { MediaServerType } from '@server/constants/server';
import blocklistedTagsProcessor from '@server/job/blocklistedTagsProcessor';
import { syncMappedAvatars } from '@server/lib/accountAvatarSync';
import availabilitySync from '@server/lib/availabilitySync';
import { avatarMigrationActive } from '@server/lib/catalogueMigration';
import { refreshDiscoveryReleases } from '@server/lib/discoveryReleases';
import {
  refreshCuratedMetadata,
  scheduledProfileWatchlistRefresh,
} from '@server/lib/catalogueRefreshJobs';
import downloadTracker from '@server/lib/downloadtracker';
import ImageProxy from '@server/lib/imageproxy';
import {
  monitorLetterboxdBrowsers,
  scheduleBrowserScans,
  scheduleBrowserExports,
} from '@server/lib/letterboxdBrowser';
import { prepareLetterboxdPlaybackPublications } from '@server/lib/letterboxdPlaybackContinuation';
import { publicationSchedule } from '@server/lib/letterboxdPublicationSchedule';
import { prepareLetterboxdPublications } from '@server/lib/letterboxdPublicationContinuation';
import refreshToken from '@server/lib/refreshToken';
import { pollReviews } from '@server/lib/reviews';
import {
  jellyfinFullScanner,
  jellyfinRecentScanner,
} from '@server/lib/scanners/jellyfin';
import { plexFullScanner, plexRecentScanner } from '@server/lib/scanners/plex';
import { radarrScanner } from '@server/lib/scanners/radarr';
import { sonarrScanner } from '@server/lib/scanners/sonarr';
import type { JobId } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import watchlistSync from '@server/lib/watchlistsync';
import logger from '@server/logger';
import { refreshCatalogueHistory, refreshRecentMoviePlayback } from '@server/routes/social';
import schedule from 'node-schedule';
import { runScheduledWork } from '@server/lib/backgroundContext';

interface ScheduledJob {
  id: JobId;
  job: schedule.Job;
  name: string;
  type: 'process' | 'command';
  interval: 'seconds' | 'minutes' | 'hours' | 'days' | 'fixed';
  cronSchedule: string;
  running?: () => boolean;
  cancelFn?: () => void;
}

export const scheduledJobs: ScheduledJob[] = [];
let reviewRssRunning = false;
let avatarRunning = false;

export async function runReviewRssJob(force = false): Promise<void> {
  if (reviewRssRunning) {
    logger.info('Review RSS refresh skipped: already running', { label: 'Letterboxd' });
    return;
  }
  reviewRssRunning = true;
  logger.info('Review RSS refresh started', { label: 'Letterboxd', trigger: force ? 'manual' : 'scheduled' });
  try {
    await runScheduledWork(() => pollReviews(force));
    logger.info('Review RSS refresh finished', { label: 'Letterboxd' });
  } catch {
    logger.warn('Review RSS poll failed', { label: 'Letterboxd' });
  } finally {
    reviewRssRunning = false;
  }
}

export const startJobs = (): void => {
  const jobs = getSettings().jobs;
  for (const definition of [
    {
      id: 'letterboxd-publication-sync' as const,
      name: 'Letterboxd Publication Sync',
      fallback: '0 0 9,21 * * *',
      run: async () => {
        scheduleBrowserExports();
        const report = await prepareLetterboxdPublications();
        const playback = await prepareLetterboxdPlaybackPublications();
        // Never log entry IDs, accounts, review contents, or raw errors.
        logger.info('Letterboxd publication planning completed', {
          label: 'Letterboxd',
          queuedCount: report.queued,
          issueCount: report.issues.length,
          playbackQueuedCount: playback.queued,
          playbackObservationCount: playback.pendingObservations.length,
          playbackIssueCount: playback.issues.length,
        });
      },
    },
    {
      id: 'letterboxd-browser-sync' as const,
      name: 'Letterboxd Browser Watchlists',
      fallback: '0 0 */12 * * *',
      run: async () => {
        scheduleBrowserScans();
        const { resumeDiscoveryImports } = await import('../lib/discoveryImportInbox');
        await resumeDiscoveryImports();
        const { refreshDiscoveryLists } = await import('../lib/discoveryListImport');
        await refreshDiscoveryLists();
      },
    },
    {
      id: 'letterboxd-browser-health' as const,
      name: 'Letterboxd Browser Health and Alerts',
      fallback: '0 */5 * * * *',
      run: monitorLetterboxdBrowsers,
    },
    {
      id: 'letterboxd-playback-refresh' as const,
      name: 'Letterboxd Completed Playback Publishing',
      fallback: '*/30 * * * * *',
      run: async () => {
        await refreshRecentMoviePlayback();
        await prepareLetterboxdPlaybackPublications();
      },
    },
    {
      id: 'catalogue-history-refresh' as const,
      name: 'Catalogue Watch History Refresh',
      fallback: '0 */2 * * * *',
      run: async () => {
        try { await refreshCatalogueHistory(); }
        finally { await refreshDiscoveryReleases(); }
      },
    },
    {
      id: 'profile-watchlist-refresh' as const,
      name: 'Shared Plex Profile Watchlists',
      fallback: '0 */15 * * * *',
      run: scheduledProfileWatchlistRefresh,
    },
    {
      id: 'curated-metadata-refresh' as const,
      name: 'Curated List Metadata Refresh',
      fallback: '0 5 */6 * * *',
      run: refreshCuratedMetadata,
    },
  ]) {
    if (scheduledJobs.some((job) => job.id === definition.id)) continue;
    let running = false;
    const publishing =
      definition.id === 'letterboxd-publication-sync'
        ? publicationSchedule(jobs[definition.id]?.schedule)
        : null;
    const cronSchedule =
      publishing?.cron ?? jobs[definition.id]?.schedule ?? definition.fallback;
    scheduledJobs.push({
      id: definition.id,
      name: definition.name,
      type: 'process',
      interval: definition.id === 'letterboxd-playback-refresh' ? 'seconds' : 'minutes',
      cronSchedule,
      job: schedule.scheduleJob(
        definition.id,
        publishing
          ? { rule: cronSchedule, tz: publishing.timeZone }
          : cronSchedule,
        async () => {
          if (running) return;
          running = true;
          logger[definition.id === 'letterboxd-playback-refresh' ? 'debug' : 'info']('Catalogue refresh started', { label: 'Jobs', job: definition.id });
          try {
            await runScheduledWork(() => definition.run());
            logger[definition.id === 'letterboxd-playback-refresh' ? 'debug' : 'info']('Catalogue refresh completed', {
              label: 'Jobs',
              job: definition.id,
            });
          } catch {
            logger.warn('Catalogue refresh failed', {
              label: 'Jobs',
              job: definition.id,
            });
          } finally {
            running = false;
          }
        }
      ),
      running: () => running,
    });
  }
  if (!scheduledJobs.some((job) => job.id === 'account-avatar-sync')) {
    const cronSchedule =
      jobs['account-avatar-sync']?.schedule ?? '0 0 12 * * *';
    scheduledJobs.push({
      id: 'account-avatar-sync',
      name: 'Plex Profile Avatar Sync',
      type: 'process',
      interval: 'hours',
      cronSchedule,
      job: schedule.scheduleJob(
        'account-avatar-sync',
        cronSchedule,
        async () => {
          if (avatarRunning) return;
          avatarRunning = true;
          try {
            const result = await syncMappedAvatars(!avatarMigrationActive());
            logger.info('Avatar synchronization completed', {
              label: 'Account mappings',
              ...result,
            });
          } catch {
            logger.warn('Avatar synchronization failed; review mappings', {
              label: 'Account mappings',
            });
          } finally {
            avatarRunning = false;
          }
        }
      ),
      running: () => avatarRunning,
    });
  }
  if (!scheduledJobs.some((job) => job.id === 'letterboxd-review-rss')) {
    const cronSchedule =
      jobs['letterboxd-review-rss']?.schedule ?? '0 */15 * * * *';
    scheduledJobs.push({
      id: 'letterboxd-review-rss',
      name: 'Letterboxd Review RSS Sync',
      type: 'process',
      interval: 'minutes',
      cronSchedule,
      job: schedule.scheduleJob(
        'letterboxd-review-rss',
        cronSchedule,
        () => runReviewRssJob()
      ),
      running: () => reviewRssRunning,
    });
  }
  const mediaServerType = getSettings().main.mediaServerType;

  if (mediaServerType === MediaServerType.PLEX) {
    // Run recently added plex scan every 5 minutes
    scheduledJobs.push({
      id: 'plex-recently-added-scan',
      name: 'Plex Recently Added Scan',
      type: 'process',
      interval: 'minutes',
      cronSchedule: jobs['plex-recently-added-scan'].schedule,
      job: schedule.scheduleJob(
        jobs['plex-recently-added-scan'].schedule,
        () => {
          logger.info('Starting scheduled job: Plex Recently Added Scan', {
            label: 'Jobs',
          });
          runScheduledWork(() => plexRecentScanner.run());
        }
      ),
      running: () => plexRecentScanner.status().running,
      cancelFn: () => plexRecentScanner.cancel(),
    });

    // Run full plex scan every 24 hours
    scheduledJobs.push({
      id: 'plex-full-scan',
      name: 'Plex Full Library Scan',
      type: 'process',
      interval: 'hours',
      cronSchedule: jobs['plex-full-scan'].schedule,
      job: schedule.scheduleJob(jobs['plex-full-scan'].schedule, () => {
        logger.info('Starting scheduled job: Plex Full Library Scan', {
          label: 'Jobs',
        });
        runScheduledWork(() => plexFullScanner.run());
      }),
      running: () => plexFullScanner.status().running,
      cancelFn: () => plexFullScanner.cancel(),
    });

    scheduledJobs.push({
      id: 'plex-refresh-token',
      name: 'Plex Refresh Token',
      type: 'process',
      interval: 'fixed',
      cronSchedule: jobs['plex-refresh-token'].schedule,
      job: schedule.scheduleJob(jobs['plex-refresh-token'].schedule, () => {
        logger.info('Starting scheduled job: Plex Refresh Token', {
          label: 'Jobs',
        });
        refreshToken.run();
      }),
    });

    // Watchlist Sync
    scheduledJobs.push({
      id: 'plex-watchlist-sync',
      name: 'Plex Watchlist Sync',
      type: 'process',
      interval: 'seconds',
      cronSchedule: jobs['plex-watchlist-sync'].schedule,
      job: schedule.scheduleJob(jobs['plex-watchlist-sync'].schedule, () => {
        logger.info('Starting scheduled job: Plex Watchlist Sync', {
          label: 'Jobs',
        });
        runScheduledWork(() => watchlistSync.syncWatchlist()).catch((e) => {
          logger.error('Failed to sync watchlists', {
            label: 'Plex Watchlist Sync',
            errorMessage: e.message,
          });
        });
      }),
    });
  } else if (
    mediaServerType === MediaServerType.JELLYFIN ||
    mediaServerType === MediaServerType.EMBY
  ) {
    // Run recently added jellyfin sync every 5 minutes
    scheduledJobs.push({
      id: 'jellyfin-recently-added-scan',
      name: 'Jellyfin Recently Added Scan',
      type: 'process',
      interval: 'minutes',
      cronSchedule: jobs['jellyfin-recently-added-scan'].schedule,
      job: schedule.scheduleJob(
        jobs['jellyfin-recently-added-scan'].schedule,
        () => {
          logger.info('Starting scheduled job: Jellyfin Recently Added Scan', {
            label: 'Jobs',
          });
          runScheduledWork(() => jellyfinRecentScanner.run());
        }
      ),
      running: () => jellyfinRecentScanner.status().running,
      cancelFn: () => jellyfinRecentScanner.cancel(),
    });

    // Run full jellyfin sync every 24 hours
    scheduledJobs.push({
      id: 'jellyfin-full-scan',
      name: 'Jellyfin Full Library Scan',
      type: 'process',
      interval: 'hours',
      cronSchedule: jobs['jellyfin-full-scan'].schedule,
      job: schedule.scheduleJob(jobs['jellyfin-full-scan'].schedule, () => {
        logger.info('Starting scheduled job: Jellyfin Full Scan', {
          label: 'Jobs',
        });
        runScheduledWork(() => jellyfinFullScanner.run());
      }),
      running: () => jellyfinFullScanner.status().running,
      cancelFn: () => jellyfinFullScanner.cancel(),
    });
  }

  // Run full radarr scan every 24 hours
  scheduledJobs.push({
    id: 'radarr-scan',
    name: 'Radarr Scan',
    type: 'process',
    interval: 'hours',
    cronSchedule: jobs['radarr-scan'].schedule,
    job: schedule.scheduleJob(jobs['radarr-scan'].schedule, () => {
      logger.info('Starting scheduled job: Radarr Scan', { label: 'Jobs' });
      runScheduledWork(() => radarrScanner.run());
    }),
    running: () => radarrScanner.status().running,
    cancelFn: () => radarrScanner.cancel(),
  });

  // Run full sonarr scan every 24 hours
  scheduledJobs.push({
    id: 'sonarr-scan',
    name: 'Sonarr Scan',
    type: 'process',
    interval: 'hours',
    cronSchedule: jobs['sonarr-scan'].schedule,
    job: schedule.scheduleJob(jobs['sonarr-scan'].schedule, () => {
      logger.info('Starting scheduled job: Sonarr Scan', { label: 'Jobs' });
      runScheduledWork(() => sonarrScanner.run());
    }),
    running: () => sonarrScanner.status().running,
    cancelFn: () => sonarrScanner.cancel(),
  });

  // Checks if media is still available in plex/sonarr/radarr libs
  scheduledJobs.push({
    id: 'availability-sync',
    name: 'Media Availability Sync',
    type: 'process',
    interval: 'hours',
    cronSchedule: jobs['availability-sync'].schedule,
    job: schedule.scheduleJob(jobs['availability-sync'].schedule, () => {
      logger.info('Starting scheduled job: Media Availability Sync', {
        label: 'Jobs',
      });
      availabilitySync.run();
    }),
    running: () => availabilitySync.running,
    cancelFn: () => availabilitySync.cancel(),
  });

  // Run download sync every minute
  scheduledJobs.push({
    id: 'download-sync',
    name: 'Download Sync',
    type: 'command',
    interval: 'seconds',
    cronSchedule: jobs['download-sync'].schedule,
    job: schedule.scheduleJob(jobs['download-sync'].schedule, () => {
      logger.debug('Starting scheduled job: Download Sync', {
        label: 'Jobs',
      });
      void runScheduledWork(() => downloadTracker.updateDownloads()).catch(() => {
        logger.warn('Download refresh failed', { label: 'Jobs' });
      });
    }),
    running: () => downloadTracker.isRunning(),
  });

  // Reset download sync everyday at 01:00 am
  scheduledJobs.push({
    id: 'download-sync-reset',
    name: 'Download Sync Reset',
    type: 'command',
    interval: 'hours',
    cronSchedule: jobs['download-sync-reset'].schedule,
    job: schedule.scheduleJob(jobs['download-sync-reset'].schedule, () => {
      logger.info('Starting scheduled job: Download Sync Reset', {
        label: 'Jobs',
      });
      downloadTracker.resetDownloadTracker();
    }),
  });

  // Run image cache cleanup every 24 hours
  scheduledJobs.push({
    id: 'image-cache-cleanup',
    name: 'Image Cache Cleanup',
    type: 'process',
    interval: 'hours',
    cronSchedule: jobs['image-cache-cleanup'].schedule,
    job: schedule.scheduleJob(jobs['image-cache-cleanup'].schedule, () => {
      logger.info('Starting scheduled job: Image Cache Cleanup', {
        label: 'Jobs',
      });
      // Clean TMDB image cache
      ImageProxy.clearCache('tmdb');

      // Clean users avatar image cache
      ImageProxy.clearCache('avatar');
    }),
  });

  scheduledJobs.push({
    id: 'process-blocklisted-tags',
    name: 'Process Blocklisted Tags',
    type: 'process',
    interval: 'days',
    cronSchedule: jobs['process-blocklisted-tags'].schedule,
    job: schedule.scheduleJob(jobs['process-blocklisted-tags'].schedule, () => {
      logger.info('Starting scheduled job: Process Blocklisted Tags', {
        label: 'Jobs',
      });
      blocklistedTagsProcessor.run();
    }),
    running: () => blocklistedTagsProcessor.status().running,
    cancelFn: () => blocklistedTagsProcessor.cancel(),
  });

  logger.info('Scheduled jobs loaded', { label: 'Jobs' });
};
