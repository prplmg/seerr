import Media from '@server/entity/Media';
import * as library from '@server/lib/libraryBrowse';
import { isAuthenticated } from '@server/middleware/auth';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';
import router from './libraryBrowse';
test('library API validates the actual contract and requires authentication without an AI key', async (t) => {
  const old = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.after(() => {
    if (old === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = old;
  });
  const calls = t.mock.method(library, 'startLibraryBrowse', async () => ({
    id: 'fixture',
    ready: false,
    message: 'Checking title details…',
  }));
  const mediaLookup = t.mock.method(
    Media,
    'getRelatedMedia',
    async () =>
      [
        { tmdbId: 7, mediaType: 'movie', status: 5 },
        { tmdbId: 7, mediaType: 'tv', status: 4 },
      ] as Media[]
  );
  const readyResult = {
    id: 'fixture',
    ready: true,
    message: 'Ready',
    results: [
      { media: { id: 7, mediaType: 'movie' }, runtime: 90 },
      { media: { id: 7, mediaType: 'tv' }, runtime: 45 },
    ],
    total: 2,
    next: null,
    unknown: 0,
  };
  t.mock.method(
    library,
    'refreshLibraryJob',
    async () => readyResult as ReturnType<typeof library.libraryJob>
  );

  const app = express();
  app.use(express.json());
  app.use(
    OpenApiValidator.middleware({
      apiSpec: path.resolve('seerr-api.yml'),
      validateRequests: true,
      validateSecurity: false,
    })
  );
  app.use((req, _res, next) => {
    if (req.header('test-user'))
      req.user = {
        id: 1,
        hasPermission: () => true,
      } as unknown as typeof req.user;
    next();
  });
  app.use('/api/v1/find-to-watch', isAuthenticated(), router);
  app.use(
    (
      e: { status?: number; message: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      void _next;
      res.status(e.status ?? 500).json({ message: e.message });
    }
  );
  const body = {
    filters: {
      type: 'movie',
      available: true,
      unwatched: true,
      maxRuntime: null,
      yearFrom: null,
      yearTo: null,
      genres: [],
    },
    people: [],
    sort: [],
    page: 0,
  };
  assert.equal(
    (await request(app).post('/api/v1/find-to-watch').send(body)).status,
    403
  );
  assert.equal(
    (
      await request(app)
        .post('/api/v1/find-to-watch')
        .set('test-user', '1')
        .send(body)
    ).status,
    200
  );
  for (const invalid of [
    { ...body, page: -1 },
    { ...body, sort: [{ field: 'fake', direction: 'asc' }] },
    { ...body, people: [1, 2, 3, 4, 5, 6] },
  ])
    assert.equal(
      (
        await request(app)
          .post('/api/v1/find-to-watch')
          .set('test-user', '1')
          .send(invalid)
      ).status,
      400
    );
  assert.equal(calls.mock.callCount(), 1);
  assert.equal(
    mediaLookup.mock.callCount(),
    0,
    'progress does not query media'
  );
  assert.equal(
    (
      await request(app)
        .get('/api/v1/find-to-watch/fixture')
        .set('test-user', '1')
    ).status,
    200
  );
  const result = await request(app)
    .get('/api/v1/find-to-watch/fixture')
    .set('test-user', '1');
  assert.deepEqual(
    result.body.results.map(
      (r: { media: { mediaInfo: { status: number } } }) =>
        r.media.mediaInfo.status
    ),
    [5, 4]
  );
  assert.equal(mediaLookup.mock.calls[0].arguments[0]?.id, 1);
  assert.equal(
    'mediaInfo' in readyResult.results[0].media,
    false,
    'cached rows are not mutated'
  );
  calls.mock.mockImplementation(
    async () =>
      readyResult as Awaited<ReturnType<typeof library.startLibraryBrowse>>
  );
  const cached = await request(app)
    .post('/api/v1/find-to-watch')
    .set('test-user', '1')
    .send(body);
  assert.equal(
    cached.body.results[0].media.mediaInfo.status,
    5,
    'cached POST also includes status'
  );
});
