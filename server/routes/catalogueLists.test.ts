import * as lists from '@server/lib/catalogueLists';
import type { ListStore } from '@server/lib/discoveryLists';
import express from 'express';
import * as validator from 'express-openapi-validator';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { it } from 'node:test';
import request from 'supertest';
import ts from 'typescript';
const runtimeRequire = createRequire(__filename);
it('actual sharing API validates access, owner-only grants, editor saves and revocation', async () => {
  const store: ListStore = {
    version: 1,
    lists: [],
    saved: {},
    liked: {},
    availability: {},
  };
  const body = {
    title: 'Private',
    description: 'Test',
    movieIds: [1],
    visibility: 'private',
  };
  const list = lists.saveCatalogueList(store, 1, 'Owner', body);
  const loaded = { exports: {} as { default: express.Router } };
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, 'catalogueLists.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }
  ).outputText;
  new Function('require', 'exports', source)((name: string) => {
    if (name === '@server/lib/catalogueLists') return lists;
    if (name === '@server/lib/discoveryLists')
      return {
        readListStore: () => store,
        updateListStore: <T>(fn: (s: ListStore) => T) => fn(store),
      };
    if (name === '@server/datasource')
      return {
        getRepository: () => ({
          find: async () =>
            [1, 2, 3].map((id) => ({ id, displayName: `User ${id}` })),
        }),
      };
    if (name === '@server/entity/User') return { User: class {} };
    if (name === '@server/api/themoviedb')
      return class {
        async getListMovie(id: number) {
          return { id, title: 'Movie', release_date: '2000-01-01' };
        }
      };
    if (name === '@server/interfaces/api/catalogueLists')
      return runtimeRequire('../interfaces/api/catalogueLists');
    return runtimeRequire(name);
  }, loaded.exports);
  const app = express();
  app.use(express.json());
  app.use(
    validator.middleware({
      apiSpec: path.resolve('seerr-api.yml'),
      validateRequests: true,
      validateSecurity: false,
    })
  );
  app.use((req, _res, next) => {
    req.user = {
      id: Number(req.header('test-user')),
      displayName: 'Editor',
    } as typeof req.user;
    next();
  });
  app.use('/api/v1/discovery-lists/created', loaded.exports.default);
  app.use(
    (
      e: { status?: number; message: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      void _next;
      res.status(e.status || 500).json({ message: e.message });
    }
  );
  const url = `/api/v1/discovery-lists/created/${list.id}`;
  assert.equal(
    (
      await request(app)
        .get(url + '/sharing')
        .set('test-user', '2')
    ).status,
    404
  );
  const sharing = await request(app)
    .get(url + '/sharing')
    .set('test-user', '1');
  assert.equal(sharing.status, 200);
  assert.equal(sharing.body.users.length, 2);
  const grant = (collaborators: unknown, revision = list.checkedAt) =>
    request(app)
      .put(url + '/sharing')
      .set('test-user', '1')
      .send({ revision, collaborators });
  assert.equal((await grant({ 99: 'editor' })).status, 400);
  assert.equal((await grant({ 2: 'owner' })).status, 400);
  assert.equal((await grant({ 2: 'editor', 3: 'viewer' })).status, 200);
  assert.equal(
    (await request(app).get(url).set('test-user', '2')).body.owned,
    false
  );
  assert.equal((await request(app).get(url).set('test-user', '3')).status, 404);
  assert.equal(
    (
      await request(app)
        .put(url)
        .set('test-user', '2')
        .send({ ...body, revision: list.checkedAt, title: 'Changed' })
    ).status,
    200
  );
  const edited = store.lists[0];
  assert.equal(edited.creator, 'Owner');
  assert.equal(edited.ownerId, 1);
  assert.equal(
    (
      await request(app)
        .put(url + '/sharing')
        .set('test-user', '2')
        .send({ revision: edited.checkedAt, collaborators: {} })
    ).status,
    404
  );
  assert.equal(
    (
      await request(app)
        .delete(url)
        .set('test-user', '2')
        .send({ revision: edited.checkedAt })
    ).status,
    404
  );
  const revision = edited.checkedAt;
  assert.equal((await grant({}, revision)).status, 200);
  assert.equal(
    (
      await request(app)
        .put(url)
        .set('test-user', '2')
        .send({ ...body, revision })
    ).status,
    404
  );
});
