import { expandReviews } from '@server/lib/expandedReviewMigration';
import type { MigrationInterface, QueryRunner } from 'typeorm';
export class ExpandReviews1792200002000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await expandReviews(q);
  }
  async down(q: QueryRunner) {
    for (const column of ['entryKind', 'watched', 'mediaType'])
      await q.dropColumn('movie_review', column);
  }
}
