import { MediaStatus } from '@server/constants/media';
import type { MovieReview } from '@server/entity/MovieReview';
import { appDataPath } from '@server/utils/appDataVolume';
import fs from 'fs';
import path from 'path';
import {
  discoveryMedia,
  discoveryReviews,
  discoveryUsers,
} from './discoveryDatabaseCache';
import {
  allLists,
  filmKey,
  readListStore,
  updateListStore,
  visibleList,
  type ListFilm,
} from './discoveryLists';
import { cachedDiscoveryRanking } from './discoveryRankingCache';
import {
  catalogueTasteRatings,
  diversify,
  listProgress,
  recommend,
  type Viewing,
} from './discoveryRecommendations';
import {
  assertDiscoveryRevision,
  discoveryCache,
  discoveryFileStamp,
  discoveryRevision,
  stableDiscoveryRead,
} from './discoverySharedCache';
import { letterboxdRecentStamp } from './letterboxdRecent';

const reviewProjection = discoveryCache<{
  rows: MovieReview[];
  ratings: ReturnType<typeof catalogueTasteRatings>;
  watched: Viewing[];
}>();
const snapshotIds = new WeakMap<object, number>();
let nextSnapshotId = 0;
function snapshotId(value: object) {
  if (!snapshotIds.has(value)) snapshotIds.set(value, ++nextSnapshotId);
  return snapshotIds.get(value);
}

// Coalesce simultaneous history reads without extending the underlying cache's
// freshness window or sharing mutable request projections between consumers.
const pendingHistory = discoveryCache<Viewing[]>(32, 0);
export async function discoveryData(userId: number) {
  return stableDiscoveryRead(() => buildDiscoveryData(userId));
}

