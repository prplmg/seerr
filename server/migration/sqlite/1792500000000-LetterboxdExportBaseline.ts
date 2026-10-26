import { Table, type MigrationInterface, type QueryRunner } from 'typeorm';

export class LetterboxdExportBaseline1792500000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.createTable(new Table({ name: 'letterboxd_export_baseline', columns: [
      { name: 'userId', type: 'integer', isPrimary: true },
      { name: 'account', type: 'varchar' },
      { name: 'value', type: 'text' },
    ] }));
    await q.createTable(new Table({ name: 'letterboxd_export_audit', columns: [
      { name: 'id', type: 'varchar', isPrimary: true },
      { name: 'userId', type: 'integer' },
      { name: 'account', type: 'varchar' },
      { name: 'revision', type: 'varchar' },
      { name: 'capturedAt', type: 'varchar' },
      { name: 'changes', type: 'integer' },
    ] }));
  }
  async down(q: QueryRunner) {
    await q.dropTable('letterboxd_export_audit');
    await q.dropTable('letterboxd_export_baseline');
  }
}
