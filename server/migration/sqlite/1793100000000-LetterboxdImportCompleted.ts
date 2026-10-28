import {
  TableColumn,
  type MigrationInterface,
  type QueryRunner,
} from 'typeorm';
export class LetterboxdImportCompleted1793100000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.addColumn(
      'letterboxd_account',
      new TableColumn({
        name: 'importCompletedAt',
        type: 'varchar',
        isNullable: true,
      })
    );
  }
  async down(q: QueryRunner) {
    await q.dropColumn('letterboxd_account', 'importCompletedAt');
  }
}
