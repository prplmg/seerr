import {
  Table,
  TableIndex,
  type MigrationInterface,
  type QueryRunner,
} from 'typeorm';
export class ReviewInteractions1793800000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.createTable(
      new Table({
        name: 'review_comment',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'reviewId', type: 'varchar' },
          { name: 'userId', type: 'integer' },
          { name: 'text', type: 'text' },
          { name: 'createdAt', type: 'varchar' },
          { name: 'updatedAt', type: 'varchar' },
        ],
      })
    );
    await q.createIndex(
      'review_comment',
      new TableIndex({
        name: 'IDX_review_comment_page',
        columnNames: ['reviewId', 'createdAt', 'id'],
      })
    );
    await q.createTable(
      new Table({
        name: 'review_reaction',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'reviewId', type: 'varchar' },
          { name: 'userId', type: 'integer' },
          { name: 'emoji', type: 'varchar' },
        ],
      })
    );
    await q.createIndex(
      'review_reaction',
      new TableIndex({
        name: 'IDX_review_reaction_unique',
        columnNames: ['reviewId', 'userId', 'emoji'],
        isUnique: true,
      })
    );
  }
  async down(q: QueryRunner) {
    await q.dropTable('review_reaction');
    await q.dropTable('review_comment');
  }
}
