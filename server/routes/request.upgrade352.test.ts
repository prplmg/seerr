import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';

import TheMovieDb from '@server/api/themoviedb';
import type { TmdbTvDetails } from '@server/api/themoviedb/interfaces';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import SeasonRequest from '@server/entity/SeasonRequest';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { MediaRequestSubscriber } from '@server/subscriber/MediaRequestSubscriber';
import { setupTestDb } from '@server/test/db';
import express from 'express';
import request from 'supertest';
import requestRoutes from './request';

// Exercise real routes, permissions, persistence and subscribers. Only external
// metadata, notifications and Sonarr delivery are replaced.
Object.defineProperty(TheMovieDb.prototype, 'getTvShow', {
  get() {
    return async ({ tvId }: { tvId: number }) =>
      ({
        id: tvId,
        genres: [],
        original_language: 'en',
        keywords: { results: [] },
        external_ids: {},
      }) as unknown as TmdbTvDetails;
  },
  set() {},
  configurable: true,
});
mock.method(MediaRequest, 'sendNotification', async () => undefined);
mock.method(
  MediaRequestSubscriber.prototype,
  'sendToSonarr',
  async () => undefined
);

setupTestDb();

beforeEach(() => {
  getSettings().sonarr = [];
  getSettings().radarr = [];
});

async function actor(permissions: Permission) {
  const repo = getRepository(User);
  const user = await repo.findOneOrFail({
    where: {
      email:
        permissions === Permission.ADMIN ? 'admin@seerr.dev' : 'demo@seerr.dev',
    },
  });
  user.permissions = permissions;
  user.tvQuotaLimit = 0;
  await repo.save(user);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Authentication is outside this regression's scope; authorization uses the
    // real persisted User and the route's actual permission checks.
    req.user = user;
    next();
  });
  app.use('/request', requestRoutes);
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // Express identifies error middleware by its four-argument signature.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res.status(err.status ?? 500).json({ message: err.message });
    }
  );
  return { user, api: request(app) };
}

async function seed(
  user: User,
  options: {
    status?: MediaRequestStatus;
    held?: boolean;
    seasons?: number[];
  } = {}
) {
  const media = await getRepository(Media).save(
    new Media({
      mediaType: MediaType.TV,
      tmdbId: 352990,
      status: MediaStatus.PENDING,
      status4k: MediaStatus.UNKNOWN,
    })
  );
  return getRepository(MediaRequest).save(
    new MediaRequest({
      type: MediaType.TV,
      status: options.status ?? MediaRequestStatus.PENDING,
      media,
      requestedBy: user,
      is4k: false,
      requiresSeasonApproval: options.held ?? false,
      seasons: (options.seasons ?? [1]).map(
        (seasonNumber) =>
          new SeasonRequest({
            seasonNumber,
            status: MediaRequestStatus.PENDING,
          })
      ),
    })
  );
}

const reload = (id: number) =>
  getRepository(MediaRequest).findOneOrFail({ where: { id } });
const seasonNumbers = (value: MediaRequest) =>
  value.seasons.map((s) => s.seasonNumber).sort((a, b) => a - b);

