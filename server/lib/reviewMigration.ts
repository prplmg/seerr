import { Table, TableForeignKey, TableIndex, type QueryRunner } from 'typeorm';
export async function createReviewTables(q: QueryRunner) {
  await q.createTable(
    new Table({
      name: 'movie_review',
      columns: [
        { name: 'id', type: 'varchar', isPrimary: true },
        { name: 'userId', type: 'integer' },
        { name: 'tmdbId', type: 'integer' },
        { name: 'source', type: 'varchar' },
        { name: 'rating', type: 'float', isNullable: true },
        { name: 'text', type: 'text', default: "''" },
        { name: 'spoiler', type: 'boolean', default: false },
        { name: 'publishedAt', type: 'varchar' },
        { name: 'updatedAt', type: 'varchar' },
        { name: 'externalUrl', type: 'varchar', isNullable: true },
        { name: 'watchedDate', type: 'varchar', isNullable: true },
      ],
    })
  );
  await q.createTable(
    new Table({
      name: 'letterboxd_account',
      columns: [
        { name: 'userId', type: 'integer', isPrimary: true },
        { name: 'username', type: 'varchar', isUnique: true },
        { name: 'enabled', type: 'boolean', default: true },
        ...['lastSync', 'lastAttempt', 'error'].map((name) => ({
          name,
          type: 'varchar',
          isNullable: true,
        })),
      ],
    })
  );
  for (const table of ['movie_review', 'letterboxd_account'])
    await q.createForeignKey(
      table,
      new TableForeignKey({
        columnNames: ['userId'],
        referencedTableName: 'user',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      })
    );
  for (const name of ['userId', 'tmdbId', 'publishedAt'])
    await q.createIndex(
      'movie_review',
      new TableIndex({ name: `IDX_review_${name}`, columnNames: [name] })
    );
}
