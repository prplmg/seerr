import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SocialPushDefault1793870000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await this.update(q, true);
  }
  async down(q: QueryRunner) {
    await this.update(q, false);
  }
  private async update(q: QueryRunner, enable: boolean) {
    const rows: { id: number; notificationTypes: string | null }[] =
      await q.query('SELECT id, "notificationTypes" FROM user_settings');
    for (const row of rows) {
      const types = row.notificationTypes && JSON.parse(row.notificationTypes);
      if (!types || typeof types !== 'object') continue;
      if (enable && types.webpush > 0) types.webpush |= 8192;
      if (!enable) {
        for (const key of ['email', 'webpush'])
          if (typeof types[key] === 'number') types[key] &= ~8192;
      }
      const args =
        q.connection.options.type === 'postgres' ? ['$1', '$2'] : ['?', '?'];
      await q.query(
        `UPDATE user_settings SET "notificationTypes"=${args[0]} WHERE id=${args[1]}`,
        [JSON.stringify(types), row.id]
      );
    }
  }
}
