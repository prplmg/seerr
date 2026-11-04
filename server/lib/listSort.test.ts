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