async function buildDiscoveryData(userId: number) {
  const revision = discoveryRevision();
  const policyFile = path.join(appDataPath(), 'social.json');
  const policyText = () => {
    try {
      return fs.readFileSync(policyFile, 'utf8');
    } catch {
      return '';
    }
  };
  const initialPolicy = policyText();
  const files = [
    'social.json',
    'viewing-attribution.json',
    'watch-party.json',
    'letterboxd-playback-events.json',
    'letterboxd-party-playback-events.json',
  ].map((name) => path.join(appDataPath(), name));
  try {
    const mapping = JSON.parse(
      initialPolicy.replace(/^\uFEFF/, '')
    ).mappingScript;
    if (typeof mapping === 'string') files.push(mapping);
  } catch {
    /* Invalid policy is handled below. */
  }
  const initialFiles = discoveryFileStamp(files);
  let hidden: number[] = [],
    social = false;
  try {
    const p = JSON.parse(
      fs
        .readFileSync(path.join(appDataPath(), 'social.json'), 'utf8')
        .replace(/^\uFEFF/, '')
    );
    social = p.enabled === true;
    hidden = Array.isArray(p.hiddenWatchers) ? p.hiddenWatchers : [];
  } catch {
    /* Fail closed for other users. */
  }
  const [users, reviews, media] = await Promise.all([
    discoveryUsers(),
    discoveryReviews(),
    discoveryMedia(),
  ]);
  const visibleUsers = users.filter(
    (u) => u.id === userId || (social && !hidden.includes(u.id))
  );
  const allowed = new Set(visibleUsers.map((u) => u.id));
  const blocked = new Set(
    media
      .filter(
        (m) =>
          m.status === MediaStatus.BLOCKLISTED ||
          m.status4k === MediaStatus.BLOCKLISTED
      )
      .map((m) => `${m.mediaType}:${m.tmdbId}`)
  );
  const projection = await reviewProjection(
    JSON.stringify([
      userId,
      initialPolicy,
      snapshotId(users),
      snapshotId(reviews),
      snapshotId(media),
    ]),
    async () => {
      const rows = reviews.filter(
        (r) =>
          allowed.has(r.userId) &&
          r.seasonNumber == null &&
          r.episodeNumber == null &&
          !blocked.has(`${r.mediaType}:${r.tmdbId}`)
      );
      const ratings = catalogueTasteRatings(rows);
      const watched: Viewing[] = rows
        .filter((r) => r.watched || r.watchedDate)
        .map((r) => ({
          type: r.mediaType,
          tmdbId: r.tmdbId,
          userId: r.userId,
          at: r.watchedDate
            ? (letterboxdRecentStamp(r) ?? 0) * 1000
            : undefined,
        }));
      return { rows, ratings, watched };
    }
  );
  const { rows } = projection;
  const ratings = structuredClone(projection.ratings);
  const watched = structuredClone(projection.watched);
  let historyAvailable = true;
  try {
    const { discoveryViewingHistory } = await import('../routes/social');
    watched.push(
      ...(
        await pendingHistory(
          JSON.stringify([
            userId,
            initialPolicy,
            initialFiles,
            snapshotId(users),
            snapshotId(media),
          ]),
          () => discoveryViewingHistory(userId, { users, media })
        )
      ).filter((w) => allowed.has(w.userId) && !blocked.has(filmKey(w)))
    );
  } catch {
    historyAvailable = false;
  }
  for (const name of [
    'letterboxd-playback-events.json',
    'letterboxd-party-playback-events.json',
  ]) {
    try {
      const data = JSON.parse(
        fs.readFileSync(path.join(appDataPath(), name), 'utf8')
      );
      for (const e of data.events || [])
        if (
          allowed.has(e.userId) &&
          Number.isSafeInteger(e.tmdbId) &&
          !blocked.has(`movie:${e.tmdbId}`)
        )
          watched.push({
            type: 'movie',
            tmdbId: e.tmdbId,
            userId: e.userId,
            at: e.occurredAt,
          });
    } catch {
      /* No synthetic dates. */
    }
  }
  const available = new Set(
    media
      .filter(
        (m) =>
          !blocked.has(`${m.mediaType}:${m.tmdbId}`) &&
          (m.status === MediaStatus.AVAILABLE ||
            m.status4k === MediaStatus.AVAILABLE)
      )
      .map((m) => `${m.mediaType}:${m.tmdbId}`)
  );
  const now = Date.now();
  assertDiscoveryRevision(revision);
  if (discoveryFileStamp(files) !== initialFiles)
    throw Error('Visibility changed; retry discovery');
  let store = readListStore();
  // Avoid serializing the entire list archive on ordinary page reads.
  if (
    [...new Set([...Object.keys(store.availability), ...available])].some(
      (key) => store.availability[key]?.available !== available.has(key)
    )
  ) {
    updateListStore((s) => {
      const first = Object.keys(s.availability).length === 0;
      for (const key of new Set([
        ...Object.keys(s.availability),
        ...available,
      ])) {
        const old = s.availability[key],
          isAvailable = available.has(key);
        s.availability[key] = {
          available: isAvailable,
          since: old?.available === isAvailable ? old.since : first ? 0 : now,
        };
      }
    });
    store = readListStore();
  }
  const lists = allLists(store)
    .filter((l) => visibleList(l, userId, now))
    .map((l) => ({
      ...l,
      items: l.items.filter((f) => !blocked.has(filmKey(f))),
    }));
  const saved = new Set(store.saved[userId] || []),
    liked = new Set(store.liked[userId] || []);
  const mine = lists.filter(
    (l) =>
      l.ownerId === userId || saved.has(l.id) || (l.url && liked.has(l.url))
  );
  const seen = new Set(watched.filter((w) => w.userId === userId).map(filmKey));
  const summaries = new Map<
    (typeof lists)[number],
    ReturnType<typeof buildSummary>
  >();
  const buildSummary = (l: (typeof lists)[number]) => ({
    id: l.id,
    title: l.title,
    description: l.description,
    unmatched: l.unmatched || [],
    creator: l.creator,
    url: l.url,
    source: l.source,
    visibility: l.visibility,
    owned: l.ownerId === userId,
    liked: !!l.url && liked.has(l.url),
    saved: saved.has(l.id),
    progress: listProgress(l, userId, watched, now),
    available: l.items.filter((f) => available.has(filmKey(f))).length,
    covers: l.items.slice(0, 5),
  });
  const summary = (l: (typeof lists)[number]) => {
    let result = summaries.get(l);
    if (!result) {
      result = buildSummary(l);
      summaries.set(l, result);
    }
    return result;
  };
  const ownFilms = [
    ...new Map(
      mine.flatMap((l) => l.items).map((f) => [filmKey(f), f])
    ).values(),
  ];
  const candidates: ListFilm[] = [
    ...lists.flatMap((l) => l.items),
    ...media
      .filter((m) => available.has(`${m.mediaType}:${m.tmdbId}`))
      .map((m) => ({ type: m.mediaType as 'movie' | 'tv', tmdbId: m.tmdbId })),
  ];
  // List browsing needs progress, not taste ranking. Compute rankings only for
  // consumers that actually read them, once per fresh request projection.
  let ranked: ReturnType<typeof recommend> | undefined;
  const recommendations = () =>
    (ranked ??= !historyAvailable
      ? diversify(recommend([userId], ratings, watched, candidates), lists)
      : cachedDiscoveryRanking(
          {
            userId,
            policy: initialPolicy,
            ratings,
            watched,
            candidates,
            lists: lists.map((l) => l.items),
          },
          () =>
            diversify(recommend([userId], ratings, watched, candidates), lists)
        ));
  const mineIds = new Set(mine.map((l) => l.id));
  let activityRows:
    | {
        list: ReturnType<typeof summary>;
        progress: ReturnType<typeof summary>['progress'];
      }[]
    | undefined;
  let continuing: ReturnType<typeof summary>[] | undefined;
  let finishing: ReturnType<typeof summary>[] | undefined;
  const activity = () =>
    (activityRows ??= lists
      .filter((l) => !mineIds.has(l.id))
      .map((l) => ({
        list: summary(l),
        progress: summary(l).progress,
      }))
      .filter((a) => a.progress.recent >= 2 && a.progress.remaining > 0)
      .sort((a, b) => b.progress.activityScore - a.progress.activityScore)
      .slice(0, 12));
  assertDiscoveryRevision(revision);
  if (policyText() !== initialPolicy)
    throw Error('Visibility changed; retry discovery');
  const responseFiles = [
    ...files,
    path.join(appDataPath(), 'discovery-lists.json'),
  ];
  const responseStamp = discoveryFileStamp(responseFiles);
  return {
    store,
    lists,
    mine,
    summary,
    available,
    get requestAvailable() {
      return new Set([
        ...available,
        ...media
          .filter(
            (m) =>
              m.mediaType === 'tv' &&
              !blocked.has(`tv:${m.tmdbId}`) &&
              (m.status === MediaStatus.PARTIALLY_AVAILABLE ||
                m.status4k === MediaStatus.PARTIALLY_AVAILABLE)
          )
          .map((m) => `tv:${m.tmdbId}`),
      ]);
    },
    watched,
    ratings,
    seen,
    candidates,
    // Already-loaded, visibility-filtered reviews provide exact film identities
    // without an extra DB query or a Letterboxd request per watchlist film.
    filmHints: () =>
      rows
        .filter((r) => r.externalUrl)
        .map((r) => ({
          externalUrl: r.externalUrl!,
          tmdbId: r.tmdbId,
          mediaType: r.mediaType,
        })),
    historyAvailable,
    episodeHistory: async () => {
      const { discoveryViewingHistory } = await import('../routes/social');
      const history = await discoveryViewingHistory(
        userId,
        { users, media },
        true
      );
      for (const review of reviews) {
        if (
          review.userId === userId &&
          review.mediaType === 'tv' &&
          review.seasonNumber != null &&
          review.episodeNumber != null &&
          (review.watched || review.watchedDate) &&
          !blocked.has(`tv:${review.tmdbId}`)
        ) {
          history.push({
            type: 'tv',
            tmdbId: review.tmdbId,
            userId,
            season: review.seasonNumber,
            episode: review.episodeNumber,
            at: review.watchedDate
              ? (letterboxdRecentStamp(review) ?? 0) * 1000
              : 0,
          });
        }
      }
      return history;
    },
    visibilityStillValid: () => {
      try {
        assertDiscoveryRevision(revision);
        return (
          policyText() === initialPolicy &&
          discoveryFileStamp(responseFiles) === responseStamp &&
          lists.every((list) => visibleList(list, userId))
        );
      } catch {
        return false;
      }
    },
    users: visibleUsers.map((u) => ({
      id: u.id,
      name: u.displayName,
      avatar: u.avatar,
    })),
    feed: {
      get available() {
        return ownFilms.filter(
          (f) => available.has(filmKey(f)) && !seen.has(filmKey(f))
        );
      },
      get continueLists() {
        return (continuing ??= mine
          .map(summary)
          .filter((l) => l.progress.recent > 0 && l.progress.remaining > 0)
          .sort((a, b) => b.progress.activityScore - a.progress.activityScore)
          .slice(0, 2));
      },
      get almostFinished() {
        return (finishing ??= mine
          .map(summary)
          .filter(
            (l) =>
              l.progress.watched > 0 &&
              l.progress.remaining > 0 &&
              l.progress.remaining <= 5 &&
              l.progress.watched / l.progress.total >= 0.7
          )
          .slice(0, 6));
      },
      get recommendations() {
        return recommendations().filter((f) => available.has(filmKey(f)));
      },
      get friendsLoved() {
        return recommendations().filter((f) => f.supporters.length > 0);
      },
      get activity() {
        return activity();
      },
    },
  };
}
