import {
  TableColumn,
  type MigrationInterface,
  type QueryRunner,
} from 'typeorm';
export class ReviewEntryIdentity1792300000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.addColumn(
      'movie_review',
      new TableColumn({
        name: 'externalEntryId',
        type: 'varchar',
        isNullable: true,
      })
    );
  }
  async down(q: QueryRunner) {
    await q.dropColumn('movie_review', 'externalEntryId');
  }
}
