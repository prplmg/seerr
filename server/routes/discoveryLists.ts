import TheMovieDb from '@server/api/themoviedb';
import { MediaRequestStatus } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import {
  browserListStatus,
  queueBrowserList,
} from '@server/lib/discoveryBrowser';
import { discoveryData } from '@server/lib/discoveryData';
import { discoveryRequests } from '@server/lib/discoveryDatabaseCache';
import { exploreLists } from '@server/lib/discoveryExplore';
import {
  discoveryEnabled,
  filmKey,
  readListStore,
  setListSaved,
  updateListStore,
  type DiscoveryList,
} from '@server/lib/discoveryLists';
import { cachedDiscoveryRanking } from '@server/lib/discoveryRankingCache';
import {
  prioritizeTogether,
  recommend,
} from '@server/lib/discoveryRecommendations';
import {
  readReleaseState,
  releaseKey,
  releasesForUser,
  setReleaseFollow,
} from '@server/lib/discoveryReleases';
import { shortWatchPage } from '@server/lib/discoveryShort';
import { discoveryWatchlists } from '@server/lib/discoveryWatchlists';
import { forYouLayout } from '@server/lib/forYouLayout';
import { sortedList, type ListSort } from '@server/lib/listSort';
import { Permission } from '@server/lib/permissions';
import { recentUnrated } from '@server/lib/recentUnrated';
import { requestedUnwatched } from '@server/lib/requestedUnwatched';
import { validEpisode } from '@server/lib/unfinishedSeries';
import { unfinishedSeriesData } from '@server/lib/unfinishedSeriesData';
import logger from '@server/logger';
import { Router } from 'express';
import catalogueLists from './catalogueLists';
const router = Router();
// Requests are authoritative follows, including requests made before this feature.
async function requestFollowers(key: string) {
  return new Set(
    (await discoveryRequests())
      .filter(
        (r) =>
          r.media &&
          r.requestedBy &&
          r.status !== MediaRequestStatus.DECLINED &&
          releaseKey(r.media.mediaType, r.media.tmdbId) === key
      )
      .map((r) => r.requestedBy.id)
  );
}
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});
// Scoped read context only: never replace the authenticated admin/session user.
router.use(async (req, res, next) => {
  res.locals.discoveryUserId = req.user!.id;
  const target = req.header('X-Discovery-Preview-User');
  if (target === undefined) return next();
  if (!req.user!.hasPermission(Permission.ADMIN)) return res.sendStatus(403);
  if (req.method !== 'GET' || /^\/(imports|follow)(\/|$)/.test(req.path))
    return res.sendStatus(403);
  if (!/^[1-9]\d*$/.test(target) || !Number.isSafeInteger(Number(target)))
    return res.sendStatus(400);
  try {
    const user = await getRepository(User).findOne({
      where: { id: Number(target) },
    });
    if (!user) return res.sendStatus(404);
    res.locals.discoveryUserId = user.id;
    res.locals.discoveryPreview = { id: user.id, name: user.displayName };
    next();
  } catch (e) {
    next(e);
  }
});
router.get('/features', (req, res) =>
  res.json({
    enabled: !!res.locals.discoveryPreview || discoveryEnabled(req.user!.id),
    preview: res.locals.discoveryPreview,
  })
);
// Explicit admin operation, independent of feature access. Preview remains GET-only.
router.get('/admin/follow/:type/:id', async (req, res, next) => {
  if (!req.user!.hasPermission(Permission.ADMIN)) return res.sendStatus(403);
  try {
    const key = releaseKey(req.params.type, Number(req.params.id));
    const users = await getRepository(User).find();
    const state = readReleaseState();
    const requested = await requestFollowers(key);
    return res.json({
      users: users.map((u) => ({
        id: u.id,
        name: u.displayName,
        following:
          requested.has(u.id) ||
          (state.follows[u.id] || []).some((i) => i.key === key),
        locked: requested.has(u.id),
      })),
    });
  } catch (e) {
    next(e);
  }
});
router.put('/admin/follow/:type/:id', async (req, res, next) => {
  if (!req.user!.hasPermission(Permission.ADMIN)) return res.sendStatus(403);
  if (
    !Number.isSafeInteger(req.body.userId) ||
    req.body.userId < 1 ||
    typeof req.body.following !== 'boolean'
  )
    return res.sendStatus(400);
  try {
    const key = releaseKey(req.params.type, Number(req.params.id));
    const user = await getRepository(User).findOne({
      where: { id: req.body.userId },
    });
    if (!user) return res.sendStatus(404);
    if ((await requestFollowers(key)).has(user.id)) {
      if (!req.body.following)
        return res
          .status(409)
          .json({ message: 'Requested titles cannot be unfollowed.' });
      return res.json({ following: true, locked: true });
    }
    setReleaseFollow(user.id, key, req.body.following);
    return res.json({ following: req.body.following });
  } catch (e) {
    next(e);
  }
});
router.use((req, res, next) =>
  res.locals.discoveryPreview || discoveryEnabled(req.user!.id)
    ? next()
    : res.sendStatus(404)
);
router.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = ((body: unknown) =>
    res.locals.discoveryPreview || discoveryEnabled(req.user!.id)
      ? json(body)
      : res.status(404).end()) as typeof res.json;
  next();
});
router.use('/created', catalogueLists);
router.get('/layout', (_req, res, next) => {
  try {
    return res.json(
      forYouLayout(readListStore().forYouLayouts?.[res.locals.discoveryUserId])
    );
  } catch (e) {
    next(e);
  }
});
router.put('/layout', (req, res, next) => {
  let layout;
  try {
    layout = forYouLayout(req.body);
  } catch {
    return res.sendStatus(400);
  }
  try {
    updateListStore((store) => {
      (store.forYouLayouts ??= {})[req.user!.id] = layout;
    });
    return res.json(layout);
  } catch (e) {
    next(e);
  }
});
router.get('/imports/:id', (req, res) => {
  const status = browserListStatus(req.params.id, req.user!.id);
  return status ? res.json(status) : res.sendStatus(404);
});
router.get('/releases', async (req, res, next) => {
  try {
    const data = await releasesForUser(res.locals.discoveryUserId);
    if (req.query.section) {
      const section = String(req.query.section),
        offset = Number(req.query.offset || 0);
      if (
        !['episodes', 'movies'].includes(section) ||
        !Number.isSafeInteger(offset) ||
        offset < 0
      )
        return res.sendStatus(400);
      const rows = section === 'episodes' ? data.episodes : data.movies;
      return res.json({
        results: rows.slice(offset, offset + 20),
        next: offset + 20 < rows.length ? offset + 20 : null,
      });
    }
    return res.json({
      episodes: data.episodes.slice(0, 20),
      movies: data.movies.slice(0, 20),
    });
  } catch (e) {
    next(e);
  }
});
router.get('/follow/:type/:id', async (req, res) => {
  try {
    const key = releaseKey(req.params.type, Number(req.params.id));
    const locked = (await requestFollowers(key)).has(req.user!.id);
    res.json({
      locked,
      following:
        locked ||
        (readReleaseState().follows[req.user!.id] || []).some(
          (i) => i.key === key
        ),
    });
  } catch {
    res.sendStatus(400);
  }
});
router.put('/follow/:type/:id', async (req, res) => {
  try {
    if (typeof req.body.following !== 'boolean') return res.sendStatus(400);
    const key = releaseKey(req.params.type, Number(req.params.id));
    if ((await requestFollowers(key)).has(req.user!.id)) {
      if (!req.body.following)
        return res
          .status(409)
          .json({ message: 'Requested titles cannot be unfollowed.' });
      return res.json({ following: true, locked: true });
    }
    setReleaseFollow(req.user!.id, key, req.body.following);
    return res.json({ following: req.body.following });
  } catch {
    return res.sendStatus(400);
  }
});
router.post('/import', (req, res) => {
  if (typeof req.body.url !== 'string' || req.body.url.length > 500)
    return res
      .status(400)
      .json({ message: 'Enter a public Letterboxd list URL.' });
  try {
    // Persist before replying. Repeated submissions subscribe to the same job;
    // the browser fallback and film matching no longer hold an HTTP request open.
    return res.status(202).json({
      jobId: queueBrowserList(req.body.url.trim(), req.user!.id, true),
    });
  } catch (error) {
    logger.warn('List import could not be queued', {
      label: 'Discovery lists',
      userId: req.user!.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return res
      .status(422)
      .json({ message: 'List could not be queued. Check the URL and retry.' });
  }
});
async function watchlistView(userId: number, source: 'plex' | 'letterboxd') {
  const snapshot = await discoveryWatchlists([userId], [], source);
  const items = [
    ...new Map(
      snapshot.interests.map((f) => [
        filmKey(f),
        { type: f.type, tmdbId: f.tmdbId },
      ])
    ).values(),
  ];
  const list: DiscoveryList = {
    id: `watchlist-${source}`,
    title: source === 'plex' ? 'Plex watchlist' : 'Letterboxd watchlist',
    creator: source === 'plex' ? 'Plex' : 'Letterboxd',
    description: 'Your watchlist, kept in sync with its source.',
    source: 'catalogue',
    ownerId: userId,
    visibility: 'private',
    checkedAt: Date.now(),
    items,
    history: [],
  };
  return { list, updating: snapshot.updating, unresolved: snapshot.unresolved };
}
router.get('/watchlists', async (_req, res, next) => {
  try {
    const userId = res.locals.discoveryUserId;
    const d = await discoveryData(userId);
    const snapshots = await Promise.all([
      watchlistView(userId, 'plex'),
      watchlistView(userId, 'letterboxd'),
    ]);
    return res.json({
      results: snapshots.map((s) => ({ ...d.summary(s.list), virtual: true })),
      updating: snapshots.some((s) => s.updating),
      unresolved: snapshots.some((s) => s.unresolved),
    });
  } catch (error) {
    next(error);
  }
});
router.get('/', async (req, res, next) => {
  try {
    const d = await discoveryData(res.locals.discoveryUserId),
      filter = String(req.query.filter || 'all');
    if (!['all', 'saved', 'created', 'liked', 'discover'].includes(filter))
      return res.sendStatus(400);
    const rows = (filter === 'discover' ? d.lists : d.mine)
      .map(d.summary)
      .filter((l) =>
        filter === 'saved'
          ? l.saved
          : filter === 'created'
            ? l.owned
            : filter === 'liked'
              ? l.liked
              : true
      );
    const unavailable = ['all', 'saved'].includes(filter)
      ? (d.store.saved[res.locals.discoveryUserId] || []).filter(
          (id) => !d.lists.some((l) => l.id === id)
        )
      : [];
    const unresolvedLiked = (
      d.store.liked[res.locals.discoveryUserId] || []
    ).filter((url) => !d.lists.some((l) => l.url === url)).length;
    return res.json({
      results: rows,
      ...(filter === 'discover'
        ? {
            explore: exploreLists(
              d.lists.filter(
                (list) =>
                  !d.feed.activity.some((a) => a.list.id === list.id) &&
                  !d.feed.continueLists.some((l) => l.id === list.id)
              ),
              d.store,
              d.users.map((u) => u.id),
              res.locals.discoveryUserId
            ).map(d.summary),
          }
        : {}),
      activity: d.feed.activity,
      unavailable,
      unresolvedLiked,
    });
  } catch (e) {
    next(e);
  }
});
router.get('/feed', async (req, res, next) => {
  try {
    const section = String(req.query.section || 'recommendations');
    const offset = Number(req.query.offset || 0);
    if (
      ![
        'requested',
        'unfinished',
        'unrated',
        'available',
        'recommendations',
        'friendsLoved',
        'together',
        'short',
        'activity',
        'continueLists',
        'almostFinished',
      ].includes(section) ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      return res.sendStatus(400);
    const d = await discoveryData(res.locals.discoveryUserId);
    // Independent list rows never rank films or query episode availability.
    if (
      section === 'activity' ||
      section === 'continueLists' ||
      section === 'almostFinished'
    ) {
      const lists =
        section === 'activity'
          ? d.feed.activity.map((a) => a.list)
          : d.feed[section];
      if (!d.visibilityStillValid())
        return res.status(409).json({ message: 'Visibility changed; retry.' });
      return res.json({
        results: lists.slice(offset, offset + 20),
        next: offset + 20 < lists.length ? offset + 20 : null,
        historyAvailable: d.historyAvailable,
      });
    }
    let ids = [res.locals.discoveryUserId];
    if (req.query.with && req.query.section === 'together') {
      ids = [
        ...new Set([
          res.locals.discoveryUserId,
          ...String(req.query.with).split(',').map(Number),
        ]),
      ];
      if (ids.length > 6 || ids.some((id) => !d.users.some((u) => u.id === id)))
        return res.sendStatus(400);
    }
    const visible = new Set(
      forYouLayout(readListStore().forYouLayouts?.[res.locals.discoveryUserId])
        .filter((row) => row.enabled)
        .map((row) => row.id)
    );
    const watchlists =
      section === 'together' && ids.length > 1
        ? await discoveryWatchlists(ids, d.filmHints())
        : { interests: [], updating: false, unresolved: 0 };
    const listInterests =
      section === 'together'
        ? ids.flatMap((userId) =>
            d.lists
              .filter(
                (l) =>
                  l.ownerId === userId ||
                  d.store.saved[userId]?.includes(l.id) ||
                  (!!l.url && d.store.liked[userId]?.includes(l.url))
              )
              .flatMap((l) => l.items.map((f) => ({ ...f, userId })))
          )
        : [];
    const together =
      section === 'together' && ids.length > 1
        ? cachedDiscoveryRanking(
            {
              kind: 'together',
              requester: res.locals.discoveryUserId,
              ids,
              users: d.users,
              ratings: d.ratings,
              watched: d.watched,
              candidates: d.candidates,
              watchlists: watchlists.interests,
              listInterests,
            },
            () =>
              prioritizeTogether(
                recommend(ids, d.ratings, d.watched, d.candidates),
                ids,
                watchlists.interests,
                listInterests
              )
          ).filter((f) => d.available.has(filmKey(f)))
        : [];
    const sections: Record<string, () => typeof d.feed.available> = {
      requested: () => requested,
      unfinished: () => unfinished,
      unrated: () =>
        recentUnrated(res.locals.discoveryUserId, d.watched, d.ratings),
      available: () => d.feed.available,
      recommendations: () => d.feed.recommendations,
      friendsLoved: () => d.feed.friendsLoved,
      together: () => together,
    };
    if (
      ![
        'requested',
        'unfinished',
        'unrated',
        'available',
        'recommendations',
        'friendsLoved',
        'together',
        'short',
      ].includes(section)
    )
      return res.sendStatus(400);
    const needsEpisodes =
      section === 'requested' ||
      section === 'unfinished' ||
      (!req.query.section &&
        (visible.has('requested') || visible.has('unfinished')));
    let episodeHistory: Awaited<ReturnType<typeof d.episodeHistory>> = [];
    let episodesAvailable = true;
    if (needsEpisodes) {
      try {
        episodeHistory = await d.episodeHistory();
      } catch {
        episodesAvailable = false;
      }
    }
    const requestedSeen = new Set(d.seen);
    for (const episode of episodeHistory)
      if (
        episode.userId === res.locals.discoveryUserId &&
        validEpisode(episode, true)
      )
        requestedSeen.add(`tv:${episode.tmdbId}`);
    const unfinished =
      (section === 'unfinished' ||
        (!req.query.section && visible.has('unfinished'))) &&
      episodesAvailable
        ? await unfinishedSeriesData(res.locals.discoveryUserId, episodeHistory)
        : [];
    const requested =
      section === 'requested' ||
      (!req.query.section && visible.has('requested'))
        ? requestedUnwatched(
            res.locals.discoveryUserId,
            await discoveryRequests(),
            requestedSeen,
            d.requestAvailable ?? d.available,
            d.historyAvailable && episodesAvailable
          )
        : [];
    let items =
      !req.query.section && !visible.has('recommendations')
        ? []
        : section === 'short'
          ? d.feed.recommendations.filter((f) => f.type === 'movie')
          : (sections[section]() as typeof d.feed.recommendations);
    let shortPage:
      | Awaited<ReturnType<typeof shortWatchPage<(typeof items)[number]>>>
      | undefined;
    if (req.query.list && section === 'available') {
      const list = d.mine.find((l) => l.id === req.query.list);
      if (!list) return res.sendStatus(404);
      const keys = new Set(list.items.map(filmKey));
      items = items.filter((f) => keys.has(filmKey(f)));
    }
    if (section === 'short') {
      const runtime = Number(req.query.runtime || 90);
      if (!Number.isInteger(runtime) || runtime < 30 || runtime > 240)
        return res.sendStatus(400);
      const tmdb = new TheMovieDb();
      shortPage = await shortWatchPage(
        items,
        offset,
        runtime,
        async (item) => {
          const m = await tmdb.getMovie({ movieId: item.tmdbId });
          return m.runtime;
        },
        (item, listRuntime) => ({ ...item, listRuntime })
      );
    }
    if (!res.locals.discoveryPreview && !discoveryEnabled(req.user!.id))
      return res.sendStatus(404);
    if (!d.visibilityStillValid())
      return res.status(409).json({ message: 'Visibility changed; retry.' });
    // Full-section pages do not consume homepage previews. Include picker
    // metadata only on their first page; subsequent pages are results only.
    if (req.query.section) {
      return res.json({
        results: shortPage
          ? shortPage.results
          : items.slice(offset, offset + 20),
        next: shortPage
          ? shortPage.next
          : offset + 20 < items.length
            ? offset + 20
            : null,
        historyAvailable: d.historyAvailable,
        ...(section === 'together'
          ? {
              watchlistsUpdating: watchlists.updating,
              watchlistsUnmatched: watchlists.unresolved,
            }
          : {}),
        ...(offset === 0 && section === 'together' ? { users: d.users } : {}),
        ...(offset === 0 && section === 'available'
          ? { lists: d.mine.map((l) => ({ id: l.id, title: l.title })) }
          : {}),
      });
    }
    return res.json({
      results: shortPage ? shortPage.results : items.slice(offset, offset + 20),
      next: shortPage
        ? shortPage.next
        : offset + 20 < items.length
          ? offset + 20
          : null,
      sections: {
        unfinished: unfinished.slice(0, 20),
        requested: requested.slice(0, 20),
        unrated: visible.has('unrated')
          ? recentUnrated(
              res.locals.discoveryUserId,
              d.watched,
              d.ratings
            ).slice(0, 20)
          : [],
        available: visible.has('available')
          ? d.feed.available.slice(0, 20)
          : [],
        recommendations: visible.has('recommendations')
          ? d.feed.recommendations.slice(0, 20)
          : [],
        friendsLoved: visible.has('friendsLoved')
          ? d.feed.friendsLoved.slice(0, 20)
          : [],
        activity: visible.has('activity') ? d.feed.activity : [],
        continueLists: visible.has('continueLists') ? d.feed.continueLists : [],
        almostFinished: visible.has('almostFinished')
          ? d.feed.almostFinished
          : [],
      },
      lists: d.mine.map(d.summary),
      users: d.users,
      historyAvailable: d.historyAvailable,
    });
  } catch (e) {
    next(e);
  }
});
router.put('/:id/save', (req, res) => {
  try {
    if (typeof req.body.saved !== 'boolean') return res.sendStatus(400);
    updateListStore((s) =>
      setListSaved(s, req.user!.id, req.params.id, req.body.saved)
    );
    return res.json({ saved: req.body.saved });
  } catch (error) {
    if (error instanceof Error && error.message === 'List unavailable')
      return res
        .status(404)
        .json({ message: 'This list is no longer available.' });
    logger.error('List save failed', {
      label: 'Discovery lists',
      userId: req.user!.id,
      listId: req.params.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return res
      .status(503)
      .json({ message: 'Could not save the list right now. Please retry.' });
  }
});
router.get('/:id', async (req, res, next) => {
  try {
    const d = await discoveryData(res.locals.discoveryUserId);
    const source =
      req.params.id === 'watchlist-plex'
        ? 'plex'
        : req.params.id === 'watchlist-letterboxd'
          ? 'letterboxd'
          : undefined;
    const virtual = source
      ? await watchlistView(res.locals.discoveryUserId, source)
      : undefined;
    const list = virtual?.list || d.lists.find((l) => l.id === req.params.id);
    if (!list) return res.sendStatus(404);
    const offset = Number(req.query.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return res.sendStatus(400);
    const items = list.items.filter(
      (f) =>
        (req.query.available !== 'true' || d.available.has(filmKey(f))) &&
        (req.query.unwatched !== 'true' || !d.seen.has(filmKey(f)))
    );
    const sort = String(req.query.sort || 'original') as ListSort;
    if (
      ![
        'original',
        'rating-desc',
        'rating-asc',
        'runtime-asc',
        'runtime-desc',
      ].includes(sort)
    )
      return res.sendStatus(400);
    const sorted = sortedList(items, sort);
    return res.json({
      ...d.summary(list),
      virtual: !!virtual,
      watchlistsUpdating: virtual?.updating,
      watchlistsUnmatched: virtual?.unresolved,
      metadataUpdating: sorted.updating,
      results: sorted.updating ? [] : sorted.items.slice(offset, offset + 20),
      next: sorted.updating
        ? null
        : offset + 20 < items.length
          ? offset + 20
          : null,
    });
  } catch (e) {
    next(e);
  }
});
export default router;
