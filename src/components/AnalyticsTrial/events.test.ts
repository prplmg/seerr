import { strict as assert } from 'assert';
import { test } from 'node:test';
import { safeSettings } from './events';
test('settings retain ordinary values and recursively strip credentials', () => {
  assert.deepEqual(
    safeSettings({
      enabled: true,
      name: 'Plex',
      password: 'no',
      nested: { apiKey: 'no', port: 32400 },
      accounts: [{ accessToken: 'no', username: 'user' }],
    }),
    {
      enabled: true,
      name: 'Plex',
      nested: { port: 32400 },
      accounts: [{ username: 'user' }],
    }
  );
});
