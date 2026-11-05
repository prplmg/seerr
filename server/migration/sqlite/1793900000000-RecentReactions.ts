import {
  Table,
  TableIndex,
  type MigrationInterface,
  type QueryRunner,
} from 'typeorm';
export class RecentReactions1793900000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.createTable(
      new Table({
        name: 'recent_reaction',
        columns: [
          { name: 'userId', type: 'integer', isPrimary: true },
          { name: 'emoji', type: 'varchar', isPrimary: true },
          { name: 'lastUsed', type: 'varchar' },
        ],
      })
    );
    await q.createIndex(
      'recent_reaction',
      new TableIndex({
        name: 'IDX_recent_reaction_user_time',
        columnNames: ['userId', 'lastUsed'],
      })
    );
  }
  async down(q: QueryRunner) {
    await q.dropTable('recent_reaction');
  }
}
