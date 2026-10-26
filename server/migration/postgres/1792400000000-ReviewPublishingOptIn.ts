import {
  TableColumn,
  type MigrationInterface,
  type QueryRunner,
} from 'typeorm';
export class ReviewPublishingOptIn1792400000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.addColumn(
      'movie_review',
      new TableColumn({
        name: 'syncToLetterboxd',
        type: 'boolean',
        isNullable: false,
        default: false,
      })
    );
  }
  async down(q: QueryRunner) {
    await q.dropColumn('movie_review', 'syncToLetterboxd');
  }
}
