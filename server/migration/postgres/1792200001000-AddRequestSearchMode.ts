import {
  TableColumn,
  type MigrationInterface,
  type QueryRunner,
} from 'typeorm';
export class AddRequestSearchMode1792200001000 implements MigrationInterface {
  async up(q: QueryRunner) {
    for (const name of ['skipInitialSearch', 'requiresSeasonApproval']) {
      await q.addColumn(
        'media_request',
        new TableColumn({ name, type: 'boolean', default: false })
      );
    }
  }
  async down(q: QueryRunner) {
    await q.dropColumn('media_request', 'requiresSeasonApproval');
    await q.dropColumn('media_request', 'skipInitialSearch');
  }
}
