import assert from 'node:assert/strict';
import { it } from 'node:test';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { LetterboxdImportCompleted1793100000000 } from '../migration/sqlite/1793100000000-LetterboxdImportCompleted';

it('adds and reverses the import marker without losing linked accounts', async () => {
  const db = await new DataSource({
    type: 'sqlite',
    database: ':memory:',
  }).initialize();
  const q = db.createQueryRunner();
  try {
    await q.query(
      'CREATE TABLE letterboxd_account (userId integer PRIMARY KEY, username varchar NOT NULL)'
    );
    await q.query("INSERT INTO letterboxd_account VALUES (14, 'zelzingb')");
    const migration = new LetterboxdImportCompleted1793100000000();
    await migration.up(q);
    const [account] = await q.query('SELECT * FROM letterboxd_account');
    assert.equal(account.username, 'zelzingb');
    assert.equal(account.importCompletedAt, null);
    await q.query('UPDATE letterboxd_account SET importCompletedAt = ?', [
      '2026-10-27T00:00:00.000Z',
    ]);
    await migration.down(q);
    assert.deepEqual(await q.query('SELECT * FROM letterboxd_account'), [
      { userId: 14, username: 'zelzingb' },
    ]);
  } finally {
    await q.release();
    await db.destroy();
  }
});
