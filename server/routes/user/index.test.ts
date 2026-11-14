import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, describe, it } from 'node:test';

import PlexTvAPI from '@server/api/plextv';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
import authRoutes from '@server/routes/auth';
import { setupTestDb } from '@server/test/db';
import {
  assertNoCredentials,
  seedUserSettings,
} from '@server/test/userSettings';
import { permissionsOf, seedManagerAndAdmin } from '@server/test/users';
import * as appDataVolume from '@server/utils/appDataVolume';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import userRoutes from '.';

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(checkUser);
  app.use('/auth', authRoutes);
  app.use('/user', isAuthenticated(), userRoutes);
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
  return app;
}

before(async () => {
  app = createApp();
});

setupTestDb();

async function loginAs(email: string, password: string) {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent.post('/auth/local').send({ email, password });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

describe('GET /user/:id/watchlist', () => {
  it('omits user and notification settings from every Plex watchlist item', async (t) => {
    const owner = await seedUserSettings('demo@seerr.dev');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'user-watchlist-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    t.mock.method(appDataVolume, 'appDataPath', () => directory);
    fs.writeFileSync(
      path.join(directory, 'account-mappings.json'),
      JSON.stringify({
        version: 1,
        users: [
          {
            userId: owner.id,
            avatarPlexId: null,
            playbackPlexId: null,
            watchlistPlexId: null,
          },
        ],
      })
    );
    // Exercise the real token resolver and response projection; stub only Plex.
    const plex = t.mock.method(
      PlexTvAPI.prototype,
      'getWatchlist',
      async () => ({
        offset: 0,
        size: 20,
        totalSize: 1,
        items: [
          {
            type: 'movie' as const,
            tmdbId: 12345,
            title: 'Watchlisted Movie',
            ratingKey: 'rk-12345',
            requestedBy: owner,
            settings: owner.settings,
          },
        ],
      })
    );

    const admin = await loginAs('admin@seerr.dev', 'test1234');
    const res = await admin.get(`/user/${owner.id}/watchlist`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results.length, 1);
    assert.deepEqual(res.body.results[0], {
      id: 12345,
      ratingKey: 'rk-12345',
      title: 'Watchlisted Movie',
      mediaType: 'movie',
      tmdbId: 12345,
    });
    assert.strictEqual(plex.mock.callCount(), 1);
    assert.deepEqual(plex.mock.calls[0].arguments, [
      { offset: 0, size: 20, strict: true },
    ]);
    assert.ok(!('requestedBy' in res.body.results[0]));
    assert.ok(!('settings' in res.body.results[0]));
    assertNoCredentials(res.body);
  });
});

describe('GET /user/:id', () => {
  it('still returns full settings to the user themselves', async () => {
    const owner = await seedUserSettings('demo@seerr.dev');

    const agent = await loginAs('demo@seerr.dev', 'test1234');
    const res = await agent.get(`/user/${owner.id}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.settings.pgpKey, 'test-pgp-key');
    assert.strictEqual(
      res.body.settings.pushoverUserKey,
      'test-pushover-user-key'
    );
  });

  it('still returns full settings to a manage-users admin', async () => {
    const owner = await seedUserSettings('demo@seerr.dev');

    const admin = await loginAs('admin@seerr.dev', 'test1234');
    const res = await admin.get(`/user/${owner.id}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.settings.pgpKey, 'test-pgp-key');
  });

  it('strips settings for an unrelated user', async () => {
    const admin = await getRepository(User).findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    await seedUserSettings('admin@seerr.dev');

    const agent = await loginAs('demo@seerr.dev', 'test1234');
    const res = await agent.get(`/user/${admin.id}`);

    assert.strictEqual(res.status, 200);
    assert.ok(!('settings' in res.body));
    assertNoCredentials(res.body);
  });
});

describe('PUT /user/:id', () => {
  it('stops a manager from removing admin from another admin', async () => {
    const { otherAdmin } = await seedManagerAndAdmin();
    const manager = await loginAs('demo@seerr.dev', 'test1234');

    const res = await manager
      .put(`/user/${otherAdmin.id}`)
      .send({ username: 'admin2', permissions: Permission.REQUEST });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(await permissionsOf(otherAdmin.id), Permission.ADMIN);
  });

  it('stops a manager from changing their own permissions', async () => {
    const { manager } = await seedManagerAndAdmin();
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.put(`/user/${manager.id}`).send({
      username: 'demo',
      permissions: Permission.MANAGE_USERS | Permission.MANAGE_SETTINGS,
    });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(
      await permissionsOf(manager.id),
      Permission.MANAGE_USERS
    );
  });

  it('lets a manager rename themselves', async () => {
    const { manager } = await seedManagerAndAdmin();
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent
      .put(`/user/${manager.id}`)
      .send({ username: 'renamed', permissions: Permission.MANAGE_USERS });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.username, 'renamed');
  });

  it('lets the owner remove admin from another admin', async () => {
    const { otherAdmin } = await seedManagerAndAdmin();
    const owner = await loginAs('admin@seerr.dev', 'test1234');

    const res = await owner
      .put(`/user/${otherAdmin.id}`)
      .send({ username: 'admin2', permissions: Permission.REQUEST });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(await permissionsOf(otherAdmin.id), Permission.REQUEST);
  });
});

