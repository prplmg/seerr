import { SocialPushDefault1793870000000 } from '@server/migration/sqlite/1793870000000-SocialPushDefault';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { DataSource } from 'typeorm';

it('adds social push to existing enabled masks and preserves email, disabled push and other choices', async () => {
  const db = await new DataSource({
    type: 'sqlite',
    database: ':memory:',
  }).initialize();
  try {
    const q = db.createQueryRunner();
    await q.query(
      'CREATE TABLE user_settings (id INTEGER PRIMARY KEY, notificationTypes TEXT)'
    );
    for (const [i, types] of [
      { webpush: 8, email: 8190 },
      { webpush: 0, email: 0 },
      { email: 8 },
    ].entries())
      await q.query('INSERT INTO user_settings VALUES (?,?)', [
        i,
        JSON.stringify(types),
      ]);
    const migration = new SocialPushDefault1793870000000();
    await migration.up(q);
    const read = async () =>
      (
        await q.query('SELECT notificationTypes FROM user_settings ORDER BY id')
      ).map((r: { notificationTypes: string }) =>
        JSON.parse(r.notificationTypes)
      );
    assert.deepEqual(await read(), [
      { webpush: 8200, email: 8190 },
      { webpush: 0, email: 0 },
      { email: 8 },
    ]);
    await migration.down(q);
    assert.equal((await read())[0].webpush, 8);
  } finally {
    await db.destroy();
  }
});
