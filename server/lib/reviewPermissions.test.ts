import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';
import * as permissions from './permissions';

it('Letterboxd management rejects ordinary users including the account owner', async () => {
  const routes = new Map<string, (...args: any[]) => any>();
  let writes = 0;
  const account = {
    username: 'prplmg',
    enabled: true,
    error: 'private diagnostic',
  };
  const router = Object.fromEntries(
    ['get', 'put', 'post', 'delete', 'use'].map((method) => [
      method,
      (url: string, ...handlers: ((...args: any[]) => any)[]) =>
        routes.set(`${method} ${url}`, handlers[handlers.length - 1]),
    ])
  );
  const compiled = ts.transpileModule(
    readFileSync(path.join(__dirname, '../routes/reviews.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }
  ).outputText;
  new Function('require', 'exports', compiled)((name: string) => {
    if (name === 'express') return { Router: () => router };
    if (name === 'express-rate-limit') return () => () => {};
    if (name === '@server/lib/permissions') return permissions;
    if (name === '@server/datasource')
      return { getRepository: () => ({ findOneBy: async () => account }) };
    if (name === '@server/lib/reviews')
      return {
        syncReviews: async () => {
          writes++;
        },
        withReviewLock: async () => {
          writes++;
        },
      };
    return {};
  }, {});
  const request = {
    params: { userId: '11' },
    user: {
      id: 11,
      permissions:
        permissions.Permission.REQUEST | permissions.Permission.AUTO_APPROVE,
    },
  };
  for (const route of [
    'put /account/:userId',
    'delete /account/:userId',
    'post /account/:userId/sync',
    'post /import/:userId',
  ]) {
    let status = 0;
    await routes.get(route)!(request, {
      sendStatus: (code: number) => {
        status = code;
      },
    });
    assert.equal(status, 403, route);
  }
  assert.equal(writes, 0);
  let result: any;
  await routes.get('get /account/:userId')!(request, {
    json: (body: any) => {
      result = body;
    },
  });
  assert.deepEqual(result, { account: { username: 'prplmg' } });
  await routes.get('post /account/:userId/sync')!(
    { ...request, user: { id: 1, permissions: permissions.Permission.ADMIN } },
    { json: () => {} }
  );
  assert.equal(writes, 1);
});
