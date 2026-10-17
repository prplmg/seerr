import * as mediaConstants from '@server/constants/media';
import { MediaRequestStatus } from '@server/constants/media';
import { Permission } from '@server/lib/permissions';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';
import * as policy from './requestSearchPolicy';

// Execute the real route handlers with in-memory repositories. No server,
// Sonarr, email service or production database is contacted.
function harness(isAdmin: boolean, request: Record<string, any>) {
  const handlers = new Map<string, (...args: any[]) => any>();
  let saves = 0;
  const router = Object.fromEntries(
    ['get', 'post', 'put', 'delete'].map((method) => [
      method,
      (url: string, ...functions: ((...args: any[]) => any)[]) =>
        handlers.set(`${method} ${url}`, functions[functions.length - 1]),
    ])
  );
  const repo = {
    findOneOrFail: async () => request,
    save: async () => {
      saves++;
    },
  };
  const source = ts.transpileModule(
    readFileSync(path.join(__dirname, '../routes/request.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }
  ).outputText;
  const exports = {};
  new Function('require', 'exports', source)((name: string) => {
    if (name === 'express') return { Router: () => router };
    if (name === '@server/datasource') return { getRepository: () => repo };
    if (name === '@server/middleware/auth')
      return { isAuthenticated: () => () => {} };
    if (name === '@server/lib/requestSearchPolicy') return policy;
    if (name === '@server/constants/media') return mediaConstants;
    if (name === '@server/lib/permissions') return { Permission };
    if (name === '@server/logger') return { error() {}, debug() {} };
    return {};
  }, exports);
  return {
    saves: () => saves,
    async approve(body: object = {}, retry = false) {
      let status = 200;
      const res: any = {
        sendStatus: (code: number) => {
          status = code;
        },
        status: (code: number) => {
          status = code;
          return res;
        },
        json: () => res,
      };
      await handlers.get(
        retry ? 'post /:requestId/retry' : 'post /:requestId/:status'
      )!(
        {
          params: { requestId: '1', status: 'approve' },
          body,
          user: {
            hasPermission: (permission: number) =>
              permission === Permission.ADMIN && isAdmin,
          },
        },
        res,
        (error: any) => {
          status = error.status;
        }
      );
      return status;
    },
  };
}
it('approves without searching and persists the flag before dispatch', async () => {
  const request = {
    status: MediaRequestStatus.PENDING,
    requiresSeasonApproval: true,
    skipInitialSearch: false,
  };
  const h = harness(true, request);
  assert.equal(await h.approve({ skipInitialSearch: true }), 200);
  assert.equal(request.status, MediaRequestStatus.APPROVED);
  assert.equal(request.skipInitialSearch, true);
  assert.equal(h.saves(), 1);
});
it('normal approval clears a prior no-search selection when explicitly chosen', async () => {
  const request = {
    status: MediaRequestStatus.PENDING,
    skipInitialSearch: true,
  };
  assert.equal(
    await harness(true, request).approve({ skipInitialSearch: false }),
    200
  );
  assert.equal(request.skipInitialSearch, false);
});
it('non-admin managers cannot approve or retry held requests, or set search mode', async () => {
  for (const retry of [false, true]) {
    const request = {
      status: MediaRequestStatus.PENDING,
      requiresSeasonApproval: true,
    };
    const h = harness(false, request);
    assert.equal(await h.approve({}, retry), 403);
    assert.equal(h.saves(), 0);
    assert.equal(request.status, MediaRequestStatus.PENDING);
  }
  assert.equal(
    await harness(false, {}).approve({ skipInitialSearch: true }),
    403
  );
});
it('rejects malformed search choices and preserves no-search on retry', async () => {
  const h = harness(true, {});
  assert.equal(await h.approve({ skipInitialSearch: 'false' }), 400);
  assert.equal(h.saves(), 0);
  const request = { skipInitialSearch: true };
  assert.equal(await harness(true, request).approve({}, true), 200);
  assert.equal(request.skipInitialSearch, true);
});