describe('v3.5.2 custom season approval and pending-only security', () => {
  for (const status of [
    MediaRequestStatus.APPROVED,
    MediaRequestStatus.DECLINED,
    MediaRequestStatus.FAILED,
    MediaRequestStatus.COMPLETED,
  ]) {
    for (const permission of [Permission.REQUEST, Permission.ADMIN]) {
      it(`rejects TV edits in status ${status} with permission ${permission}, without changing seasons or flags`, async () => {
        const { user, api } = await actor(permission);
        const original = await seed(user, { status, held: true });
        const res = await api.put(`/request/${original.id}`).send({
          mediaType: 'tv',
          seasons: [1, 2, 3],
          skipInitialSearch: true,
        });
        assert.equal(res.status, 409);
        assert.match(res.body.message, /Only pending requests/);
        const saved = await reload(original.id);
        assert.equal(saved.status, status);
        assert.deepEqual(seasonNumbers(saved), [1]);
        assert.equal(saved.requiresSeasonApproval, true);
        assert.equal(saved.skipInitialSearch, false);
      });
    }
  }

  it('creates additional seasons with POST as a separate request while leaving the approved request intact', async () => {
    const { user, api } = await actor(Permission.REQUEST);
    const original = await seed(user, { status: MediaRequestStatus.APPROVED });
    const res = await api
      .post('/request')
      .send({ mediaType: 'tv', mediaId: original.media.tmdbId, seasons: [2] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.notEqual(res.body.id, original.id);
    const additional = await reload(res.body.id);
    assert.equal(additional.media.id, original.media.id);
    assert.deepEqual(seasonNumbers(additional), [2]);
    const saved = await reload(original.id);
    assert.equal(saved.status, MediaRequestStatus.APPROVED);
    assert.deepEqual(seasonNumbers(saved), [1]);
    assert.equal(await getRepository(MediaRequest).count(), 2);
  });

  it('holds a pending edit crossing two seasons and notifies once', async (t) => {
    const { user, api } = await actor(Permission.REQUEST);
    const original = await seed(user);
    const notify = t.mock.method(
      MediaRequest.prototype,
      'notifyNewRequest',
      async () => undefined
    );
    assert.equal(
      (await api.put(`/request/${original.id}`).send({ seasons: [1, 2, 3] }))
        .status,
      200
    );
    const saved = await reload(original.id);
    assert.equal(saved.requiresSeasonApproval, true);
    assert.equal(saved.status, MediaRequestStatus.PENDING);
    assert.deepEqual(seasonNumbers(saved), [1, 2, 3]);
    assert.equal(notify.mock.callCount(), 1);
  });

  it('blocks adding seasons by either PUT or POST while approval is held, but permits removal without clearing the hold', async () => {
    const { user, api } = await actor(Permission.REQUEST);
    const original = await seed(user, { held: true, seasons: [1, 2, 3] });
    assert.equal(
      (await api.put(`/request/${original.id}`).send({ seasons: [1, 2, 3, 4] }))
        .status,
      403
    );
    assert.equal(
      (
        await api.post('/request').send({
          mediaType: 'tv',
          mediaId: original.media.tmdbId,
          seasons: [4],
        })
      ).status,
      403
    );
    assert.equal(await getRepository(MediaRequest).count(), 1);
    assert.deepEqual(seasonNumbers(await reload(original.id)), [1, 2, 3]);
    assert.equal(
      (await api.put(`/request/${original.id}`).send({ seasons: [1] })).status,
      200
    );
    const saved = await reload(original.id);
    assert.deepEqual(seasonNumbers(saved), [1]);
    assert.equal(saved.requiresSeasonApproval, true);
  });

  it('allows admin pending edits above two seasons without imposing a hold', async () => {
    const { user, api } = await actor(Permission.ADMIN);
    const original = await seed(user);
    assert.equal(
      (await api.put(`/request/${original.id}`).send({ seasons: [1, 2, 3] }))
        .status,
      200
    );
    assert.equal((await reload(original.id)).requiresSeasonApproval, false);
  });

  for (const action of ['approve', 'retry']) {
    it(`prevents a request manager bypassing the admin-only season hold through ${action}`, async () => {
      const { user, api } = await actor(Permission.MANAGE_REQUESTS);
      const status =
        action === 'retry'
          ? MediaRequestStatus.FAILED
          : MediaRequestStatus.PENDING;
      const original = await seed(user, { status, held: true });
      assert.equal(
        (await api.post(`/request/${original.id}/${action}`)).status,
        403
      );
      assert.equal((await reload(original.id)).status, status);
    });
  }

  for (const skipInitialSearch of [true, false]) {
    it(`persists admin approval skipInitialSearch=${skipInitialSearch}`, async () => {
      const { user, api } = await actor(Permission.ADMIN);
      const original = await seed(user, { held: true });
      await getRepository(MediaRequest).update(original.id, {
        skipInitialSearch: !skipInitialSearch,
      });
      assert.equal(
        (
          await api
            .post(`/request/${original.id}/approve`)
            .send({ skipInitialSearch })
        ).status,
        200
      );
      const saved = await reload(original.id);
      assert.equal(saved.skipInitialSearch, skipInitialSearch);
      assert.equal(saved.status, MediaRequestStatus.APPROVED);
    });
  }

  for (const permissions of [Permission.MANAGE_REQUESTS, Permission.ADMIN]) {
    it(`rejects unauthorized or malformed search flags for permission ${permissions} without approving`, async () => {
      const { user, api } = await actor(permissions);
      const original = await seed(user);
      const isAdmin = permissions === Permission.ADMIN;
      const res = await api
        .post(`/request/${original.id}/approve`)
        .send({ skipInitialSearch: isAdmin ? 'true' : true });
      assert.equal(res.status, isAdmin ? 400 : 403);
      const saved = await reload(original.id);
      assert.equal(saved.status, MediaRequestStatus.PENDING);
      assert.equal(saved.skipInitialSearch, false);
    });
  }
});
