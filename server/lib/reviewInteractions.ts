import {
  ReviewComment,
  ReviewReaction,
} from '@server/entity/ReviewInteraction';
import { createHash } from 'crypto';
import type { EntityManager } from 'typeorm';
import emojiData from './data/emoji-picker.json';
const emojiMap = new Map(
  emojiData.map((e) => [e.emoji.replace(/\uFE0F/g, ''), e.emoji])
);
export class InteractionError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
export function canonicalReaction(value: unknown) {
  const emoji =
    typeof value === 'string' && value.length <= 64
      ? emojiMap.get(value.replace(/\uFE0F/g, ''))
      : undefined;
  if (!emoji) throw new InteractionError(400, 'Choose one emoji.');
  return emoji;
}
export function commentText(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4000)
    throw new InteractionError(400, 'Write a comment of 1–4,000 characters.');
  return value.trim();
}
export function interactionReviewId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9:_-]{1,180}$/i.test(value))
    throw new InteractionError(400, 'Invalid review.');
  return value;
}
export async function addComment(
  manager: EntityManager,
  reviewId: string,
  userId: number,
  id: unknown,
  text: unknown
) {
  if (
    typeof id !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      id
    )
  )
    throw new InteractionError(400, 'Invalid comment identifier.');
  const body = commentText(text),
    now = new Date().toISOString(),
    repo = manager.getRepository(ReviewComment);
  await repo
    .createQueryBuilder()
    .insert()
    .values({
      id,
      reviewId,
      userId,
      text: body,
      createdAt: now,
      updatedAt: now,
    })
    .orIgnore()
    .execute();
  const comment = await repo.findOneByOrFail({ id });
  if (
    comment.userId !== userId ||
    comment.reviewId !== reviewId ||
    comment.text !== body
  )
    throw new InteractionError(
      409,
      'This comment was already submitted. Refresh before trying again.'
    );
  return comment;
}
export async function changeComment(
  manager: EntityManager,
  reviewId: string,
  id: string,
  userId: number,
  admin: boolean,
  action: 'edit' | 'delete',
  text?: unknown,
  revision?: unknown
) {
  const repo = manager.getRepository(ReviewComment),
    comment = await repo.findOneBy({ id, reviewId });
  if (!comment) throw new InteractionError(404, 'Comment not found.');
  if (comment.userId !== userId && !(admin && action === 'delete'))
    throw new InteractionError(403, 'You cannot change this comment.');
  if (action === 'delete') {
    await repo.delete({ id, reviewId });
    return;
  }
  if (typeof revision !== 'string' || revision !== comment.updatedAt)
    throw new InteractionError(
      409,
      'This comment changed. Refresh before editing.'
    );
  const updatedAt = new Date(
    Math.max(Date.now(), Date.parse(comment.updatedAt) + 1)
  ).toISOString();
  const result = await repo.update(
    { id, reviewId, userId, updatedAt: revision },
    { text: commentText(text), updatedAt }
  );
  if (!result.affected)
    throw new InteractionError(
      409,
      'This comment changed. Refresh before editing.'
    );
}
export async function setReaction(
  manager: EntityManager,
  reviewId: string,
  userId: number,
  value: unknown,
  active: unknown
) {
  if (typeof active !== 'boolean')
    throw new InteractionError(400, 'Invalid reaction state.');
  const emoji = canonicalReaction(value),
    repo = manager.getRepository(ReviewReaction);
  const id = createHash('sha256')
    .update(JSON.stringify([reviewId, userId, emoji]))
    .digest('hex');
  if (active)
    await repo
      .createQueryBuilder()
      .insert()
      .values({ id, reviewId, userId, emoji })
      .orIgnore()
      .execute();
  else await repo.delete({ id, reviewId, userId });
}
export async function interactionSummaries(
  manager: EntityManager,
  ids: string[],
  userId: number
) {
  const result: Record<
    string,
    {
      comments: number;
      reactions: { emoji: string; count: number; mine: boolean }[];
    }
  > = Object.fromEntries(ids.map((id) => [id, { comments: 0, reactions: [] }]));
  if (!ids.length) return result;
  const comments = await manager
    .getRepository(ReviewComment)
    .createQueryBuilder('c')
    .select('c.reviewId', 'reviewId')
    .addSelect('COUNT(*)', 'count')
    .where('c.reviewId IN (:...ids)', { ids })
    .groupBy('c.reviewId')
    .getRawMany();
  const reactions = await manager
    .getRepository(ReviewReaction)
    .createQueryBuilder('r')
    .select('r.reviewId', 'reviewId')
    .addSelect('r.emoji', 'emoji')
    .addSelect('COUNT(*)', 'count')
    .addSelect('MAX(CASE WHEN r.userId = :userId THEN 1 ELSE 0 END)', 'mine')
    .where('r.reviewId IN (:...ids)', { ids, userId })
    .groupBy('r.reviewId')
    .addGroupBy('r.emoji')
    .orderBy('r.emoji', 'ASC')
    .getRawMany();
  for (const row of comments) result[row.reviewId].comments = Number(row.count);
  for (const row of reactions)
    result[row.reviewId].reactions.push({
      emoji: row.emoji,
      count: Number(row.count),
      mine: !!Number(row.mine),
    });
  return result;
}
