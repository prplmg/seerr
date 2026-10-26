import {
  LetterboxdExportAudit,
  LetterboxdExportBaseline,
} from '@server/entity/LetterboxdExport';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { DataSource } from 'typeorm';
import { commitExportToDatabase } from './letterboxdExportDatabase';
import type { ExportBaseline } from './letterboxdExportTransaction';
const input = (revision: string, capturedAt: number): ExportBaseline => ({
  revision,
  capturedAt,
  snapshot: {
    account: 'prplmg',
    complete: true,
    active: {
      'watched.csv': [],
      'ratings.csv': [],
      'diary.csv': [],
      'reviews.csv': [],
    },
  },
});
it('simultaneous cross-account SQLite exports serialize and a rollback does not poison later commits', async () => {
  const db = await new DataSource({
    type: 'sqlite',
    database: ':memory:',
    entities: [LetterboxdExportBaseline, LetterboxdExportAudit],
    synchronize: true,
  }).initialize();
  let active = 0,
    peak = 0;
  try {
    await db.query('CREATE TABLE export_concurrent_value (userId INTEGER)');
    const results = await Promise.allSettled(
      [1, 2, 3, 4, 5].map((userId) =>
        commitExportToDatabase(
          db,
          userId,
          input('revision-' + userId, 1),
          null,
          async (manager) => {
            active++;
            peak = Math.max(peak, active);
            try {
              await manager.query(
                'INSERT INTO export_concurrent_value VALUES (?)',
                [userId]
              );
              await new Promise((resolve) => setTimeout(resolve, 10));
              if (userId === 2) throw Error('intentional failure');
            } finally {
              active--;
            }
          }
        )
      )
    );
    assert.equal(peak, 1);
    assert.deepEqual(
      results.map((r) => r.status),
      ['fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled']
    );
    assert.deepEqual(
      (
        await db.query(
          'SELECT userId FROM export_concurrent_value ORDER BY userId'
        )
      ).map((r: { userId: number }) => r.userId),
      [1, 3, 4, 5]
    );
    assert.equal(await db.getRepository(LetterboxdExportBaseline).count(), 4);
    assert.equal(await db.getRepository(LetterboxdExportAudit).count(), 4);
    await commitExportToDatabase(
      db,
      2,
      input('retry-2', 2),
      null,
      async (manager) => {
        await manager.query('INSERT INTO export_concurrent_value VALUES (2)');
      }
    );
    assert.equal(await db.getRepository(LetterboxdExportBaseline).count(), 5);
    assert.equal(await db.getRepository(LetterboxdExportAudit).count(), 5);
  } finally {
    await db.destroy();
  }
});
it('SQLite rolls back data changes with a failed export and commits audit with successful data', async () => {
  const db = await new DataSource({
    type: 'sqlite',
    database: ':memory:',
    entities: [LetterboxdExportBaseline, LetterboxdExportAudit],
    synchronize: true,
  }).initialize();
  try {
    await db.query('CREATE TABLE export_test_value (value INTEGER)');
    await db.query('INSERT INTO export_test_value VALUES (1)');
    await assert.rejects(
      commitExportToDatabase(db, 1, input('a', 1), null, async (manager) => {
        await manager.query('UPDATE export_test_value SET value=2');
        throw Error('test interruption');
      })
    );
    assert.equal(
      (await db.query('SELECT value FROM export_test_value'))[0].value,
      1
    );
    assert.equal(await db.getRepository(LetterboxdExportBaseline).count(), 0);
    assert.equal(await db.getRepository(LetterboxdExportAudit).count(), 0);
    await commitExportToDatabase(
      db,
      1,
      input('a', 1),
      null,
      async (manager) => {
        await manager.query('UPDATE export_test_value SET value=2');
      }
    );
    assert.equal(
      (await db.query('SELECT value FROM export_test_value'))[0].value,
      2
    );
    assert.equal(await db.getRepository(LetterboxdExportAudit).count(), 1);
    await commitExportToDatabase(db, 1, input('a', 1), null, async () => {
      throw Error('replay must not apply');
    });
    assert.equal(await db.getRepository(LetterboxdExportAudit).count(), 1);
  } finally {
    await db.destroy();
  }
});
