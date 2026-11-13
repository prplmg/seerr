// Called only for successful API responses; failed writes do not count as actions.
export function watchlistEvent(
  url: string,
  method: string | undefined,
  body: Record<string, unknown>
) {
  const parsed = new URL(url, 'https://catalogue.invalid');
  const path = parsed.pathname;
  if (
    /^\/api\/v1\/user\/\d+\/settings\/request-watchlist$/.test(path) &&
    method === 'put' &&
    typeof body.enabled === 'boolean'
  ) {
    return {
      name: 'request_watchlist_preference_changed',
      properties: { enabled: body.enabled },
    };
  }
  const plex = path.match(/^\/api\/v1\/watchlist\/plex\/(movie|tv)\/(\d+)$/);
  if (plex && method === 'put' && typeof body.added === 'boolean') {
    return {
      name: body.added ? 'watchlist_added' : 'watchlist_removed',
      properties: {
        media_type: plex[1],
        media_id: Number(plex[2]),
        watchlist: 'plex',
      },
    };
  }
  if (path === '/api/v1/watchlist' && method === 'post') {
    return {
      name: 'watchlist_added',
      properties: {
        media_id: body.tmdbId,
        media_title: body.title,
        media_type: body.mediaType,
        watchlist: 'catalogue',
      },
    };
  }
  const local = path.match(/^\/api\/v1\/watchlist\/(\d+)$/);
  if (local && method === 'delete') {
    return {
      name: 'watchlist_removed',
      properties: {
        media_id: Number(local[1]),
        media_type: parsed.searchParams.get('mediaType'),
        watchlist: 'catalogue',
      },
    };
  }
  return null;
}
