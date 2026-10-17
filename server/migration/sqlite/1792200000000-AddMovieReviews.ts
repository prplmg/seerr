import { createReviewTables } from '@server/lib/reviewMigration';
import type { MigrationInterface, QueryRunner } from 'typeorm';
export class AddMovieReviews1792200000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await createReviewTables(q);
  }
  async down(q: QueryRunner) {
    await q.dropTable('movie_review');
    await q.dropTable('letterboxd_account');
  }
}
