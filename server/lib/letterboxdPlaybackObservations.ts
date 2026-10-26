import type {
  ObservationScope,
  ReviewObservation,
} from './letterboxdObservations';
import type { CompletedPlaybackEvent as PlaybackEvent } from './letterboxdPartyPlaybackEvents';
import type { PlaybackObservation } from './letterboxdPlaybackPublishing';
import type { SyncReceipt } from './letterboxdSyncReceipts';
import type { WriteIntent } from './letterboxdWriteQueue';

/** Shared observation API integration contract. `watched` must be read from the
 * authenticated film-wide UI and validated/persisted by reportObservation.
 * `diaryEntryIds` must enumerate the film's diary entries, with completeness
 * explicitly verified across all pages. A watched flag alone is insufficient.
 * Missing data from older workers is unknown, never false. Review absence alone
 * does not establish diary absence. Rewatches require a complete dated inventory
 * strictly preceding this event's date; same-day entries are ambiguous.
 */
export type PlaybackReviewObservation = ReviewObservation & {
  watched?: boolean;
  diaryEntriesComplete?: boolean;
  diaryEntryIds?: string[];
};
type Dependencies = {
  resolve: (tmdbId: number) => Promise<string | null>;
  match: (
    film: string
  ) => Promise<{ tmdbId: number; mediaType: string } | null>;
  observation: (
    scope: ObservationScope,
    after: number,
    now: number
  ) => PlaybackReviewObservation | null;
  request: (scope: ObservationScope, now: number) => void;
  receipts: () => SyncReceipt[];
  intents: () => WriteIntent[];
  now: () => number;
};
const MAX_AGE = 5 * 60 * 1000;

function receiptFilm(entryId: string, account: string): string | null {
  try {
    const url = new URL(entryId);
    const match =
      /^\/([a-z0-9_]+)\/film\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/\d+)?\/$/.exec(
        url.pathname
      );
    return url.origin === 'https://letterboxd.com' &&
      !url.search &&
      !url.hash &&
      match?.[1] === account
      ? match[2]
      : null;
  } catch {
    return null;
  }
}

/** Read-only reconciliation apart from requesting an authenticated observation.
 * Never equate a film/date match with a playback identity. */
