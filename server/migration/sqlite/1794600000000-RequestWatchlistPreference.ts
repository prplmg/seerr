import {
  TableColumn,
  type MigrationInterface,
  type QueryRunner,
} from 'typeorm';
export class RequestWatchlistPreference1794600000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.addColumn(
      'user_settings',
      new TableColumn({
        name: 'requestAddToWatchlist',
        type: 'boolean',
        default: false,
      })
    );
    // Initial opt-in requested for ykrn only. Subsequent choices are never reseeded.
    await q.query(
      `UPDATE "user_settings" SET "requestAddToWatchlist" = true WHERE "userId" IN (SELECT "id" FROM "user" WHERE lower("username") = 'ykrn' OR lower("plexUsername") = 'ykrn')`
    );
  }
  async down(q: QueryRunner) {
    await q.dropColumn('user_settings', 'requestAddToWatchlist');
  }
}
