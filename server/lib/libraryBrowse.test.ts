import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import type { AiFilters } from './aiSearchPlan';
import type * as Library from './libraryBrowse';
const runtimeRequire = createRequire(__filename);
const filters: AiFilters = {
  type: 'movie',
  available: true,
  unwatched: false,
  maxRuntime: null,
  yearFrom: null,
  yearTo: null,
  genres: [],
};
function harness(count = 45, mixed = false) {
  let valid = true,
    history = true,
    active = 0,
    peak = 0;
  const calls: number[] = [];
  let ratings = 0;
  const api = {} as typeof Library;
  const data = {
    users: [
      { id: 1, name: 'me' },
      { id: 2, name: 'friend' },
    ],
    requestAvailable: new Set(
      Array.from(
        { length: count },
        (_, i) => `${mixed && i % 2 ? 'tv' : 'movie'}:${i + 1}`
      )
    ),
    addedDates: new Map(
      Array.from({ length: count }, (_, i) => [
        `${mixed && i % 2 ? 'tv' : 'movie'}:${i + 1}`,
        i + 1,
      ])
    ),
    ratings: [],
    watched: [{ userId: 2, type: 'movie', tmdbId: 1 }],
    historyAvailable: true,
    visibilityStillValid: () => valid,
  };
  const model = (id: number) => ({
    id,
    mediaType: 'movie',
    title: 'Movie ' + id,
    releaseDate: `${2000 + (id % 20)}-01-01`,
    genreIds: [878],
    runtime: 60 + id,
    genres: [{ id: 878 }],
  });
  new Function(
    'require',
    'exports',
    ts.transpileModule(
      fs.readFileSync(path.join(__dirname, 'libraryBrowse.ts'), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      }
    ).outputText
  )((name: string) => {
    if (name === '@server/api/themoviedb')
      return class {
        async getLibraryTv(id: number) {
          return {
            ...model(id),
            mediaType: 'tv',
            name: 'Series ' + id,
            episode_run_time: [40],
          };
        }
        async getLibraryMovie(id: number) {
          calls.push(id);
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 1));
          active--;
          return model(id);
        }
      };
    if (name === './discoveryData')
      return {
        discoveryData: async () => ({ ...data, historyAvailable: history }),
      };
    if (name === './listSort')
      return {
        collectListRatings: async (
          items: { tmdbId: number }[],
          progress: (a: number, b: number) => void
        ) => {
          ratings++;
          progress(items.length, items.length);
          return new Map(
            items.map((r) => [`movie:${r.tmdbId}`, r.tmdbId === 2 ? null : 4])
          );
        },
      };
    if (name === '@server/models/Search')
      return {
        mapMovieDetailsToResult: (v: unknown) => v,
        mapMovieResult: (v: unknown) => v,
        mapTvDetailsToResult: (v: unknown) => v,
        mapTvResult: (v: unknown) => v,
      };
    return runtimeRequire(name);
  }, api);
  return {
    api,
    calls,
    ratings: () => ratings,
    peak: () => peak,
    invalidate: () => {
      valid = false;
    },
    history: (v: boolean) => {
      history = v;
    },
  };
}
async function done(
  h: ReturnType<typeof harness>,
  id: string,
  user = 1,
  page = 0
) {
  for (let i = 0; i < 200; i++) {
    const r = h.api.libraryJob(user, id, page);
    if (r.ready) return r;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw Error('Job did not finish');
}
test('opening reads one page only; no score work; bounded metadata; jobs are private', async () => {
  const h = harness();
  const first = await h.api.startLibraryBrowse(1, filters, [], [], 0);
  const result = await done(h, first.id);
  assert.equal(h.calls.length, 20);
  assert.equal(h.ratings(), 0);
  assert.equal(result.total, 45);
  assert.equal(result.next, 1);
  assert(h.peak() <= 2);
  assert.throws(() => h.api.libraryJob(2, first.id, 0));
  h.invalidate();
  assert.throws(() => h.api.libraryJob(1, first.id, 0));
});
test('group exclusion happens before metadata; removal restores title; history outage fails closed', async () => {
  const h = harness(4);
  let r = await h.api.startLibraryBrowse(
    1,
    { ...filters, unwatched: true },
    [],
    [2],
    0
  );
  let ready = await done(h, r.id);
  assert(!ready.results?.some((x) => x.media.id === 1));
  assert(!h.calls.includes(1));
  r = await h.api.startLibraryBrowse(
    1,
    { ...filters, unwatched: true },
    [],
    [],
    0
  );
  ready = await done(h, r.id);
  assert(ready.results?.some((x) => x.media.id === 1));
  h.history(false);
  await assert.rejects(
    h.api.startLibraryBrowse(1, { ...filters, unwatched: true }, [], [], 0)
  );
  await assert.rejects(h.api.startLibraryBrowse(1, filters, [], [999], 0));
});
test('sort entire available pool before pagination and reuse finished job', async () => {
  const h = harness();
  const sort = [{ field: 'runtime' as const, direction: 'desc' as const }];
  const first = await h.api.startLibraryBrowse(1, filters, sort, [], 0);
  const result = await done(h, first.id);
  assert.equal(result.results?.[0].media.id, 45);
  assert.equal(result.total, 45);
  const second = await h.api.startLibraryBrowse(1, filters, sort, [], 1);
  assert.equal(second.id, first.id);
  assert.equal(second.results?.[0].media.id, 25);
  assert.equal(h.calls.length, 45);
  assert(h.peak() <= 2);
});
test('runtime and score filters exclude unknown scores; sort-only retains unknown last', async () => {
  const h = harness(4);
  const first = await h.api.startLibraryBrowse(
    1,
    { ...filters, maxRuntime: 63, minLetterboxdRating: 4 },
    [],
    [],
    0
  );
  const result = await done(h, first.id);
  assert.deepEqual(
    result.results?.map((r) => r.media.id),
    [1, 3]
  );
  assert.equal(result.unknown, 1);
  const other = await h.api.startLibraryBrowse(
    1,
    filters,
    [{ field: 'rating', direction: 'desc' }],
    [],
    0
  );
  const sorted = await done(h, other.id);
  assert.equal(sorted.results?.at(-1)?.media.id, 2);
  assert.equal(sorted.total, 4);
});
test('new filter request cancels older background work', async () => {
  const h = harness();
  const old = await h.api.startLibraryBrowse(
    1,
    filters,
    [{ field: 'runtime', direction: 'asc' }],
    [],
    0
  );
  const next = await h.api.startLibraryBrowse(
    1,
    { ...filters, maxRuntime: 63 },
    [],
    [],
    0
  );
  await done(h, next.id);
  assert.throws(() => h.api.libraryJob(1, old.id, 0));
  assert(h.peak() <= 2);
});

test('mixed library recent order spans both types without scanning full metadata', async () => {
  const h = harness(45, true);
  const first = await h.api.startLibraryBrowse(
    1,
    filters,
    [{ field: 'added', direction: 'desc' }],
    [],
    0,
    true
  );
  const ready = await done(h, first.id);
  assert.equal(ready.total, 45);
  assert.equal(ready.results?.length, 20);
  assert.equal(ready.results?.[0].media.id, 45);
  assert(ready.results?.some((x) => x.media.mediaType === 'tv'));
  assert(ready.results?.some((x) => x.media.mediaType === 'movie'));
});