export async function observePlaybackEvent(
  event: PlaybackEvent,
  deps: Dependencies
): Promise<PlaybackObservation | null> {
  if (
    !['tautulli', 'party'].includes(event.source) ||
    !Number.isSafeInteger(event.userId) ||
    event.userId < 1 ||
    !/^[a-z0-9_]{1,40}$/.test(event.account) ||
    !new RegExp(`^${event.source}:[a-f0-9]{64}$`).test(event.id) ||
    !Number.isSafeInteger(event.tmdbId) ||
    event.tmdbId <= 0 ||
    !Number.isFinite(event.occurredAt) ||
    event.occurredAt <= 0 ||
    event.occurredAt > deps.now()
  )
    return null;
  const film = await deps.resolve(event.tmdbId);
  if (!film || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(film) || film.length > 200)
    return null;
  const match = await deps.match(film);
  if (match?.mediaType !== 'movie' || match.tmdbId !== event.tmdbId)
    return null;
  const now = deps.now();
  const scope = { userId: event.userId, account: event.account, film };
  const receipts = deps.receipts();
  const linked = receipts.filter(
    (r) => r.userId === event.userId && r.originId === event.id
  );
  // A receipt is event evidence only when it names this exact event, entry,
  // account and real playback date. A review receipt on the same day is not.
  if (linked.length === 1) {
    const receipt = linked[0];
    if (
      receipt.account === event.account &&
      receiptFilm(receipt.entryId, event.account) === film &&
      receipt.diaryBaseline?.watchedDate === event.watchedDate &&
      typeof receipt.diaryBaseline.rewatch === 'boolean' &&
      Number.isFinite(receipt.verifiedAt) &&
      receipt.verifiedAt! >= event.occurredAt &&
      receipt.verifiedAt! <= now
    ) {
      return {
        ...scope,
        eventId: event.id,
        tmdbId: event.tmdbId,
        verified: true,
        observedAt: receipt.verifiedAt!,
        watched: true,
        eventMatch: 'linked',
      };
    }
  }
  // A mismatched receipt cannot be repaired by creating a new diary entry.
  if (linked.length) return null;
  const observation = deps.observation(scope, event.occurredAt, now);
  if (
    !observation ||
    !Number.isFinite(observation.observedAt) ||
    observation.observedAt < event.occurredAt ||
    observation.observedAt > now ||
    now - observation.observedAt >= MAX_AGE
  ) {
    deps.request(scope, now);
    return null;
  }
  if (typeof observation.watched !== 'boolean') return null;
  if (
    observation.diaryEntriesComplete !== true ||
    !Array.isArray(observation.diaryEntryIds) ||
    observation.diaryEntryIds.some(
      (entryId) => receiptFilm(entryId, event.account) !== film
    )
  )
    return null;
  const ids = observation.diaryEntryIds;
  const dates = observation.diaryEntryDates;
  const earlierInventory =
    observation.watched === true &&
    ids.length > 0 &&
    dates !== undefined &&
    Object.keys(dates).length === ids.length &&
    new Set(ids).size === ids.length &&
    ids.every((id) => {
      const date = dates[id];
      return (
        typeof date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        Number.isFinite(Date.parse(date)) &&
        new Date(date).toISOString().slice(0, 10) === date &&
        date < event.watchedDate
      );
    }) &&
    (!observation.entryId || ids.includes(observation.entryId));
  const accountedReceipt = (r: SyncReceipt) =>
    earlierInventory &&
    ids.includes(r.entryId) &&
    Number.isFinite(r.verifiedAt) &&
    r.verifiedAt! <= observation.observedAt &&
    (!r.diaryBaseline || r.diaryBaseline.watchedDate === dates![r.entryId]);
  const conflictingReceipt = receipts.some(
    (r) =>
      r.userId === event.userId &&
      r.account === event.account &&
      receiptFilm(r.entryId, event.account) === film &&
      !accountedReceipt(r)
  );
  // Serialize films as well as events: two same-day events must not both use
  // an unwatched baseline while the first diary is still queued or uncertain.
  const conflictingWrite = deps
    .intents()
    .some(
      (i) =>
        i.userId === event.userId &&
        i.account === event.account &&
        i.film === film &&
        (i.state !== 'verified' ||
          (['diary', 'watched', 'review'].includes(i.kind) &&
            !receipts.some(
              (r) =>
                r.userId === i.userId &&
                r.account === i.account &&
                r.originId === i.originEntityId &&
                r.entryId === i.entryId &&
                accountedReceipt(r)
            )))
    );
  const firstWatch =
    observation.watched === false &&
    observation.diaryEntryIds.length === 0 &&
    !observation.entryId &&
    observation.rating === null &&
    observation.text === '' &&
    observation.spoiler === false;
  const absent =
    (firstWatch || earlierInventory) &&
    !conflictingReceipt &&
    !conflictingWrite;
  return {
    ...scope,
    eventId: event.id,
    tmdbId: event.tmdbId,
    verified: true,
    observedAt: observation.observedAt,
    watched: observation.watched,
    eventMatch: absent ? 'absent' : 'ambiguous',
  };
}

export async function observeLetterboxdPlaybackEvent(event: PlaybackEvent) {
  // Lazy imports keep pure provider tests independent of the database/runtime.
  const { getLetterboxdRating } = await import('@server/api/rating/letterboxd');
  const { matchWatchlistFilm } = await import('./letterboxdWatchlistMatch');
  const {
    findObservation,
    readObservations,
    requestObservation,
    updateObservations,
  } = await import('./letterboxdObservations');
  const { readSyncReceipts } = await import('./letterboxdSyncReceipts');
  const { readWriteState } = await import('./letterboxdWriteQueue');
  return observePlaybackEvent(event, {
    resolve: async (tmdbId) => {
      const rating = await getLetterboxdRating(tmdbId);
      if (!rating) return null;
      try {
        const url = new URL(rating.url);
        return url.origin === 'https://letterboxd.com' &&
          !url.search &&
          !url.hash
          ? (/^\/film\/([a-z0-9]+(?:-[a-z0-9]+)*)\/$/.exec(url.pathname)?.[1] ??
              null)
          : null;
      } catch {
        return null;
      }
    },
    match: matchWatchlistFilm,
    observation: (scope, after, now) =>
      findObservation(readObservations(), scope, after, now),
    request: (scope, now) => {
      updateObservations((s) => requestObservation(s, scope, now));
    },
    receipts: readSyncReceipts,
    intents: () => readWriteState().intents,
    now: Date.now,
  });
}
