import assert from 'node:assert/strict';
import { it } from 'node:test';
import { shortWatchPage } from './discoveryShort';
it('continues through empty batches and finds short films past candidate 30 without duplicates', async () => {
  const candidates = Array.from({ length: 145 }, (_, i) => i);
  const runtime = async (n: number) => (n < 70 ? 200 : 80);
  const a = await shortWatchPage(candidates, 0, 90, runtime);
  assert.deepEqual(a, { results: [], next: 60 });
  const b = await shortWatchPage(candidates, a.next!, 90, runtime);
  assert.deepEqual(b.results, candidates.slice(70, 90));
  assert.equal(b.next, 90);
  const c = await shortWatchPage(candidates, 140, 90, runtime);
  assert.deepEqual(c, { results: candidates.slice(140), next: null });
});
it('runtime lookup errors fail the page instead of silently skipping candidates', async () => {
  await assert.rejects(
    shortWatchPage([1], 0, 90, async () => {
      throw Error('offline');
    })
  );
});

it('returns the already fetched duration for badges without another lookup or changing candidates', async () => {
  const rows = [{ id: 1 }, { id: 2 }];
  let calls = 0;
  const result = await shortWatchPage(
    rows,
    0,
    90,
    async (row) => {
      calls++;
      return row.id === 1 ? 85 : 100;
    },
    (row, listRuntime) => ({ ...row, listRuntime })
  );
  assert.deepEqual(result.results, [{ id: 1, listRuntime: 85 }]);
  assert.equal(calls, 2);
  assert.deepEqual(rows, [{ id: 1 }, { id: 2 }]);
});
