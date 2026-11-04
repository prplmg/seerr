import {
  ReviewComment,
  ReviewReaction,
} from '@server/entity/ReviewInteraction';
import { ReviewInteractions1793800000000 } from '@server/migration/sqlite/1793800000000-ReviewInteractions';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { DataSource } from 'typeorm';
import {
  addComment,
  canonicalReaction,
  changeComment,
  commentText,
  interactionSummaries,
  setReaction,
} from './reviewInteractions';

it('local interactions migrate, enforce authorship, survive retry, paginate and do not publish', async () => {
  const db = new DataSource({
    type: 'sqlite',
    database: ':memory:',
    entities: [ReviewComment, ReviewReaction],
  });
  await db.initialize();
  const migration = new ReviewInteractions1793800000000(),
    q = db.createQueryRunner();
  try {
    await migration.up(q);
    const id = randomUUID(),
      review = 'local:1:123',
      m = db.manager;
    const { comment: first, created } = await addComment(
      m,
      review,
      1,
      id,
      ' A comment '
    );
    assert.equal(created, true);
    assert.equal(
      (await addComment(m, review, 1, id, ' A comment ')).created,
      false
    );
    assert.equal(await m.count(ReviewComment), 1);
    await assert.rejects(addComment(m, review, 2, id, 'A comment'), {
      status: 409,
    });
    await assert.rejects(addComment(m, 'other', 1, id, 'A comment'), {
      status: 409,
    });
    await assert.rejects(
      changeComment(
        m,
        review,
        id,
        2,
        false,
        'edit',
        'changed',
        first.updatedAt
      ),
      { status: 403 }
    );
    await assert.rejects(
      changeComment(m, review, id, 2, true, 'edit', 'changed', first.updatedAt),
      { status: 403 }
    );
    await changeComment(
      m,
      review,
      id,
      1,
      false,
      'edit',
      'Updated',
      first.updatedAt
    );
    await assert.rejects(
      changeComment(m, review, id, 1, false, 'edit', 'stale', first.updatedAt),
      { status: 409 }
    );
    assert.equal(
      (await m.findOneByOrFail(ReviewComment, { id })).text,
      'Updated'
    );
    assert.equal(await setReaction(m, review, 1, '❤', true), true);
    assert.equal(await setReaction(m, review, 1, '❤️', true), false);
    await setReaction(m, review, 2, '❤️', true);
    await setReaction(m, review, 1, '👩🏽‍🚀', true);
    const summary = await interactionSummaries(m, [review, 'empty'], 1);
    assert.equal(summary[review].comments, 1);
    assert.deepEqual(
      summary[review].reactions.find((x) => x.emoji === '❤️'),
      { emoji: '❤️', count: 2, mine: true }
    );
    assert.deepEqual(summary.empty, { comments: 0, reactions: [] });
    await setReaction(m, review, 1, '❤️', false);
    await setReaction(m, review, 1, '❤️', false);
    assert.deepEqual(
      (await interactionSummaries(m, [review], 1))[review].reactions.find(
        (x) => x.emoji === '❤️'
      ),
      { emoji: '❤️', count: 1, mine: false }
    );
    await assert.rejects(changeComment(m, review, id, 2, false, 'delete'), {
      status: 403,
    });
    await changeComment(m, review, id, 2, true, 'delete');
    assert.equal(await m.count(ReviewComment), 0);
    for (let i = 0; i < 25; i++)
      await addComment(m, review, 1, randomUUID(), `Comment ${i}`);
    const [page, total] = await m.findAndCount(ReviewComment, {
      where: { reviewId: review },
      order: { createdAt: 'ASC', id: 'ASC' },
      skip: 20,
      take: 20,
    });
    assert.equal(total, 25);
    assert.equal(page.length, 5);
    assert.equal(await q.hasTable('letterboxd_write_queue'), false);
    await migration.down(q);
    assert.equal(await q.hasTable('review_comment'), false);
    await migration.up(q);
  } finally {
    await q.release();
    await db.destroy();
  }
});
it('allows complete Unicode emoji including tones/flags/families but rejects arbitrary text', () => {
  for (const value of ['👍🏿', '👨‍👩‍👧‍👦', '🇲🇽', '🏳️‍🌈', '🫩'])
    assert.equal(canonicalReaction(value), value);
  for (const bad of ['', 'hello', '😀😀', '<script>', '1'])
    assert.throws(() => canonicalReaction(bad));
  assert.throws(() => commentText(' '));
  assert.throws(() => commentText('x'.repeat(4001)));
  assert.equal(
    commentText('<script>plain text</script>'),
    '<script>plain text</script>'
  );
});
