import defineMessages from '@app/utils/defineMessages';

export default defineMessages('components.Discover.Catalogue', {
  all: 'All',
  movies: 'Movies',
  series: 'Series',
  mediaType: 'Media type',
  historyHelp: 'Most recently watched first. A completed episode counts for its series.',
  historyDisabled: 'Watch history is disabled.',
  alreadyOnPlex: 'Already on Plex',
  recentlyAdded: 'Recently Added',
  recentlyWatched: 'Recently Watched',
  filterHelp: 'Browse your available library, newest additions first. Other filters are paused while enabled; their selections are preserved.',
  libraryHelp: 'Includes partially available series; follows the latest library scan.',
  count: '{count, plural, one {# title} other {# titles}}',
  libraryError: 'Unable to load your Plex library.',
  historyError: 'Watch history is temporarily unavailable.',
  retry: 'Retry',
  loadingLibrary: 'Loading your Plex library…',
  emptyLibrary: 'No available titles found.',
  emptyHistory: 'No watched titles yet.',
  loading: 'Loading…',
});
