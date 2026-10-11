import type DiscoverSlider from '@server/entity/DiscoverSlider';

export enum DiscoverSliderType {
  RECENTLY_ADDED = 1,
  RECENT_REQUESTS,
  PLEX_WATCHLIST,
  TRENDING,
  POPULAR_MOVIES,
  MOVIE_GENRES,
  UPCOMING_MOVIES,
  STUDIOS,
  POPULAR_TV,
  TV_GENRES,
  UPCOMING_TV,
  NETWORKS,
  TMDB_MOVIE_KEYWORD,
  TMDB_MOVIE_GENRE,
  TMDB_TV_KEYWORD,
  TMDB_TV_GENRE,
  TMDB_SEARCH,
  TMDB_STUDIO,
  TMDB_NETWORK,
  TMDB_MOVIE_STREAMING_SERVICES,
  TMDB_TV_STREAMING_SERVICES,
  WATCHING_NOW,
  RECENTLY_WATCHED,
  RECOMMENDATIONS,
}

const legacyDefaultSliders: Partial<DiscoverSlider>[] = [
  {
    type: DiscoverSliderType.RECENTLY_ADDED,
    enabled: true,
    isBuiltIn: true,
    order: 0,
  },
  {
    type: DiscoverSliderType.RECENT_REQUESTS,
    enabled: true,
    isBuiltIn: true,
    order: 1,
  },
  {
    type: DiscoverSliderType.PLEX_WATCHLIST,
    enabled: true,
    isBuiltIn: true,
    order: 2,
  },
  {
    type: DiscoverSliderType.TRENDING,
    enabled: true,
    isBuiltIn: true,
    order: 3,
  },
  {
    type: DiscoverSliderType.POPULAR_MOVIES,
    enabled: true,
    isBuiltIn: true,
    order: 4,
  },
  {
    type: DiscoverSliderType.MOVIE_GENRES,
    enabled: true,
    isBuiltIn: true,
    order: 5,
  },
  {
    type: DiscoverSliderType.UPCOMING_MOVIES,
    enabled: true,
    isBuiltIn: true,
    order: 6,
  },
  {
    type: DiscoverSliderType.STUDIOS,
    enabled: true,
    isBuiltIn: true,
    order: 7,
  },
  {
    type: DiscoverSliderType.POPULAR_TV,
    enabled: true,
    isBuiltIn: true,
    order: 8,
  },
  {
    type: DiscoverSliderType.TV_GENRES,
    enabled: true,
    isBuiltIn: true,
    order: 9,
  },
  {
    type: DiscoverSliderType.UPCOMING_TV,
    enabled: true,
    isBuiltIn: true,
    order: 10,
  },
  {
    type: DiscoverSliderType.NETWORKS,
    enabled: true,
    isBuiltIn: true,
    order: 11,
  },
];

const independentSliders = [
  {
    type: DiscoverSliderType.WATCHING_NOW,
    after: DiscoverSliderType.RECENT_REQUESTS,
  },
  {
    type: DiscoverSliderType.RECENTLY_WATCHED,
    after: DiscoverSliderType.WATCHING_NOW,
  },
  {
    type: DiscoverSliderType.RECOMMENDATIONS,
    after: DiscoverSliderType.STUDIOS,
  },
];

// Runs only when built-ins are missing. Preserve customized order, IDs and toggles.
export function reconcileDiscoverySliders(
  existing: Partial<DiscoverSlider>[]
): Partial<DiscoverSlider>[] {
  const rows = existing.map((row) => ({ ...row }));
  for (const slider of legacyDefaultSliders) {
    if (!rows.some((row) => row.type === slider.type)) rows.push({ ...slider });
  }
  for (const { type, after } of independentSliders) {
    if (rows.some((row) => row.type === type)) continue;
    const anchor = rows.findIndex((row) => row.type === after);
    rows.splice(anchor < 0 ? rows.length : anchor + 1, 0, {
      type,
      isBuiltIn: true,
      // Previously the watching rows followed Recent Requests visibility.
      enabled:
        type === DiscoverSliderType.RECOMMENDATIONS
          ? true
          : (rows[anchor]?.enabled ?? true),
    });
  }
  return rows.map((row, order) => ({ ...row, order }));
}

export const defaultSliders = reconcileDiscoverySliders([]);
