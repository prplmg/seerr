import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';

const runtimeRequire = createRequire(__filename);
it('base movie lookup returns runtime without appended data or a trailer fallback and propagates errors', async () => {
  const calls: unknown[][] = [];
  let fail = false;
  class API {
    async get(...args: unknown[]) {
      calls.push(args);
      if (fail) throw Error('metadata unavailable');
      return { id: 123, title: 'Example', runtime: 82, poster_path: null };
    }
  }
  const output = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  ).outputText;
  const exports: {
    default?: new () => {
      getListMovie: (id: number) => Promise<{ runtime: number }>;
    };
  } = {};
  new Function('require', 'exports', output)((name: string) => {
    if (name === '@server/api/externalapi') return API;
    if (name === '@server/lib/cache') return { getCache: () => ({ data: {} }) };
    if (name === '@server/lib/settings')
      return { getSettings: () => ({ main: { locale: 'es' } }) };
    return runtimeRequire(name);
  }, exports);
  const api = new exports.default!();
  assert.equal((await api.getListMovie(123)).runtime, 82);
  assert.deepEqual(calls, [
    ['/movie/123', { params: { language: 'es' } }, 43200],
  ]);
  fail = true;
  await assert.rejects(api.getListMovie(456), /metadata unavailable/);
  assert.equal(calls.length, 2);
});
