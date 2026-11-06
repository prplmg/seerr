import assert from 'node:assert/strict';
import { it } from 'node:test';
import { exploreLists } from './discoveryExplore';
import type { DiscoveryList, ListStore } from './discoveryLists';
const now = Date.parse('2026-11-06T18:00:00Z');
const list = (
  id: string,
  source: DiscoveryList['source'],
  extra: Partial<DiscoveryList> = {}
): DiscoveryList => ({
  id,
  source,
  title: id,
  creator: id,
  description: '',
  visibility: 'public',
  checkedAt: now,
  items: [{ type: 'movie', tmdbId: 1 }],
  history: [],
  ...extra,
});
const base = () => [
  ...Array.from({ length: 44 }, (_, i) => list(`lb${i}`, 'letterboxd')),
  ...Array.from({ length: 30 }, (_, i) => list(`curated${i}`, 'curated')),
];
const empty = (): Pick<ListStore, 'saved' | 'liked'> => ({
  saved: {},
  liked: {},
});
const ids = (rows: DiscoveryList[]) => rows.map((l) => l.id);
it('selects 10 LB, one distinct public user list each, then curated to 20', () => {
  const pool = [
    ...base(),
    ...[1, 2, 3, 4].map((ownerId) =>
      list(`own${ownerId}`, 'catalogue', { ownerId })
    ),
  ];
  const result = exploreLists(pool, empty(), [1, 2, 3, 4], now);
  assert.equal(result.length, 20);
  assert.equal(result.filter((l) => l.source === 'letterboxd').length, 10);
  assert.equal(result.filter((l) => l.source === 'catalogue').length, 4);
  assert.equal(result.filter((l) => l.source === 'curated').length, 6);
});
it('is shared and input-order independent; changes at Merida midnight, not UTC midnight', () => {
  const pool = base(),
    store = empty();
  const before = Date.parse('2026-11-07T05:59:59Z');
  assert.deepEqual(
    ids(exploreLists(pool, store, [], now)),
    ids(exploreLists([...pool].reverse(), store, [], before))
  );
  assert.notDeepEqual(
    ids(exploreLists(pool, store, [], before)),
    ids(exploreLists(pool, store, [], before + 1000))
  );
});
it('does not hide owned or saved cards; picks distinct alternatives for overlapping saves', () => {
  const a = list('a', 'catalogue'),
    b = list('b', 'catalogue');
  const store = { saved: { 1: ['a', 'b'], 2: ['a'] }, liked: {} };
  for (let day = 0; day < 20; day++) {
    const result = exploreLists(
      [...base(), a, b],
      store,
      [1, 2],
      now + day * 86400000
    );
    assert(result.some((l) => l.id === 'a'));
    assert(result.some((l) => l.id === 'b'));
    assert.equal(new Set(ids(result)).size, result.length);
  }
});
it('deduplicates shared user picks and counts existing LB selections as representation', () => {
  const first = exploreLists(base(), empty(), [], now).find(
    (l) => l.source === 'letterboxd'
  )!;
  const pool = [...base(), list('shared', 'catalogue')];
  const result = exploreLists(
    pool,
    { saved: { 1: ['shared'], 2: ['shared'], 3: [first.id] }, liked: {} },
    [1, 2, 3],
    now
  );
  assert.equal(result.filter((l) => l.id === 'shared').length, 1);
  assert.equal(result.filter((l) => l.id === first.id).length, 1);
  assert.equal(result.length, 20);
});
it('exceeds 20 rather than dropping user representatives', () => {
  const users = Array.from({ length: 14 }, (_, i) => i + 1);
  const pool = [
    ...base(),
    ...users.map((ownerId) => list(`own${ownerId}`, 'catalogue', { ownerId })),
  ];
  const result = exploreLists(pool, empty(), users, now);
  assert.equal(result.length, 24);
  for (const id of users) assert(result.some((l) => l.ownerId === id));
});
it('excludes private, unavailable, stale, deleted and blacklisted lists even for their owners', () => {
  const invalid = [
    list('private', 'catalogue', { visibility: 'private', ownerId: 1 }),
    list('unknown', 'catalogue', { visibility: 'unknown' }),
    list('gone', 'catalogue', { unavailable: true }),
    list('deleted', 'catalogue', { deletedAt: now - 1 }),
    list('stale', 'letterboxd', { ownerId: 1, checkedAt: now - 86400000 }),
    list('stale-auto', 'letterboxd', {
      automatic: true,
      checkedAt: now - 15 * 86400000,
    }),
    list('blocked', 'letterboxd', {
      url: 'https://letterboxd.com/evegrissel/list/20-underseen-erotic-thrillers-1/',
    }),
    list('youtube', 'letterboxd', {
      url: 'https://letterboxd.com/o_zero/list/short-films-on-youtube/',
    }),
  ];
  const result = exploreLists(
    [...base(), ...invalid],
    { saved: { 1: ids(invalid) }, liked: {} },
    [1],
    now
  );
  assert(!result.some((l) => ids(invalid).includes(l.id)));
  assert.deepEqual(ids(result), ids(exploreLists(base(), empty(), [1], now)));
});
it('does not promote liked-only associations or users outside the eligible set', () => {
  const pool = [
    ...base(),
    list('hidden-user', 'catalogue', { ownerId: 99 }),
    list('liked-only', 'catalogue', { url: 'https://example.com/list/' }),
  ];
  const result = exploreLists(
    pool,
    { saved: {}, liked: { 1: ['https://example.com/list/'] } },
    [1],
    now
  );
  assert(!result.some((l) => l.source === 'catalogue'));
});
it('uses curated fallback for a small pool without duplication or inventing missing cards', () => {
  const one = list('one', 'letterboxd', {
    url: 'https://letterboxd.com/test/list/one/',
  });
  const pool = [one, one, { ...one, id: 'redirect' }, list('c', 'curated')];
  const result = exploreLists(pool, empty(), [], now);
  assert.equal(result.length, 2);
  assert.equal(result.filter((l) => l.source === 'letterboxd').length, 1);
});
it('never mutates list, bookmark or user inputs', () => {
  const pool = base(),
    store = { saved: { 1: ['lb1'] }, liked: {} },
    users = [2, 1];
  const before = JSON.stringify({ pool, store, users });
  exploreLists(pool, store, users, now);
  assert.equal(JSON.stringify({ pool, store, users }), before);
});
