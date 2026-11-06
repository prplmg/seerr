import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { DiscoveryList, ListStore } from './discoveryLists';
import { mediaDiscoveryLists } from './mediaDiscoveryLists';
const now = Date.now();
const base: DiscoveryList = {
  id: 'one',
  title: 'One',
  creator: 'Someone',
  description: '',
  source: 'catalogue',
  visibility: 'public',
  checkedAt: now,
  items: [{ type: 'movie', tmdbId: 99999999 }],
  history: [],
};
const store = (lists: DiscoveryList[]): ListStore => ({
  version: 1,
  lists,
  saved: {},
  liked: {},
  availability: {},
});
it('returns exact media memberships and excludes private, unknown, stale and unavailable lists', () => {
  const s = store([
    base,
    { ...base, id: 'private', visibility: 'private', ownerId: 2 },
    { ...base, id: 'unknown', visibility: 'unknown', ownerId: 2 },
    { ...base, id: 'mine', visibility: 'private', ownerId: 1 },
    { ...base, id: 'stale', source: 'letterboxd', checkedAt: now - 86400001 },
    { ...base, id: 'unavailable', unavailable: true },
    { ...base, id: 'deleted', deletedAt: now },
    { ...base, id: 'series', items: [{ type: 'tv', tmdbId: 99999999 }] },
  ]);
  assert.deepEqual(
    mediaDiscoveryLists(s, 1, { type: 'movie', tmdbId: 99999999 }, now)
      .map((x) => x.id)
      .sort(),
    ['mine', 'one']
  );
  assert.deepEqual(
    mediaDiscoveryLists(s, 1, { type: 'tv', tmdbId: 99999999 }, now).map(
      (x) => x.id
    ),
    ['series']
  );
  assert.deepEqual(
    mediaDiscoveryLists(s, 1, { type: 'movie', tmdbId: 99999998 }, now),
    []
  );
});
it('prioritizes saved lists without leaking another viewer bookmarks or mutating the store', () => {
  const s = store([base, { ...base, id: 'saved', title: 'Zed' }]);
  s.saved = { 1: ['saved'], 2: ['one'] };
  const before = JSON.stringify(s);
  const result = mediaDiscoveryLists(
    s,
    1,
    { type: 'movie', tmdbId: 99999999 },
    now
  );
  assert.deepEqual(
    result.map((x) => [x.id, x.saved]),
    [
      ['saved', true],
      ['one', false],
    ]
  );
  assert(!('items' in result[0]));
  assert.equal(JSON.stringify(s), before);
});

it('blocked titles are excluded from membership and list totals', () => {
  const s = store([
    { ...base, items: [...base.items, { type: 'tv', tmdbId: 4 }] },
  ]);
  assert.deepEqual(
    mediaDiscoveryLists(
      s,
      1,
      { type: 'movie', tmdbId: 99999999 },
      now,
      new Set(['movie:99999999'])
    ),
    []
  );
  assert.equal(
    mediaDiscoveryLists(
      s,
      1,
      { type: 'movie', tmdbId: 99999999 },
      now,
      new Set(['tv:4'])
    )[0].total,
    1
  );
});
