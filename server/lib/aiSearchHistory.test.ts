import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SEARCH_RETENTION,
  canonicalSearchHistory,
  readSearchHistory,
  readSearchPlan,
  rememberSearch,
  saveSearchPlan,
} from './aiSearchHistory';
import type { AiPlan } from './aiSearchPlan';

test('history isolates users, deduplicates groups, serializes writes and expires at seven days', async (t) => {
  const user = 880001;
  await Promise.all([
    rememberSearch(user, 'horror', [user, 4]),
    rememberSearch(user, 'sci-fi', [user]),
    rememberSearch(user, 'horror', [4, user, 4]),
  ]);
  const history = await readSearchHistory(user);
  assert.equal(history.length, 2);
  assert.equal(history[0].query, 'horror');
  assert.deepEqual(history[0].people, [4]);
  assert.deepEqual(await readSearchHistory(user + 1), []);
  const plan = { note: 'fixture' } as AiPlan;
  await saveSearchPlan(user, 'versioned-key', plan);
  assert.deepEqual(await readSearchPlan(user, 'versioned-key'), plan);
  assert.equal(await readSearchPlan(user + 1, 'versioned-key'), undefined);
  assert.equal(await readSearchPlan(user, 'different-contract'), undefined);
  const future = Date.now() + SEARCH_RETENTION + 1;
  t.mock.method(Date, 'now', () => future);
  assert.deepEqual(await readSearchHistory(user), []);
  assert.equal(await readSearchPlan(user, 'versioned-key'), undefined);
  await assert.rejects(readSearchHistory(-1));
});

test('legacy filter variants collapse and cannot replay edited filters', () => {
  const filters = { maxRuntime: 90 } as never;
  const history = canonicalSearchHistory([
    { id: '1', query: 'Horror movies', people: [], searchedAt: 10 },
    {
      id: '2',
      query: ' horror   movies ',
      people: [4],
      searchedAt: 20,
      filters,
    },
    {
      id: '3',
      query: 'Comedy',
      people: [],
      searchedAt: 15,
      filters,
      filterOrigin: 'prompt',
    },
  ]);
  assert.equal(history.length, 2);
  assert.equal(history[0].id, '2');
  assert.equal(history[0].filters, undefined);
  assert.deepEqual(history[1].filters, filters);
});

test('same normalized prompt replaces one entry with generated filters and latest people', async () => {
  const user = 880003;
  const filters = { maxRuntime: 120 } as never;
  await rememberSearch(user, 'Horror movies', [user], filters);
  await rememberSearch(user, ' horror   movies ', [user, 4], filters);
  const history = await readSearchHistory(user);
  assert.equal(history.length, 1);
  assert.deepEqual(history[0].filters, filters);
  assert.equal(history[0].filterOrigin, 'prompt');
  assert.deepEqual(history[0].people, [4]);
});
