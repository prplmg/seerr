import { createReviewTables } from '@server/lib/reviewMigration';
import { AddRequestSearchMode1792200001000 } from '@server/migration/sqlite/1792200001000-AddRequestSearchMode';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import 'reflect-metadata';
import { DataSource } from 'typeorm';

it('creates review tables with unique identities, cascading users and a reversible migration', async () => {
  const db = new DataSource({ type: 'sqlite', database: ':memory:' });
  await db.initialize();
  const q = db.createQueryRunner();
  try {
    await q.query('CREATE TABLE "user" ("id" integer PRIMARY KEY)');
    await q.query('INSERT INTO "user" VALUES (1)');
    await q.query(
      'CREATE TABLE media_request (id integer PRIMARY KEY, status integer)'
    );
    await q.query('INSERT INTO media_request VALUES (1, 2)');
    const requestMigration = new AddRequestSearchMode1792200001000();
    await requestMigration.up(q);
    const [existing] = await q.query('SELECT * FROM media_request');
    assert.equal(existing.status, 2);
    assert.equal(existing.skipInitialSearch, 0);
    assert.equal(existing.requiresSeasonApproval, 0);
    await requestMigration.down(q);
    assert.deepEqual(await q.query('SELECT * FROM media_request'), [
      { id: 1, status: 2 },
    ]);
    await createReviewTables(q);
    await q.query(
      `INSERT INTO movie_review (id,userId,tmdbId,source,rating,text,spoiler,publishedAt,updatedAt) VALUES ('local:1:578',1,578,'local',4.5,'Test',0,'2026-10-01','2026-10-01')`
    );
    await assert.rejects(
      q.query(
        `INSERT INTO movie_review (id,userId,tmdbId,source,publishedAt,updatedAt) VALUES ('local:1:578',1,578,'local','2026-10-01','2026-10-01')`
      )
    );
    await q.query('DELETE FROM "user" WHERE id=1');
    assert.equal((await q.query('SELECT * FROM movie_review')).length, 0);
    await q.dropTable('movie_review');
    await q.dropTable('letterboxd_account');
    assert.equal(await q.hasTable('movie_review'), false);
  } finally {
    await q.release();
    await db.destroy();
  }
});
