import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';
import type { ListFilm } from './discoveryLists';
import type * as listSort from './listSort';

const runtimeRequire = createRequire(__filename);
it('runtime sorting uses base metadata, keeps missing durations last, and reuses collected values', async () => {
  const calls: number[] = [];
  const writes = new Map<string, string>();
  const output = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, 'listSort.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  ).outputText;
  const api = {} as typeof listSort;
  new Function('require', 'exports', output)((name: string) => {
    if (name === '@server/api/themoviedb')
      return class {
        async getListMovie(id: number) {
          calls.push(id);
          if (id === 3) throw Error('not found');
          return { runtime: id === 1 ? 120 : 80 };
        }
        getMovie() {
          throw Error('Full movie lookup must not be used');
        }
      };
    if (name === '@server/api/rating/letterboxd') return {};
    if (name === '@server/logger') return { warn: () => {} };
    if (name === '@server/utils/appDataVolume')
      return { appDataPath: () => '/fixture' };
    if (name === './discoveryLists')
      return { filmKey: (f: ListFilm) => `${f.type}:${f.tmdbId}` };
    if (name === 'fs')
      return {
        readFileSync: () => {
          throw Object.assign(Error('missing'), { code: 'ENOENT' });
        },
        writeFileSync: (file: string, data: string) => writes.set(file, data),
        renameSync: (from: string, to: string) => {
          writes.set(to, writes.get(from)!);
          writes.delete(from);
        },
        existsSync: (file: string) => writes.has(file),
        unlinkSync: (file: string) => writes.delete(file),
      };
    return runtimeRequire(name);
  }, api);
  const films: ListFilm[] = [1, 2, 3].map((tmdbId) => ({
    type: 'movie',
    tmdbId,
  }));
  assert.equal(api.sortedList(films, 'runtime-asc').updating, true);
  await new Promise((resolve) => setImmediate(resolve));
  const result = api.sortedList(films, 'runtime-asc');
  assert.equal(result.updating, false);
  assert.deepEqual(
    result.items.map((f) => [
      f.tmdbId,
      (f as ListFilm & { listRuntime: number | null }).listRuntime,
    ]),
    [
      [2, 80],
      [1, 120],
      [3, null],
    ]
  );
  assert.deepEqual(
    api.sortedList(films, 'runtime-desc').items.map((f) => f.tmdbId),
    [1, 2, 3]
  );
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(writes.size, 1);
});
