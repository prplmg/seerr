import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';
import type { ListFilm } from './discoveryLists';
import type * as listSort from './listSort';

const runtimeRequire = createRequire(__filename);
function harness(
  lookup: (field: 'rating' | 'runtime', id: number) => Promise<number>
) {
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
          return { runtime: await lookup('runtime', id) };
        }
        async getTvShow({ tvId }: { tvId: number }) {
          return { episode_run_time: [await lookup('runtime', tvId)] };
        }
        getMovie() {
          throw Error('Full movie lookup must not be used');
        }
      };
    if (name === '@server/api/rating/letterboxd')
      return {
        getFreshLetterboxdRating: async (id: number) => ({
          score: await lookup('rating', id),
        }),
      };
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
  return { api, writes };
}
it('runtime sorting uses base metadata, keeps missing durations last, and reuses collected values', async () => {
  const calls: number[] = [];
  const { api, writes } = harness(async (_field, id) => {
    calls.push(id);
    if (id === 3) throw Error('not found');
    return id === 1 ? 120 : 80;
  });
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

for (const first of ['rating', 'runtime'] as const) {
  it(`caps scores at four, runtime at two and total at four with ${first} queued first`, async () => {
    const pending: {
      field: 'rating' | 'runtime';
      resolve: (value: number) => void;
      reject: (error: Error) => void;
    }[] = [];
    const calls: string[] = [];
    const { api } = harness((field, id) => {
      calls.push(`${field}:${id}`);
      return new Promise((resolve, reject) =>
        pending.push({ field, resolve, reject })
      );
    });
    const films: ListFilm[] = Array.from({ length: 6 }, (_, i) => ({
      type: 'movie',
      tmdbId: i + 1,
    }));
    const enqueue = (field: 'rating' | 'runtime') =>
      api.sortedList(films, field === 'rating' ? 'rating-desc' : 'runtime-asc');
    enqueue(first);
    assert.equal(pending.length, first === 'rating' ? 4 : 2);
    enqueue(first === 'rating' ? 'runtime' : 'rating');
    // Repeated requests must not duplicate pending work.
    enqueue('rating');
    enqueue('runtime');
    assert.equal(pending.length, 4);
    if (first === 'runtime')
      assert.equal(pending.filter((x) => x.field === 'rating').length, 2);
    let failures = 0;
    while (pending.length) {
      assert.ok(pending.length <= 4);
      assert.ok(pending.filter((x) => x.field === 'runtime').length <= 2);
      const batch = pending.splice(0);
      for (const task of batch) {
        if (failures++ === 0) task.reject(Error('temporary failure'));
        else task.resolve(task.field === 'rating' ? 4 : 90);
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(calls.length, 12);
    assert.equal(new Set(calls).size, 12);
    assert.equal(api.listSortReadiness(films, 'rating-desc').state, 'ready');
    assert.equal(api.listSortReadiness(films, 'runtime-asc').state, 'ready');
  });
}

it('AI runtime collection shares the bounded cache for movies and episode lengths', async () => {
  const calls: number[] = [];
  const { api } = harness(async (_field, id) => {
    calls.push(id);
    return id === 1 ? 100 : 45;
  });
  const films: ListFilm[] = [
    { type: 'movie', tmdbId: 1 },
    { type: 'tv', tmdbId: 2 },
  ];
  const times = await api.collectListRuntimes(films, undefined, 1000);
  assert.equal(times.get('movie:1'), 100);
  assert.equal(times.get('tv:2'), 45);
  await api.collectListRuntimes(films, undefined, 1000);
  assert.deepEqual(calls, [1, 2]);
});
