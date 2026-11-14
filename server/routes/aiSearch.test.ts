import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { after, before, test } from 'node:test';
import path from 'path';
import request from 'supertest';
let router: express.Router;
const previousConfig = process.env.CONFIG_DIRECTORY;
const testConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-search-route-'));
before(async () => {
  // Set this before application imports capture the persistent data directory.
  process.env.CONFIG_DIRECTORY = testConfig;
  router = (await import('./aiSearch')).default;
});
after(() => {
  if (previousConfig === undefined) delete process.env.CONFIG_DIRECTORY;
  else process.env.CONFIG_DIRECTORY = previousConfig;
  fs.rmSync(testConfig, { recursive: true, force: true });
});

test('AI search contract accepts valid requests and rejects malformed bodies before provider work', async (t) => {
  const old = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.after(() => {
    if (old === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = old;
  });
  const app = express();
  app.use(express.json());
  app.use(
    OpenApiValidator.middleware({
      apiSpec: path.resolve('seerr-api.yml'),
      validateRequests: true,
      validateSecurity: false,
    })
  );
  app.use(
    '/api/v1/ai-search',
    (req, _res, next) => {
      req.user = { id: 999 } as unknown as typeof req.user;
      next();
    },
    router
  );
  app.use(
    (
      error: { status?: number; message: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      void _next;
      res.status(error.status || 500).json({ message: error.message });
    }
  );
  const valid = await request(app)
    .post('/api/v1/ai-search')
    .send({ query: 'A quiet science fiction movie' });
  assert.equal(valid.status, 503, JSON.stringify(valid.body));
  assert.match(valid.body.message, /not configured/);
  for (const body of [
    {},
    { query: 5 },
    { query: 'x'.repeat(1001) },
    { query: 'test', apiKey: 'must-not-accept-client-keys' },
    { query: '   ' },
  ]) {
    const response = await request(app).post('/api/v1/ai-search').send(body);
    assert.equal(response.status, 400, JSON.stringify(response.body));
  }
});

test('resolved results enforce availability, watched state, runtime and blocklist', async (t) => {
  const sortMetadata = await import('@server/lib/listSort');
  t.mock.method(
    sortMetadata,
    'collectListRuntimes',
    async () =>
      new Map([
        ['movie:1', 90],
        ['movie:2', 110],
        ['movie:3', 120],
      ])
  );
  const axios = (await import('axios')).default;
  const Media = (await import('@server/entity/Media')).default;
  const TheMovieDb = (await import('@server/api/themoviedb')).default;
  const discovery = await import('@server/lib/discoveryData');
  const { isAuthenticated } = await import('@server/middleware/auth');
  const { MediaStatus } = await import('@server/constants/media');
  const old = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'mock-only';
  t.after(() => {
    if (old === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = old;
  });
  const model = t.mock.method(axios, 'post', async () => ({
    data: {
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                filters: {
                  type: 'movie',
                  available: true,
                  unwatched: true,
                  maxRuntime: 100,
                  yearFrom: null,
                  yearTo: null,
                  genres: [],
                },
                suggestions: [],
                note: '',
              }),
            },
          ],
        },
      ],
    },
  }));
  t.mock.method(
    discovery,
    'discoveryData',
    async () =>
      ({
        historyAvailable: true,
        available: new Set(['movie:1', 'movie:2', 'movie:3', 'movie:4']),
        users: [
          { id: 98703, name: 'Self' },
          { id: 98704, name: 'ykrn' },
        ],
        ratings: [],
        watched: [
          { userId: 98703, type: 'movie', tmdbId: 2 },
          { userId: 98704, type: 'movie', tmdbId: 1 },
        ],
        visibilityStillValid: () => true,
      }) as unknown as Awaited<ReturnType<typeof discovery.discoveryData>>
  );
  t.mock.method(
    Media,
    'getRelatedMedia',
    async () =>
      [
        { tmdbId: 4, mediaType: 'movie', status: MediaStatus.BLOCKLISTED },
      ] as InstanceType<typeof Media>[]
  );
  const upstream = t.mock.method(
    TheMovieDb.prototype as unknown as {
      get: (url: string) => Promise<unknown>;
    },
    'get',
    async (url: string) => {
      if (url === '/discover/movie')
        return {
          results: [1, 2, 3, 4, 5].map((id) => ({
            id,
            title: `Film ${id}`,
            release_date: '2015-01-01',
            genre_ids: [],
          })),
        };
      if (url === '/movie/1') return { id: 1, runtime: 90 };
      if (url === '/movie/3') return { id: 3, runtime: 120 };
      throw Error(`Unexpected read ${url}`);
    }
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
        id: 98703,
        hasPermission: () => true,
      } as unknown as typeof req.user;
    next();
  });
  app.use('/api/v1/ai-search', isAuthenticated(), router);
  app.use(
    (
      error: { status?: number; message: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      void _next;
      res.status(error.status || 500).json({ message: error.message });
    }
  );
  assert.equal(
    (await request(app).post('/api/v1/ai-search').send({ query: 'test' }))
      .status,
    403
  );
  const result = await request(app)
    .post('/api/v1/ai-search')
    .set('test-user', '1')
    .send({ query: 'test constraints' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(
    result.body.results.map((r: { media: { id: number } }) => r.media.id),
    [1]
  );
  assert.equal(
    upstream.mock.callCount(),
    3,
    'skip runtime fetch for unavailable, watched and blocked films'
  );
  const hidden = await request(app)
    .post('/api/v1/ai-search')
    .set('test-user', '1')
    .send({ query: 'test constraints', people: [123] });
  assert.equal(hidden.status, 400);
  const grouped = await request(app)
    .post('/api/v1/ai-search')
    .set('test-user', '1')
    .send({ query: 'test constraints', people: [98704] });
  assert.equal(grouped.status, 200, JSON.stringify(grouped.body));
  assert.deepEqual(grouped.body.results, []);
  assert.equal(
    grouped.body.cached,
    true,
    'Changing people reuses interpretation; history stays local'
  );
  assert.equal(result.body.results[0].runtime, 90);
  const visible = await request(app)
    .get('/api/v1/ai-search/people')
    .set('test-user', '1');
  assert.equal(visible.status, 200);
  assert.deepEqual(
    visible.body.users.map((u: { id: number }) => u.id),
    [98703, 98704]
  );
  const history = await request(app)
    .get('/api/v1/ai-search/history')
    .set('test-user', '1');
  assert.equal(history.status, 200);
  assert.equal(history.body.searches.length, 1);
  assert.deepEqual(history.body.searches[0].people, [98704]);
  assert.equal(history.body.searches[0].query, 'test constraints');
  assert.equal(
    (await request(app).get('/api/v1/ai-search/history')).status,
    403
  );
  const calls = model.mock.callCount();
  const edits = { ...result.body.filters, maxRuntime: null, unwatched: false };
  const edited = await request(app)
    .post('/api/v1/ai-search')
    .set('test-user', '1')
    .send({ query: 'test constraints', filters: edits, stream: true });
  assert.match(edited.headers['content-type'], /application\/x-ndjson/);
  const events = edited.text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(events[0].kind, 'progress');
  assert.ok(events.some((event) => event.message === 'Finding movies…'));
  assert.ok(!events.some((event) => event.message === 'Checking runtimes…'));
  const payload = events.at(-1).data;
  assert.deepEqual(
    payload.results.map((r: { media: { id: number } }) => r.media.id),
    [1, 2, 3]
  );
  assert.equal(payload.cached, true);
  assert.equal(model.mock.callCount(), calls, 'filter edits never call AI');
  const changedHistory = await request(app)
    .get('/api/v1/ai-search/history')
    .set('test-user', '1');
  assert.deepEqual(changedHistory.body.searches, history.body.searches);
  assert.deepEqual(
    changedHistory.body.searches[0].filters,
    grouped.body.filters
  );
  const sorted = await request(app)
    .post('/api/v1/ai-search')
    .set('test-user', '1')
    .send({
      query: 'test constraints',
      filters: edits,
      sort: [{ field: 'runtime', direction: 'desc' }],
    });
  assert.equal(sorted.status, 200, JSON.stringify(sorted.body));
  assert.deepEqual(
    sorted.body.results.map((r: { media: { id: number } }) => r.media.id),
    [3, 2, 1]
  );
  assert.equal(model.mock.callCount(), calls, 'sort changes never call AI');
  const invalidSort = await request(app)
    .post('/api/v1/ai-search')
    .set('test-user', '1')
    .send({
      query: 'test constraints',
      filters: edits,
      sort: [{ field: 'nope', direction: 'asc' }],
    });
  assert.equal(invalidSort.status, 400);
  const expired = await request(app)
    .post('/api/v1/ai-search')
    .set('test-user', '1')
    .send({ query: 'not cached', filters: edits, stream: true });
  assert.equal(
    JSON.parse(expired.text.trim().split('\n').at(-1)!).kind,
    'error'
  );
  assert.equal(
    model.mock.callCount(),
    calls,
    'expired chip edits must not silently spend tokens'
  );
  const invalid = await request(app)
    .post('/api/v1/ai-search')
    .set('test-user', '1')
    .send({ query: 'test constraints', filters: { ...edits, maxRuntime: -1 } });
  assert.equal(invalid.status, 400);
  const ratings = await import('@server/lib/listSort');
  let lookedUp: number[] = [];
  t.mock.method(
    ratings,
    'collectListRatings',
    async (
      films: { tmdbId: number }[],
      notify?: (completed: number, total: number) => void
    ) => {
      lookedUp = films.map((film) => film.tmdbId);
      notify?.(films.length, films.length);
      return new Map([
        ['movie:1', 4.2],
        ['movie:2', 3.9],
        ['movie:3', null],
      ]);
    }
  );
  const lb = await request(app)
    .post('/api/v1/ai-search')
    .set('test-user', '1')
    .send({
      query: 'test constraints',
      filters: { ...edits, minLetterboxdRating: 4 },
      stream: true,
    });
  const lbEvents = lb.text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const lbResult = lbEvents.at(-1).data;
  assert.deepEqual(
    lookedUp,
    [1, 2, 3],
    'blocked/unavailable titles must never request a score'
  );
  assert.deepEqual(
    lbResult.results.map((r: { media: { id: number } }) => r.media.id),
    [1]
  );
  assert.equal(lbResult.results[0].letterboxdRating, 4.2);
  assert.deepEqual(lbResult.ratingCoverage, { checked: 2, unknown: 1 });
  assert.ok(
    lbEvents.some(
      (event) => event.message === 'Checking Letterboxd ratings… 3/3'
    )
  );
  assert.equal(model.mock.callCount(), calls);
  for (const [bounds, expected] of [
    [{ maxLetterboxdRating: 4 }, [2]],
    [{ minLetterboxdRating: 3.9, maxLetterboxdRating: 4.2 }, [1, 2]],
    [{ minLetterboxdRating: 4.2, maxLetterboxdRating: 4.2 }, [1]],
    [{ maxLetterboxdRating: 0 }, []],
  ] as const) {
    const bounded = await request(app)
      .post('/api/v1/ai-search')
      .set('test-user', '1')
      .send({ query: 'test constraints', filters: { ...edits, ...bounds } });
    assert.equal(bounded.status, 200);
    assert.deepEqual(
      bounded.body.results.map(
        (row: { media: { id: number } }) => row.media.id
      ),
      expected
    );
    assert.equal(bounded.body.ratingCoverage.unknown, 1);
  }
  const reversed = await request(app)
    .post('/api/v1/ai-search')
    .set('test-user', '1')
    .send({
      query: 'test constraints',
      filters: { ...edits, minLetterboxdRating: 4.5, maxLetterboxdRating: 3.5 },
    });
  assert.equal(reversed.status, 400);
  assert.equal(
    model.mock.callCount(),
    calls,
    'all bound edits must reuse the interpretation'
  );
  const namedQuery = 'horror, unwatched by ykrn and I';
  const named = await request(app)
    .post('/api/v1/ai-search')
    .set('test-user', '1')
    .send({ query: namedQuery });
  assert.equal(named.status, 200, JSON.stringify(named.body));
  assert.deepEqual(named.body.results, []);
  const countAfterNamed = model.mock.callCount();
  const removed = await request(app)
    .post('/api/v1/ai-search')
    .set('test-user', '1')
    .send({ query: namedQuery, people: [], filters: named.body.filters });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.deepEqual(
    removed.body.people.map((p: { id: number }) => p.id),
    [98703]
  );
  assert.deepEqual(
    removed.body.results.map((r: { media: { id: number } }) => r.media.id),
    [1]
  );
  assert.equal(
    model.mock.callCount(),
    countAfterNamed,
    'removing a named person reuses the cached plan'
  );
});
