import TheMovieDb from '@server/api/themoviedb';
import { effectiveAccountMappings } from './accountMappingProfiles';
import { dailyCategories } from './curatedLists';
import { plexProfileWatchlist } from './plexWatchlist';
import { watchlistRefreshActive } from './catalogueMigration';

export async function scheduledProfileWatchlistRefresh() {
  if (!watchlistRefreshActive()) return { enabled: false, reason: 'live-verification-pending' };
  return refreshProfileWatchlists();
}

let profileCooldownUntil = 0;
export async function refreshProfileWatchlists() {
  if (Date.now() < profileCooldownUntil) throw Error('Plex watchlist refresh is cooling down');
  const users = await effectiveAccountMappings();
  const seen = new Set<string>();
  for (const user of users) {
    const key = user.mapping.watchlistPlexId || `native:${user.userId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      // Warm only a small preview, never crawl every member's full watchlist.
      // Normal profile views keep their existing on-demand pagination.
      await plexProfileWatchlist(user.userId, 1, 5);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      if (error.response?.status === 429) {
        const retryAfter = error.response.headers?.['retry-after'];
        const seconds = Number(retryAfter);
        const retryAt = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(String(retryAfter));
        profileCooldownUntil = Math.max(Date.now() + 15 * 60 * 1000, Number.isFinite(retryAt) ? retryAt : 0);
      }
      throw error;
    }
  }
  return { profiles: seen.size, previewSize: 5 };
}
export async function refreshCuratedMetadata() {
  const api = new TheMovieDb();
  const seen = new Set<string>();
  for (const category of dailyCategories(undefined, new Date(), 25).results) {
    for (const item of category.covers) {
      const key = `${item.type}:${item.tmdbId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Use the normal TMDB cache consumed by catalogue routes, in both UI languages.
      for (const language of ['en', 'es']) {
        if (item.type === 'movie')
          await api.getMovie({ movieId: item.tmdbId, language });
        else await api.getTvShow({ tvId: item.tmdbId, language });
      }
    }
  }
}
