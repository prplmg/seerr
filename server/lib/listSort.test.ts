import assert from 'node:assert/strict';
import { it } from 'node:test';
import { orderList, sortedList } from './listSort';
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
