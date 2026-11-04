/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ReviewComment,
  ReviewReaction,
} from '@server/entity/ReviewInteraction';
import { Permission } from '@server/lib/permissions';
import { ReviewInteractions1793800000000 } from '@server/migration/sqlite/1793800000000-ReviewInteractions';
import express from 'express';
import { middleware } from 'express-openapi-validator';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { it } from 'node:test';
import request from 'supertest';
import { DataSource } from 'typeorm';
import ts from 'typescript';
const runtimeRequire = createRequire(__filename);
it('actual interaction API contract authenticates, scopes writes, validates emoji and returns private batched counts', async () => {
  const db = new DataSource({
    type: 'sqlite',
    database: ':memory:',
    entities: [ReviewComment, ReviewReaction],
  });
  await db.initialize();
  await new ReviewInteractions1793800000000().up(db.createQueryRunner());
  try {
    const api: any = {};
    const output = ts.transpileModule(
      fs.readFileSync(path.join(__dirname, 'reviewInteractions.ts'), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      }
    ).outputText;
    new Function('require', 'exports', output)((name: string) => {
      if (name === '@server/datasource')
        return {
          getRepository: (entity: any) =>
            entity.name === 'MovieReview'
              ? {
                  existsBy: async ({ id }: any) => id === 'local:1:123',
                  find: async () => [{ id: 'local:1:123' }],
                }
              : entity.name === 'User'
                ? {
                    findBy: async () => [
                      { id: 1, displayName: 'One', avatar: '/one.png' },
                    ],
                  }
                : db.getRepository(entity),
        };
      return runtimeRequire(name);
    }, api);
    const app = express();
    app.use(express.json());
    app.use((req: any, res, next) => {
      if (!req.header('x-test-user')) return res.sendStatus(403);
      req.user = {
        id: Number(req.header('x-test-user')),
        permissions: req.header('x-test-admin') ? Permission.ADMIN : 0,
      };
      next();
    });
    app.use(
      middleware({
        apiSpec: path.resolve('seerr-api.yml'),
        validateRequests: true,
        validateSecurity: false,
      })
    );
    app.use('/api/v1/review-interactions', api.default);
    app.use((error: any, _req: any, res: any, _next: any) => {
      void _next;
      return res.status(error.status || 500).json({ message: error.message });
    });
    const prefix = '/api/v1/review-interactions/local:1:123',
      id = randomUUID();
    await request(app)
      .get(prefix + '/comments')
      .expect(403);
    await request(app)
      .post(prefix + '/comments')
      .set('x-test-user', '1')
      .send({ id, text: 'Hello', userId: 2 })
      .expect(400);
    await request(app)
      .post(prefix + '/comments')
      .set('x-test-user', '1')
      .send({ id, text: 'Hello' })
      .expect(201);
    await request(app)
      .post(prefix + '/comments')
      .set('x-test-user', '1')
      .send({ id, text: 'Hello' })
      .expect(201);
    const comments = await request(app)
      .get(prefix + '/comments')
      .set('x-test-user', '2')
      .expect(200);
    assert.equal(comments.body.total, 1);
    assert.equal(comments.body.results[0].canEdit, false);
    assert.equal(comments.body.results[0].canDelete, false);
    await request(app)
      .patch(prefix + '/comments/' + id)
      .set('x-test-user', '2')
      .send({ text: 'No', revision: comments.body.results[0].updatedAt })
      .expect(403);
    await request(app)
      .delete(prefix + '/comments/' + id)
      .set('x-test-user', '2')
      .expect(403);
    await request(app)
      .put(prefix + '/reactions')
      .set('x-test-user', '1')
      .send({ emoji: '👩🏽‍🚀', active: true })
      .expect(200);
    await request(app)
      .put(prefix + '/reactions')
      .set('x-test-user', '1')
      .send({ emoji: 'hello', active: true })
      .expect(400);
    await request(app)
      .put(prefix + '/reactions')
      .set('x-test-user', '1')
      .send({ emoji: '😀', active: 'yes' })
      .expect(400);
    await request(app)
      .put(prefix + '/reactions')
      .set('x-test-user', '2')
      .send({ commentId: id, emoji: '🎉', active: true })
      .expect(204);
    const threaded = await request(app)
      .get(prefix + '/comments')
      .set('x-test-user', '2')
      .expect(200);
    assert.deepEqual(threaded.body.results[0].reactions, [
      { emoji: '🎉', count: 1, mine: true },
    ]);
    await request(app)
      .put(prefix + '/reactions')
      .set('x-test-user', '2')
      .send({ commentId: randomUUID(), emoji: '🎉', active: true })
      .expect(404);
    const summary = await request(app)
      .get('/api/v1/review-interactions/summary')
      .query({ ids: 'local:1:123' })
      .set('x-test-user', '1')
      .expect(200);
    assert.equal(summary.headers['cache-control'], 'private, no-store');
    assert.equal(summary.body['local:1:123'].comments, 1);
    assert.equal(summary.body['local:1:123'].reactions[0].mine, true);
    await request(app)
      .get('/api/v1/review-interactions/missing/comments')
      .set('x-test-user', '1')
      .expect(404);
    await request(app)
      .get(prefix + '/comments?page=0')
      .set('x-test-user', '1')
      .expect(400);
    await request(app)
      .delete(prefix + '/comments/' + id)
      .set('x-test-user', '2')
      .set('x-test-admin', 'true')
      .expect(204);
  } finally {
    await db.destroy();
  }
});
