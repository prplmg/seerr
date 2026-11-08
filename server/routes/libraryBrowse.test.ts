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
  t.mock.method(library, 'libraryJob', () => ({
    id: 'fixture',
    ready: true,
    message: 'Ready',
    results: [],
    total: 0,
    next: null,
    unknown: 0,
  }));
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
    (
      await request(app)
        .get('/api/v1/find-to-watch/fixture')
        .set('test-user', '1')
    ).status,
    200
  );
});
