import assert from 'node:assert/strict';
import { it } from 'node:test';
import { orderList, refreshedListValue, sortedList } from './listSort';
it('sorts the entire list before pagination, preserves ties and puts missing values last in either direction', () => {
  const rows = [
    { id: 1, value: 2 },
    { id: 2, value: null },
    { id: 3, value: 5 },
    { id: 4, value: 2 },
  ];
  assert.deepEqual(
    orderList(rows, (r) => r.value, true).map((r) => r.id),
    [3, 1, 4, 2]
  );
  assert.deepEqual(
    orderList(rows, (r) => r.value, false).map((r) => r.id),
    [1, 4, 3, 2]
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    [1, 2, 3, 4]
  );
});
it('normal list order does not load metadata or change the input', () => {
  const items = [{ type: 'movie' as const, tmdbId: 1 }];
  assert.deepEqual(sortedList(items, 'original'), { items, updating: false });
});

it('score success is retained seven days and failed refresh keeps the known score with short retry backoff', () => {
  const now = 1_800_000_000_000;
  const successful = refreshedListValue('rating', undefined, 4.2, now);
  assert.deepEqual(successful, { value: 4.2, until: now + 7 * 86400000 });
  assert.deepEqual(refreshedListValue('rating', successful, null, now), {
    value: 4.2,
    until: now + 900000,
  });
  assert.deepEqual(refreshedListValue('rating', undefined, null, now), {
    value: null,
    until: now + 900000,
  });
  assert.equal(
    refreshedListValue('runtime', undefined, 90, now).until,
    now + 30 * 86400000
  );
  assert.equal(refreshedListValue('rating', successful, 0, now).value, 0);
});

it('AI rating collection shares four slots, deduplicates work and reuses cached scores', async (t) => {
  const api = await import('@server/api/rating/letterboxd');
  const { collectListRatings } = await import('./listSort');
  let active = 0,
    peak = 0,
    calls = 0;
  t.mock.method(api, 'getFreshLetterboxdRating', async (id: number) => {
    active++;
    calls++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return id === 770009
      ? null
      : { score: 4.1, url: 'https://letterboxd.com/film/fixture/' };
  });
  const films = Array.from({ length: 10 }, (_, i) => ({
    tmdbId: 770000 + i,
    type: 'movie' as const,
  }));
  sortedList(films.slice(0, 3), 'rating-desc');
  const progress: number[] = [];
  const [a, b] = await Promise.all([
    collectListRatings(films, (n) => progress.push(n)),
    collectListRatings(films),
  ]);
  assert.equal(peak, 4);
  assert.equal(calls, 10);
  assert.equal(a.size, 10);
  assert.deepEqual(a, b);
  assert.equal(a.get('movie:770009'), null);
  assert.equal(progress.at(-1), 10);
  await collectListRatings(films);
  assert.equal(calls, 10);
});

it('rating wait deadline returns unknown, while shared work can finish and populate cache', async (t) => {
  const api = await import('@server/api/rating/letterboxd');
  const { collectListRatings } = await import('./listSort');
  let release!: (value: { score: number; url: string }) => void;
  t.mock.method(
    api,
    'getFreshLetterboxdRating',
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const films = [{ type: 'movie' as const, tmdbId: 770100 }];
  const timed = await collectListRatings(films, () => {}, 1);
  assert.equal(timed.get('movie:770100'), null);
  release({ score: 4.4, url: 'https://letterboxd.com/film/fixture/' });
  const ready = await collectListRatings(films);
  assert.equal(ready.get('movie:770100'), 4.4);
});