describe('PUT /user', () => {
  it("skips admins and the caller in a manager's bulk edit", async () => {
    const { manager, otherAdmin } = await seedManagerAndAdmin();
    const regular = await getRepository(User).save(
      new User({
        email: 'regular@seerr.dev',
        permissions: Permission.REQUEST,
        avatar: '',
      })
    );
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.put('/user').send({
      ids: [otherAdmin.id, manager.id, regular.id].map(String),
      permissions: Permission.VOTE,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(await permissionsOf(otherAdmin.id), Permission.ADMIN);
    assert.strictEqual(
      await permissionsOf(manager.id),
      Permission.MANAGE_USERS
    );
    assert.strictEqual(await permissionsOf(regular.id), Permission.VOTE);
  });

  it('lets the owner bulk edit admins', async () => {
    const { otherAdmin } = await seedManagerAndAdmin();
    const owner = await loginAs('admin@seerr.dev', 'test1234');

    const res = await owner
      .put('/user')
      .send({ ids: [String(otherAdmin.id)], permissions: Permission.REQUEST });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(await permissionsOf(otherAdmin.id), Permission.REQUEST);
  });
});

describe('DELETE /user/:id', () => {
  it('stops a manager from demoting an admin to delete them', async () => {
    const { otherAdmin } = await seedManagerAndAdmin();
    const manager = await loginAs('demo@seerr.dev', 'test1234');

    const demote = await manager
      .post(`/user/${otherAdmin.id}/settings/permissions`)
      .send({ permissions: Permission.REQUEST });
    const remove = await manager.delete(`/user/${otherAdmin.id}`);

    assert.strictEqual(demote.status, 403);
    assert.strictEqual(remove.status, 405);
    assert.ok(
      await getRepository(User).exists({ where: { id: otherAdmin.id } })
    );
  });

  it('lets the owner demote an admin and delete them', async () => {
    const { otherAdmin } = await seedManagerAndAdmin();
    const owner = await loginAs('admin@seerr.dev', 'test1234');

    const demote = await owner
      .post(`/user/${otherAdmin.id}/settings/permissions`)
      .send({ permissions: Permission.REQUEST });
    const remove = await owner.delete(`/user/${otherAdmin.id}`);

    assert.strictEqual(demote.status, 200);
    assert.strictEqual(remove.status, 200);
    assert.ok(
      !(await getRepository(User).exists({ where: { id: otherAdmin.id } }))
    );
  });
});
