import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { ListFilm } from './discoveryLists';
import { createSortProgressTracker } from './listSortProgress';

it('progress snapshots are scoped to owner and preview user and expose only counts', () => {
  let completed = 0;
  const tracker = createSortProgressTracker((items, sort) => ({
    field: sort.startsWith('rating')
      ? ('rating' as const)
      : ('runtime' as const),
    state:
      completed === items.length ? ('ready' as const) : ('pending' as const),
    completed,
    total: items.length,
    unavailable: 0,
  }));
  const items: ListFilm[] = [{ type: 'movie', tmdbId: 123 }];
  const ticket = tracker.register(items, 'rating-desc', 1, 2);
  items.push({ type: 'movie', tmdbId: 456 });
  assert.equal(tracker.read(ticket.id, 2, 2), null);
  assert.equal(tracker.read(ticket.id, 1, 1), null);
  assert.deepEqual(tracker.read(ticket.id, 1, 2), {
    field: 'rating',
    state: 'pending',
    completed: 0,
    total: 1,
    unavailable: 0,
  });
  completed = 1;
  assert.deepEqual(tracker.read(ticket.id, 1, 2), {
    field: 'rating',
    state: 'ready',
    completed: 1,
    total: 1,
    unavailable: 0,
  });
});
it('expired, evicted and restarted progress tickets recover through normal list reads', () => {
  let now = 0;
  const tracker = createSortProgressTracker(undefined, () => now, 1);
  const first = tracker.register([], 'runtime-asc', 1, 1);
  const second = tracker.register([], 'rating-desc', 1, 1);
  assert.deepEqual(tracker.read(first.id, 1, 1), { state: 'expired' });
  assert.equal(tracker.read(second.id, 1, 1)?.state, 'ready');
  now = 30 * 60_000;
  assert.deepEqual(tracker.read(second.id, 1, 1), { state: 'expired' });
  assert.deepEqual(createSortProgressTracker().read(second.id, 1, 1), {
    state: 'expired',
  });
});
