import { reviewActivityDate } from '@server/lib/reviewChronology';
import TheMovieDb from '@server/api/themoviedb';
import { getRepository } from '@server/datasource';
import { LetterboxdExportBaseline } from '@server/entity/LetterboxdExport';
import { LetterboxdAccount, MovieReview } from '@server/entity/MovieReview';
import { User } from '@server/entity/User';
import { communityRating } from '@server/lib/communityRating';
import { episodeReviewScope } from '@server/lib/episodeReviewScope';
import { archiveReviews } from '@server/lib/letterboxdArchive';
import {
  disableLetterboxdBrowser,
  readBrowserState,
} from '@server/lib/letterboxdBrowser';
import { wasVerifiedDeleted } from '@server/lib/letterboxdDeletedEntries';
import { currentSyncReceipts } from '@server/lib/letterboxdExportPolicy';
import {
  readFilmEvidence,
  verifiedRatingSource,
} from '@server/lib/letterboxdFilmEvidence';
import {
  csvReviews,
  ratingValue,
  type ImportedReview,
} from '@server/lib/letterboxdImport';
import { publicationSchedule } from '@server/lib/letterboxdPublicationSchedule';
import { readSyncReceipts } from '@server/lib/letterboxdSyncReceipts';
import {
  readWriteState,
  setWriteEnabled,
  updateWriteState,
} from '@server/lib/letterboxdWriteQueue';
import { manualWatchedId, watchedOnlyRecord } from '@server/lib/manualWatched';
import { Permission, hasPermission } from '@server/lib/permissions';
import { manualDiaryViewing } from '@server/lib/reviewDiaryPublication';
import {
  latestReviewViewing,
  scopedReviewId,
} from '@server/lib/reviewEntrySelection';
import {
  cancelQueuedReviewWrites,
  reviewPublishingEnabled,
  reviewPublishingPreference,
  reviewSyncInProgress,
} from '@server/lib/reviewPublishingPolicy';
import { linkedReviewSource } from '@server/lib/reviewSource';
import { visibleReviewEntries } from '@server/lib/reviewVisibility';
import {
  expandReviewLink,
  resolveReview,
  saveImported,
  syncReviews,
  withReviewLock,
} from '@server/lib/reviews';
import { getSettings } from '@server/lib/settings';
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { In, IsNull } from 'typeorm';

const router = Router();
const positive = (v: unknown) =>
  Number.isSafeInteger(Number(v)) && Number(v) > 0;
const admin = (req: Express.Request) =>
  hasPermission(Permission.ADMIN, req.user!.permissions);
const managesLetterboxd = (req: Express.Request, userId: number) =>
  positive(userId) && (admin(req) || req.user?.id === userId);
const reviewType = (req: Request) =>
  req.query.mediaType === 'tv' ? 'tv' : 'movie';
