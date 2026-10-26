import { getLetterboxdRating } from '@server/api/rating/letterboxd';
import { getRepository } from '@server/datasource';
import { LetterboxdAccount, MovieReview } from '@server/entity/MovieReview';
import {
  findObservation,
  readObservations,
  requestObservation,
  updateObservations,
} from './letterboxdObservations';
import { matchWatchlistFilm } from './letterboxdWatchlistMatch';
import {
  enqueueWrite,
  readWriteState,
  updateWriteState,
} from './letterboxdWriteQueue';
import { withReviewLock } from './reviews';

export const manualWatchedId = (
  userId: number,
  type: 'movie' | 'tv',
  id: number
) => `watched:${userId}:${type}:${id}`;
export function watchedOnlyRecord(
  userId: number,
  mediaType: 'movie' | 'tv',
  tmdbId: number,
  syncToLetterboxd: boolean,
  now = new Date().toISOString()
) {
  return {
    id: manualWatchedId(userId, mediaType, tmdbId),
    userId,
    mediaType,
    tmdbId,
    source: 'local' as const,
    watched: true,
    entryKind: 'summary' as const,
    rating: null,
    text: '',
    spoiler: false,
    syncToLetterboxd,
    seasonNumber: null,
    episodeNumber: null,
    episodeName: null,
    watchedDate: null,
    viewingEventId: null,
    externalUrl: null,
    externalEntryId: null,
    publishedAt: now,
    updatedAt: now,
  };
}
// Undated state only: never feeds the diary planner or writes ratings/reviews.
const cursors = new Map<number, number>();
export async function prepareManualWatched(
  userId: number,
  candidates?: MovieReview[],
  limit = 2
) {
  let queued = 0;
  const repo = getRepository(MovieReview);
  const initialState = readWriteState();
  const setting = initialState.settings[userId];
  if (!setting?.enabled || !setting.enabledSince) return;
  const account = await getRepository(LetterboxdAccount).findOneBy({ userId });
  if (!account?.enabled || account.username !== setting.account) return;
  const rows = (
    candidates ??
    (await repo.findBy({
      userId,
      source: 'local',
      mediaType: 'movie',
      syncToLetterboxd: true,
    }))
  ).filter(
    (r) =>
      r.id.startsWith('watched:') &&
      Date.parse(r.updatedAt) >= setting.enabledSince! &&
      !initialState.intents.some(
        (i) =>
          i.userId === userId &&
          i.account === setting.account &&
          i.originId === `${r.id}:${Date.parse(r.updatedAt)}`
      )
  );
  const offset = (cursors.get(userId) || 0) % Math.max(1, rows.length);
  const selected = [...rows.slice(offset), ...rows.slice(0, offset)].slice(
    0,
    Math.max(0, limit)
  );
  cursors.set(userId, offset + selected.length);
  for (const row of selected) {
    const originId = `${row.id}:${Date.parse(row.updatedAt)}`;
    if (
      readWriteState().intents.some(
        (i) =>
          i.userId === userId &&
          i.account === setting.account &&
          i.originId === originId
      )
    )
      continue;
    const rating = await getLetterboxdRating(row.tmdbId);
    const film = rating?.url && new URL(rating.url).pathname.split('/')[2];
    if (!film) continue;
    const match = await matchWatchlistFilm(film);
    if (match?.tmdbId !== row.tmdbId || match.mediaType !== 'movie') continue;
    await withReviewLock(userId, async () => {
      const fresh = readWriteState().settings[userId];
      const linked = await getRepository(LetterboxdAccount).findOneBy({
        userId,
      });
      const current = await repo.findOneBy({ id: row.id });
      if (
        !current?.watched ||
        !current.syncToLetterboxd ||
        current.updatedAt !== row.updatedAt
      )
        return;
      if (
        !fresh?.enabled ||
        fresh.account !== setting.account ||
        fresh.enabledSince !== setting.enabledSince ||
        !linked?.enabled ||
        linked.username !== setting.account
      )
        return;
      const scope = { userId, account: setting.account, film };
      const observation = findObservation(
        readObservations(),
        scope,
        Date.parse(row.updatedAt)
      );
      if (typeof observation?.watched !== 'boolean') {
        updateObservations((s) => requestObservation(s, scope));
        return;
      }
      if (observation.watched) {
        await repo.update({ id: row.id }, { syncToLetterboxd: false });
        return;
      }
      updateWriteState((state) =>
        enqueueWrite(
          state,
          {
            userId,
            account: setting.account,
            originId,
            originEntityId: row.id,
            kind: 'watched',
            film,
            expected: { watched: false },
            desired: { watched: true },
          },
          'local',
          Date.now()
        )
      );
      queued++;
    });
  }
  return queued;
}
