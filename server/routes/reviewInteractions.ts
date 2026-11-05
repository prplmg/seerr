import { getRepository } from '@server/datasource';
import { MovieReview } from '@server/entity/MovieReview';
import {
  RecentReaction,
  ReviewComment,
  ReviewReaction,
} from '@server/entity/ReviewInteraction';
import { User } from '@server/entity/User';
import { Permission, hasPermission } from '@server/lib/permissions';
import {
  InteractionError,
  addComment,
  changeComment,
  interactionReviewId,
  interactionSummaries,
  setReaction,
} from '@server/lib/reviewInteractions';
import { notifyReviewAuthor } from '@server/lib/reviewSocialNotification';
import logger from '@server/logger';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import rateLimit from 'express-rate-limit';
import { In } from 'typeorm';
const router = Router();
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});
const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof InteractionError)
        res.status(error.status).json({ message: error.message });
      else {
        logger.error('Local review interaction failed', {
          label: 'Reviews',
          error: error instanceof Error ? error.message : String(error),
        });
        next(error);
      }
    }
  };
const manager = () => getRepository(ReviewComment).manager;
const isAdmin = (req: Request) =>
  hasPermission(Permission.ADMIN, req.user!.permissions);
async function requireReview(req: Request) {
  const id = interactionReviewId(req.params.reviewId);
  if (!(await getRepository(MovieReview).existsBy({ id })))
    throw new InteractionError(404, 'Review not found.');
  return id;
}
router.get(
  '/recent-emoji',
  handle(async (req, res) => {
    const rows = await getRepository(RecentReaction).find({
      where: { userId: req.user!.id },
      order: { lastUsed: 'DESC', emoji: 'ASC' },
      take: 6,
      select: { emoji: true },
    });
    res.json(rows.map((r) => r.emoji));
  })
);
router.get(
  '/summary',
  handle(async (req, res) => {
    const ids = String(req.query.ids || '')
      .split(',')
      .filter(Boolean);
    if (!ids.length || ids.length > 50)
      throw new InteractionError(400, 'Choose 1–50 reviews.');
    ids.forEach(interactionReviewId);
    const reviews = await getRepository(MovieReview).find({
      where: { id: In([...new Set(ids)]) },
      select: { id: true },
    });
    res.json(
      await interactionSummaries(
        manager(),
        reviews.map((r) => r.id),
        req.user!.id
      )
    );
  })
);
router.get(
  '/:reviewId/reactions',
  handle(async (req, res) => {
    const reviewId = await requireReview(req);
    const commentId = req.query.commentId;
    if (
      commentId &&
      (typeof commentId !== 'string' ||
        !(await getRepository(ReviewComment).existsBy({
          id: commentId,
          reviewId,
        })))
    )
      throw new InteractionError(404, 'Comment not found.');
    const rows = await getRepository(ReviewReaction).find({
      where: { reviewId: commentId ? '#' + commentId : reviewId },
      select: { emoji: true, userId: true },
      order: { emoji: 'ASC', userId: 'ASC' },
    });
    const users = rows.length
      ? await getRepository(User).find({
          where: { id: In([...new Set(rows.map((r) => r.userId))]) },
          loadEagerRelations: false,
          select: {
            id: true,
            username: true,
            plexUsername: true,
            jellyfinUsername: true,
          },
        })
      : [];
    const names = new Map(
      users.map((u) => [
        u.id,
        u.username || u.plexUsername || u.jellyfinUsername || null,
      ])
    );
    res.json(
      rows.map((r) => ({
        emoji: r.emoji,
        id: r.userId,
        name: names.get(r.userId) ?? null,
      }))
    );
  })
);
router.get(
  '/:reviewId/comments',
  handle(async (req, res) => {
    const reviewId = await requireReview(req),
      page = Number(req.query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
      throw new InteractionError(400, 'Invalid page.');
    const [rows, total] = await getRepository(ReviewComment).findAndCount({
      where: { reviewId },
      order: { createdAt: 'ASC', id: 'ASC' },
      skip: (page - 1) * 20,
      take: 20,
    });
    const users = rows.length
      ? await getRepository(User).findBy({
          id: In([...new Set(rows.map((r) => r.userId))]),
        })
      : [];
    const reactionCounts = await interactionSummaries(
      manager(),
      rows.map((row) => '#' + row.id),
      req.user!.id
    );
    res.json({
      results: rows.map((row) => {
        const user = users.find((u) => u.id === row.userId);
        return {
          ...row,
          reactions: reactionCounts['#' + row.id].reactions,
          user: user
            ? { id: user.id, name: user.displayName, avatar: user.avatar }
            : null,
          canEdit: row.userId === req.user!.id,
          canDelete: row.userId === req.user!.id || isAdmin(req),
        };
      }),
      total,
      page,
    });
  })
);
router.use(
  rateLimit({
    windowMs: 60000,
    max: 60,
    keyGenerator: (req) => String(req.user!.id),
  })
);
router.post(
  '/:reviewId/comments',
  handle(async (req, res) => {
    const id = await requireReview(req);
    const { comment, created } = await addComment(
      manager(),
      id,
      req.user!.id,
      req.body.id,
      req.body.text
    );
    if (created) void notifyReviewAuthor(id, req.user!);
    res.status(201).json({ comment });
  })
);
router.patch(
  '/:reviewId/comments/:id',
  handle(async (req, res) => {
    const id = await requireReview(req);
    await changeComment(
      manager(),
      id,
      String(req.params.id),
      req.user!.id,
      isAdmin(req),
      'edit',
      req.body.text,
      req.body.revision
    );
    res.sendStatus(204);
  })
);
router.delete(
  '/:reviewId/comments/:id',
  handle(async (req, res) => {
    const id = await requireReview(req);
    await changeComment(
      manager(),
      id,
      String(req.params.id),
      req.user!.id,
      isAdmin(req),
      'delete'
    );
    res.sendStatus(204);
  })
);
router.put(
  '/:reviewId/reactions',
  handle(async (req, res) => {
    const id = await requireReview(req);
    if (req.body.commentId) {
      await manager().transaction(async (tx) => {
        if (
          !(await tx
            .getRepository(ReviewComment)
            .existsBy({ id: req.body.commentId, reviewId: id }))
        )
          throw new InteractionError(404, 'Comment not found.');
        await setReaction(
          tx,
          '#' + req.body.commentId,
          req.user!.id,
          req.body.emoji,
          req.body.active
        );
      });
      res.sendStatus(204);
      return;
    }
    const created = await setReaction(
      manager(),
      id,
      req.user!.id,
      req.body.emoji,
      req.body.active
    );
    if (created) void notifyReviewAuthor(id, req.user!, req.body.emoji);
    res.json((await interactionSummaries(manager(), [id], req.user!.id))[id]);
  })
);
export default router;