const localId = (req: Request) => {
  const scope = episodeReviewScope(req.query);
  const base = `local:${req.user!.id}:${reviewType(req) === 'tv' ? 'tv:' : ''}${req.params.movieId}${scope ? `:s${scope.seasonNumber}:e${scope.episodeNumber}` : ''}`;
  return scopedReviewId(base, req.query.entryId);
};
router.use((_req, res, next) => {
  try {
    episodeReviewScope(_req.query);
  } catch {
    return res.sendStatus(400);
  }
  if (
    _req.query.mediaType !== undefined &&
    !['movie', 'tv'].includes(String(_req.query.mediaType))
  )
    return res.sendStatus(400);
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});
router.get('/entry/:id', async (req, res) => {
  if (!/^[a-z0-9:_-]{1,180}$/i.test(req.params.id)) return res.sendStatus(400);
  const review = await getRepository(MovieReview).findOneBy({
    id: req.params.id,
  });
  if (!review) return res.json({ review: null });
  const user = await getRepository(User).findOneBy({ id: review.userId });
  return res.json({
    review: {
      ...review,
      syncingToLetterboxd: reviewSyncInProgress(
        review,
        readWriteState(),
        req.user?.id
      ),
      ...verifiedRatingSource(review, readFilmEvidence()),
      ...linkedReviewSource(
        review,
        await currentSyncReceipts(),
        wasVerifiedDeleted
      ),
      user: user
        ? { id: user.id, name: user.displayName, avatar: user.avatar }
        : undefined,
    },
  });
});
router.get('/', async (req, res) => {
  try {
    const movie = req.query.movieId,
      days = Number(req.query.days || 28),
      page = Number(req.query.page || 1);
    if (
      (movie !== undefined && !positive(movie)) ||
      !Number.isInteger(days) ||
      days < 1 ||
      days > 365 ||
      !positive(page) ||
      page > 10000
    )
      return res.sendStatus(400);
    const q = getRepository(MovieReview).createQueryBuilder('review');
    if (movie)
      q.where('review.tmdbId = :movie AND review.mediaType = :mediaType', {
        movie: Number(movie),
        mediaType: reviewType(req),
      });
    else
      q.where(`${reviewActivityDate} >= :since`, {
        since: new Date(Date.now() - days * 86400000).toISOString().slice(0, 10),
      }).andWhere("review.text <> ''");
    const receipts = await currentSyncReceipts();
    const filmEvidence = readFilmEvidence();
    visibleReviewEntries(q, getRepository(MovieReview), receipts, filmEvidence);
    if (movie) {
      const scope = episodeReviewScope(req.query);
      if (scope)
        q.andWhere(
          'review.seasonNumber = :seasonNumber AND review.episodeNumber = :episodeNumber',
          scope
        );
      else q.andWhere('review.episodeNumber IS NULL');
    }
    const [rows, total] = await q
      .addSelect(reviewActivityDate, 'review_activity_date')
      .orderBy('review_activity_date', 'DESC')
      .addOrderBy('review.publishedAt', 'DESC')
      .addOrderBy('review.id', 'ASC')
      .skip((page - 1) * 20)
      .take(20)
      .getManyAndCount();
    const users = rows.length
      ? await getRepository(User).findBy({
          id: In([...new Set(rows.map((r) => r.userId))]),
        })
      : [];
    const writeState = readWriteState();
    return res.json({
      results: rows.map((r) => ({
        ...r,
        syncingToLetterboxd: reviewSyncInProgress(r, writeState, req.user?.id),
        ...verifiedRatingSource(r, filmEvidence),
        ...linkedReviewSource(r, receipts, wasVerifiedDeleted),
        user: users
          .filter((u) => u.id === r.userId)
          .map((u) => ({ id: u.id, name: u.displayName, avatar: u.avatar }))[0],
      })),
      total,
      page,
    });
  } catch {
    return res.sendStatus(503);
  }
});
router.get('/average/:movieId', async (req, res) => {
  if (!positive(req.params.movieId)) return res.sendStatus(400);
  try {
    const rows = await getRepository(MovieReview).findBy({
      tmdbId: Number(req.params.movieId),
      mediaType: reviewType(req),
      episodeNumber: IsNull(),
    });
    return res.json(communityRating(rows));
  } catch {
    return res.sendStatus(503);
  }
});
router.get('/episodes/:tvId', async (req, res) => {
  if (!positive(req.params.tvId)) return res.sendStatus(400);
  try {
    const results = await getRepository(MovieReview)
      .createQueryBuilder('review')
      .select('review.seasonNumber', 'seasonNumber')
      .addSelect('review.episodeNumber', 'episodeNumber')
      .addSelect('AVG(review.rating)', 'average')
      .addSelect('COUNT(review.rating)', 'count')
      .where(
        "review.tmdbId = :id AND review.mediaType = 'tv' AND review.source = 'local' AND review.episodeNumber IS NOT NULL",
        { id: Number(req.params.tvId) }
      )
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM movie_review newer WHERE newer."userId" = review.userId AND newer."tmdbId" = review.tmdbId AND newer."mediaType" = review.mediaType AND newer.source = 'local' AND newer."seasonNumber" = review.seasonNumber AND newer."episodeNumber" = review.episodeNumber AND (newer."publishedAt" > review.publishedAt OR (newer."publishedAt" = review.publishedAt AND newer.id > review.id)))`
      )
      .groupBy('review.seasonNumber')
      .addGroupBy('review.episodeNumber')
      .getRawMany();
    return res.json({
      results: results.map((r) => ({
        seasonNumber: Number(r.seasonNumber),
        episodeNumber: Number(r.episodeNumber),
        average: r.average === null ? null : Number(r.average),
        count: Number(r.count),
      })),
    });
  } catch {
    return res.sendStatus(503);
  }
});
router.get('/mine/:movieId', async (req, res) => {
  if (!positive(req.params.movieId)) return res.sendStatus(400);
  const account = await getRepository(LetterboxdAccount).findOneBy({
    userId: req.user!.id,
  });
  const scope = episodeReviewScope(req.query);
  const entries = (
    await getRepository(MovieReview).find({
      where: {
        userId: req.user!.id,
        tmdbId: Number(req.params.movieId),
        mediaType: reviewType(req),
        source: 'local',
        seasonNumber: scope?.seasonNumber ?? IsNull(),
        episodeNumber: scope?.episodeNumber ?? IsNull(),
      },
      order: { publishedAt: 'DESC', id: 'ASC' },
    })
  ).filter((entry) => entry.rating !== null || entry.text.trim().length > 0);
  return res.json({
    review: req.query.entryId
      ? entries.find((r) => r.id === localId(req)) || null
      : entries[0] || null,
    entries,
    latestViewing: scope
      ? null
      : await latestReviewViewing(
          req.user!.id,
          Number(req.params.movieId),
          reviewType(req)
        ),
    publishing: {
      enabled: reviewPublishingEnabled(
        req.user!.id,
        reviewType(req),
        account,
        readWriteState().settings[req.user!.id]
      ),
      schedule: publicationSchedule(
        getSettings().jobs['letterboxd-publication-sync']?.schedule
      ),
    },
  });
});
router.get('/watched/:movieId', async (req, res, next) => {
  if (!positive(req.params.movieId)) return res.sendStatus(400);
  try {
    const rows = await getRepository(MovieReview).findBy({
      userId: req.user!.id,
      tmdbId: Number(req.params.movieId),
      mediaType: reviewType(req),
      seasonNumber: IsNull(),
      episodeNumber: IsNull(),
    });
    return res.json({
      watched: rows.some((r) => r.watched || !!r.watchedDate),
    });
  } catch (e) {
    next(e);
  }
});
router.put(
  '/watched/:movieId',
  rateLimit({ windowMs: 60000, max: 20 }),
  async (req, res, next) => {
    if (
      !positive(req.params.movieId) ||
      req.body.watched !== true ||
      episodeReviewScope(req.query)
    )
      return res.sendStatus(400);
    try {
      const tmdbId = Number(req.params.movieId),
        mediaType = reviewType(req),
        userId = req.user!.id;
      if (mediaType === 'movie')
        await new TheMovieDb().getMovie({ movieId: tmdbId });
      else await new TheMovieDb().getTvShow({ tvId: tmdbId });
      await withReviewLock(userId, async () => {
        const repo = getRepository(MovieReview);
        if (
          await repo.findOneBy({
            id: manualWatchedId(userId, mediaType, tmdbId),
          })
        )
          return;
        const account = await getRepository(LetterboxdAccount).findOneBy({
          userId,
        });
        const enabled = reviewPublishingEnabled(
          userId,
          mediaType,
          account,
          readWriteState().settings[userId]
        );
        await repo.save(
          repo.create(watchedOnlyRecord(userId, mediaType, tmdbId, enabled))
        );
      });
      return res.json({ watched: true });
    } catch (e) {
      next(e);
    }
  }
);
router.put(
  '/mine/:movieId',
  rateLimit({ windowMs: 60000, max: 20 }),
  async (req, res) => {
    if (!positive(req.params.movieId)) return res.sendStatus(400);
    try {
      const rating = ratingValue(req.body.rating),
        text = req.body.text;
      if (
        typeof text !== 'string' ||
        text.length > 20000 ||
        typeof req.body.spoiler !== 'boolean' ||
        (req.body.syncToLetterboxd !== undefined &&
          typeof req.body.syncToLetterboxd !== 'boolean') ||
        (!text.trim() && rating === null)
      )
        return res.sendStatus(400);
      const tmdbId = Number(req.params.movieId);
      const scope = episodeReviewScope(req.query);
      let episodeName: string | null = null;
      if (scope) {
        const season = await new TheMovieDb().getTvSeason({
          tvId: tmdbId,
          seasonNumber: scope.seasonNumber,
        });
        const episode = season.episodes.find(
          (e) => e.episode_number === scope.episodeNumber
        );
        if (!episode) return res.sendStatus(400);
        episodeName = episode.name;
      }
      if (reviewType(req) === 'tv')
        await new TheMovieDb().getTvShow({ tvId: tmdbId });
      else await new TheMovieDb().getMovie({ movieId: tmdbId });
      return await withReviewLock(req.user!.id, async () => {
        const repo = getRepository(MovieReview),
          id = localId(req),
          old = await repo.findOneBy({ id }),
          now = new Date().toISOString();
        const account = await getRepository(LetterboxdAccount).findOneBy({
          userId: req.user!.id,
        });
        let watchedDate = old?.watchedDate ?? null,
          externalEntryId = old?.externalEntryId ?? null;
        let viewingEventId = old?.viewingEventId ?? null;
        if (req.body.viewingId !== undefined) {
          if (req.body.viewingId === null) {
            // Editing a published diary must not silently remove its date.
            if (
              old?.watchedDate &&
              (old.externalEntryId ||
                readSyncReceipts().some(
                  (r) => r.userId === req.user!.id && r.originId === id
                ))
            )
              throw Error('Cannot detach published viewing');
            watchedDate = null;
            externalEntryId = null;
            viewingEventId = null;
          } else if (req.body.viewingId === 'new-diary') {
            if (scope || reviewType(req) !== 'movie')
              throw Error('Diary entries require a movie');
            if (
              old?.watchedDate ||
              old?.externalEntryId ||
              readSyncReceipts().some(
                (r) => r.userId === req.user!.id && r.originId === id
              )
            )
              throw Error(
                'Use a new rating or review to create another viewing'
              );
            ({ watchedDate, viewingEventId } = manualDiaryViewing(id, now));
            externalEntryId = null;
          } else {
            const latest = await latestReviewViewing(
              req.user!.id,
              tmdbId,
              reviewType(req)
            );
            if (!latest || (latest.id !== req.body.viewingId && latest.sessionId !== req.body.viewingId) || scope)
              throw Error('Viewing changed');
            if (latest.source === 'catalogue')
              updateWriteState((state) => {
                const associated = state.intents.filter(
                  (i) =>
                    i.userId === req.user!.id && i.originEntityId === latest.id
                );
                if (
                  associated.some((i) =>
                    ['dispatched', 'unknown', 'conflict', 'verified'].includes(
                      i.state
                    )
                  )
                )
                  throw Error(
                    'Viewing publication already started; refresh before linking'
                  );
                for (const intent of associated)
                  if (intent.state === 'queued') intent.state = 'cancelled';
              });
            watchedDate = latest.date;
            externalEntryId = latest.entryId;
            viewingEventId = latest.source === 'catalogue' ? latest.id : null;
          }
        }
        const syncToLetterboxd = reviewPublishingPreference(
          req.body.syncToLetterboxd,
          old,
          reviewPublishingEnabled(
            req.user!.id,
            reviewType(req),
            account,
            readWriteState().settings[req.user!.id]
          )
        );
        // Supersede only not-yet-dispatched revisions on every edit.
        updateWriteState((state) =>
          cancelQueuedReviewWrites(
            state,
            req.user!.id,
            id,
            syncToLetterboxd &&
              !!watchedDate &&
              watchedDate === old?.watchedDate &&
              viewingEventId === old?.viewingEventId
          )
        );
        return res.json(
          await repo.save(
            repo.create({
              id,
              userId: req.user!.id,
              tmdbId,
              mediaType: reviewType(req),
              seasonNumber: scope?.seasonNumber ?? null,
              episodeNumber: scope?.episodeNumber ?? null,
              episodeName,
              source: 'local',
              rating,
              text: text.trim(),
              spoiler: req.body.spoiler,
              syncToLetterboxd,
              publishedAt: old?.publishedAt || now,
              updatedAt: now,
              externalUrl: null,
              watchedDate,
              externalEntryId,
              viewingEventId,
              entryKind: watchedDate || text.trim() ? 'diary' : 'summary',
            })
          )
        );
      });
    } catch {
      return res.status(400).json({ error: 'Could not save review' });
    }
  }
);
router.delete('/mine/:movieId', async (req, res) => {
  if (!positive(req.params.movieId)) return res.sendStatus(400);
  await withReviewLock(req.user!.id, async () => {
    const id = localId(req);
    await getRepository(MovieReview).delete({ id });
    updateWriteState((state) =>
      cancelQueuedReviewWrites(state, req.user!.id, id)
    );
  });
  return res.sendStatus(204);
});
router.get('/account/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!positive(userId)) return res.sendStatus(400);
  const account = await getRepository(LetterboxdAccount).findOneBy({ userId });
  const baseline =
    account && managesLetterboxd(req, userId)
      ? await getRepository(LetterboxdExportBaseline).findOneBy({
          userId,
          account: account.username,
        })
      : null;
  return res.json({
    hasCompletedImport:
      !!account?.importCompletedAt ||
      !!(baseline && JSON.parse(baseline.value).snapshot?.complete),
    fullyIntegrated:
      managesLetterboxd(req, userId) &&
      !!account &&
      readBrowserState().bindings.some(
        (b) =>
          b.userId === userId && b.username === account.username && b.enabled
      ) &&
      readWriteState().settings[userId]?.account === account.username &&
      !!readWriteState().settings[userId]?.enabled,
    account: account
      ? managesLetterboxd(req, userId)
        ? account
        : { username: account.username }
      : null,
  });
});
router.delete('/account/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!managesLetterboxd(req, userId)) return res.sendStatus(403);
  await withReviewLock(userId, async () => {
    disableLetterboxdBrowser(userId);
    updateWriteState((state) => {
      const setting = state.settings[userId];
      if (setting) setWriteEnabled(state, userId, setting.account, false);
    });
    await getRepository(MovieReview).manager.transaction(async (manager) => {
      await manager.delete(MovieReview, { userId, source: 'letterboxd' });
      await manager.delete(LetterboxdAccount, { userId });
      await manager.delete(LetterboxdExportBaseline, { userId });
    });
  });
  return res.sendStatus(204);
});
router.put('/account/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!managesLetterboxd(req, userId)) return res.sendStatus(403);
  if (
    !positive(userId) ||
    !(await getRepository(User).findOneBy({ id: userId })) ||
    typeof req.body.username !== 'string' ||
    !/^[a-z0-9_]{1,40}$/i.test(req.body.username) ||
    typeof req.body.enabled !== 'boolean'
  )
    return res.sendStatus(400);
  try {
    return await withReviewLock(userId, async () => {
      const repo = getRepository(LetterboxdAccount),
        username = req.body.username.toLowerCase(),
        old = await repo.findOneBy({ userId });
      if (old && old.username !== username)
        return res.status(409).json({
          error: 'Account reassignment requires clearing the old import first',
        });
      const account = await repo.save(
        repo.create({ ...old, userId, username, enabled: req.body.enabled })
      );
      return res.json({ account });
    });
  } catch {
    return res.status(409).json({ error: 'Account already linked' });
  }
});
router.post(
  '/account/:userId/sync',
  rateLimit({ windowMs: 60000, max: 2 }),
  async (req, res) => {
    const userId = Number(req.params.userId);
    if (!managesLetterboxd(req, userId)) return res.sendStatus(403);
    await syncReviews(userId);
    return res.json({
      account: await getRepository(LetterboxdAccount).findOneBy({ userId }),
    });
  }
);
router.post(
  '/import/:userId',
  rateLimit({ windowMs: 60000, max: 30 }),
  async (req, res) => {
    const userId = Number(req.params.userId);
    if (!managesLetterboxd(req, userId)) return res.sendStatus(403);
    try {
      return await withReviewLock(userId, async () => {
        const account = await getRepository(LetterboxdAccount).findOneBy({
          userId,
        });
        if (!account) return res.sendStatus(409);
        if (
          (typeof req.body.csv !== 'string' &&
            typeof req.body.zip !== 'string') ||
          (req.body.csv !== undefined && req.body.zip !== undefined) ||
          !['preview', 'commit'].includes(req.body.mode) ||
          (req.body.mode === 'commit' && req.body.confirmPublic !== true)
        )
          return res.sendStatus(400);
        const all =
            typeof req.body.zip === 'string'
              ? await archiveReviews(req.body.zip, account.username)
              : csvReviews(
                  req.body.csv,
                  account.username,
                  req.body.filename || 'auto'
                ),
          offset = Number(req.body.offset || 0);
        if (!Number.isInteger(offset) || offset < 0 || offset > all.length)
          return res.sendStatus(400);
        const entries = all.slice(offset, offset + 25);
        const results: (Omit<ImportedReview, 'tmdbId'> & {
          tmdbId: number | null;
        })[] = [];
        const resolved = await Promise.all(
          entries.map(async (entry) => {
            await expandReviewLink(entry, account.username);
            return resolveReview(entry);
          })
        );
        for (const [index, entry] of entries.entries()) {
          let tmdbId = resolved[index];
          const selected = req.body.matches?.[entry.key];
          if (selected !== undefined) {
            if (!positive(selected)) return res.sendStatus(400);
            tmdbId = Number(selected);
            const selectedType =
              req.body.mediaTypes?.[entry.key] || entry.mediaType || 'movie';
            if (!['movie', 'tv'].includes(selectedType))
              return res.sendStatus(400);
            entry.mediaType = selectedType;
            if (selectedType === 'tv')
              await new TheMovieDb().getTvShow({ tvId: tmdbId });
            else await new TheMovieDb().getMovie({ movieId: tmdbId });
          }
          results.push({ ...entry, tmdbId: tmdbId || null });
        }
        if (req.body.mode === 'commit') {
          await getRepository(MovieReview).manager.transaction(
            async (manager) => {
              for (const entry of results) {
                if (entry.tmdbId)
                  await saveImported(
                    userId,
                    { ...entry, tmdbId: entry.tmdbId },
                    entry.tmdbId,
                    false,
                    manager
                  );
              }
              if (offset + entries.length >= all.length) {
                await manager.update(
                  LetterboxdAccount,
                  { userId },
                  { importCompletedAt: new Date().toISOString() }
                );
              }
            }
          );
        }
        return res.json({
          results,
          total: all.length,
          counts: {
            watched: all.filter((e) => e.watched).length,
            ratings: all.filter((e) => e.rating !== null).length,
            reviews: all.filter((e) => e.text).length,
          },
          nextOffset:
            offset + entries.length < all.length
              ? offset + entries.length
              : null,
        });
      });
    } catch {
      return res.status(400).json({ error: 'Could not import CSV' });
    }
  }
);
export default router;
