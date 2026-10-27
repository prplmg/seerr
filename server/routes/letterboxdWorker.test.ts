import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { parseSupportedObservations } from '../lib/letterboxdWriteWorker';

it('observation API requires dedicated credentials before dispatch and validates capabilities', async () => {
  type Request = { body: Record<string, unknown>; header: () => string };
  type Response = {
    code: number;
    data?: unknown;
    setHeader: () => void;
    sendStatus: (n: number) => void;
    status: (n: number) => Response;
    json: (v: unknown) => void;
  };
  const handlers: Record<
    string,
    (req: Request, res: Response) => Promise<unknown>
  > = {};
  let calls = 0,
    listCalls = 0;
  const deps: Record<string, unknown> = {
    '@server/logger': { info: () => {}, error: () => {} },
    '@server/lib/discoveryBrowser': {
      exchangeBrowserLists: () => {
        listCalls++;
        return { action: 'idle' };
      },
      pendingBrowserList: () => ({ pending: false }),
    },
    express: {
      Router: () => ({
        use: () => {},
        get: () => {},
        post: (p: string, fn: (typeof handlers)[string]) => {
          handlers[p] = fn;
        },
      }),
    },
    'express-rate-limit': () => () => {},
    '@server/lib/letterboxdBrowser': {
      browserTokenMatches: (t: string) => t === 'dedicated',
    },
    '@server/lib/letterboxdWriteWorker': {
      parseSupportedObservations,
      exchangeObservations: async () => {
        calls++;
        return { action: 'idle' };
      },
    },
  };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(path.join(__dirname, 'letterboxdWorker.ts'), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          esModuleInterop: true,
        },
      }
    ).outputText,
    {
      exports: {},
      require: (id: string) => {
        if (!(id in deps)) throw Error(id);
        return deps[id];
      },
    }
  );
  const run = async (
    auth: string,
    supported?: unknown,
    endpoint = '/observations'
  ) => {
    const res: Response = {
      code: 200,
      setHeader: () => {},
      sendStatus(n) {
        this.code = n;
      },
      status(n) {
        this.code = n;
        return this;
      },
      json(v) {
        this.data = v;
      },
    };
    await handlers[endpoint](
      {
        header: () => auth,
        body: {
          version: 1,
          instance: '6e282ef9-86a2-4356-9387-16f99807e283',
          supported,
        },
      },
      res
    );
    return res;
  };
  assert.equal((await run('')).code, 403);
  assert.equal((await run('Bearer general-api-key')).code, 403);
  assert.equal(calls, 0);
  assert.equal((await run('Bearer dedicated', ['watchlist'])).code, 400);
  assert.equal(calls, 0);
  assert.equal((await run('Bearer dedicated')).code, 200);
  assert.equal(calls, 1);
  assert.equal((await run('Bearer general-api-key', true, '/lists')).code, 403);
  assert.equal((await run('Bearer dedicated', false, '/lists')).code, 400);
  assert.equal(listCalls, 0);
  assert.equal((await run('Bearer dedicated', true, '/lists')).code, 200);
  assert.equal(listCalls, 1);
});
