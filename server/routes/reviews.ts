import TheMovieDb from '@server/api/themoviedb';
import { getRepository } from '@server/datasource';
import { LetterboxdAccount, MovieReview } from '@server/entity/MovieReview';
import { User } from '@server/entity/User';
import {
  csvReviews,
  ratingValue,
  type ImportedReview,
} from '@server/lib/letterboxdImport';
import { Permission, hasPermission } from '@server/lib/permissions';
import {
  expandReviewLink,
  resolveReview,
  saveImported,
  syncReviews,
  withReviewLock,
} from '@server/lib/reviews';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { In } from 'typeorm';

const router = Router();
const positive = (v: unknown) =>
  Number.isSafeInteger(Number(v)) && Number(v) > 0;
const admin = (req: Express.Request) =>
  hasPermission(req.user!.permissions, Permission.ADMIN);
router.use((_req, res, next) => {
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
    if (movie) q.where('review.tmdbId = :movie', { movie: Number(movie) });
    else
      q.where('review.publishedAt >= :since', {
        since: new Date(Date.now() - days * 86400000).toISOString(),
      }).andWhere("review.text <> ''");
    const [rows, total] = await q
      .orderBy('review.publishedAt', 'DESC')
      .addOrderBy('review.id', 'ASC')
      .skip((page - 1) * 20)
      .take(20)
      .getManyAndCount();
    const users = rows.length
      ? await getRepository(User).findBy({
          id: In([...new Set(rows.map((r) => r.userId))]),
        })
      : [];
    return res.json({
      results: rows.map((r) => ({
        ...r,
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
router.get('/mine/:movieId', async (req, res) => {
  if (!positive(req.params.movieId)) return res.sendStatus(400);
  return res.json({
    review: await getRepository(MovieReview).findOneBy({
      id: `local:${req.user!.id}:${req.params.movieId}`,
    }),
  });
});
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
        (!text.trim() && rating === null)
      )
        return res.sendStatus(400);
      const tmdbId = Number(req.params.movieId);
      await new TheMovieDb().getMovie({ movieId: tmdbId });
      const repo = getRepository(MovieReview),
        id = `local:${req.user!.id}:${tmdbId}`,
        old = await repo.findOneBy({ id }),
        now = new Date().toISOString();
      return res.json(
        await repo.save(
          repo.create({
            id,
            userId: req.user!.id,
            tmdbId,
            source: 'local',
            rating,
            text: text.trim(),
            spoiler: req.body.spoiler,
            publishedAt: old?.publishedAt || now,
            updatedAt: now,
            externalUrl: null,
            watchedDate: null,
          })
        )
      );
    } catch {
      return res.status(400).json({ error: 'Could not save review' });
    }
  }
);
router.delete('/mine/:movieId', async (req, res) => {
  if (!positive(req.params.movieId)) return res.sendStatus(400);
  await getRepository(MovieReview).delete({
    id: `local:${req.user!.id}:${req.params.movieId}`,
  });
  return res.sendStatus(204);
});
router.get('/account/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!positive(userId)) return res.sendStatus(400);
  const account = await getRepository(LetterboxdAccount).findOneBy({ userId });
  return res.json({
    account: account
      ? admin(req)
        ? account
        : { username: account.username }
      : null,
  });
});
router.delete('/account/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!positive(userId) || !admin(req)) return res.sendStatus(403);
  await withReviewLock(userId, async () => {
    await getRepository(MovieReview).manager.transaction(async (manager) => {
      await manager.delete(MovieReview, { userId, source: 'letterboxd' });
      await manager.delete(LetterboxdAccount, { userId });
    });
  });
  return res.sendStatus(204);
});
router.put('/account/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!admin(req)) return res.sendStatus(403);
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
    if (!positive(userId) || !admin(req)) return res.sendStatus(403);
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
    if (!positive(userId) || !admin(req)) return res.sendStatus(403);
    try {
      return await withReviewLock(userId, async () => {
        const account = await getRepository(LetterboxdAccount).findOneBy({
          userId,
        });
        if (!account) return res.sendStatus(409);
        if (
          typeof req.body.csv !== 'string' ||
          !['preview', 'commit'].includes(req.body.mode) ||
          (req.body.mode === 'commit' && req.body.confirmPublic !== true)
        )
          return res.sendStatus(400);
        const all = csvReviews(req.body.csv, account.username),
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
            await new TheMovieDb().getMovie({ movieId: tmdbId });
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
            }
          );
        }
        return res.json({
          results,
          total: all.length,
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
