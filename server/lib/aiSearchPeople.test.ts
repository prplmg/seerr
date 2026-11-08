import logger from '@server/logger';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchPeople } from './aiSearchPeople';
import { recordAiSearchUsage } from './aiSearchUsage';
import { togetherSeen } from './discoveryRecommendations';
const users = [
  { id: 1, name: 'prplmg' },
  { id: 4, name: 'ykrn' },
];
test('people parsing is local, scoped and bounded; strips recognized names from model input', () => {
  assert.deepEqual(
    searchPeople(1, [], 'Horror, unwatched by ykrn and I', users),
    { ids: [1, 4], query: 'Horror, unwatched' }
  );
  assert.deepEqual(searchPeople(1, [4], 'Horror', users).ids, [1, 4]);
  assert.throws(() => searchPeople(1, [99], 'Horror', users));
  assert.throws(() => searchPeople(1, [], 'unwatched by hidden and I', users));
  assert.throws(() => searchPeople(1, [1, 2, 3, 4, 5, 6], 'Horror', users));
  assert.throws(() =>
    searchPeople(1, [], 'unwatched by ykrn and I', [
      ...users,
      { id: 5, name: 'ykrn' },
    ])
  );
});
test('shared Watch Together exclusions combine all selected watches and ratings only', () => {
  const watched = [
    { userId: 1, type: 'movie' as const, tmdbId: 1 },
    { userId: 4, type: 'tv' as const, tmdbId: 2 },
    { userId: 99, type: 'movie' as const, tmdbId: 3 },
  ];
  const ratings = [
    {
      userId: 4,
      type: 'movie' as const,
      tmdbId: 4,
      rating: 4,
      date: '2026-01-01',
    },
  ];
  assert.deepEqual([...togetherSeen([1, 4], ratings, watched)].sort(), [
    'movie:1',
    'movie:4',
    'tv:2',
  ]);
});
test('usage logs retain counts, not arbitrary provider fields; cache zero and unknown distinct', (t) => {
  const log = t.mock.method(
    logger as unknown as {
      info: (message: string, metadata: Record<string, unknown>) => unknown;
    },
    'info',
    () => logger
  );
  recordAiSearchUsage(1, 'model', 'completed', {
    input_tokens: 10,
    output_tokens: 5,
    total_tokens: 15,
    secret: 'do not log',
    input_tokens_details: { cached_tokens: 3 },
  });
  const row = log.mock.calls[0].arguments[1] as Record<string, unknown>;
  assert.equal(row.totalTokens, 15);
  assert(!JSON.stringify(row).includes('do not log'));
  recordAiSearchUsage(1, 'model', 'cache');
  assert.equal(
    (log.mock.calls[1].arguments[1] as Record<string, unknown>).totalTokens,
    0
  );
  recordAiSearchUsage(1, 'model', 'provider_error');
  assert.equal(
    (log.mock.calls[2].arguments[1] as Record<string, unknown>).totalTokens,
    null
  );
});

test('selector edits override names in the original prompt without changing cached interpretation', () => {
  assert.deepEqual(
    searchPeople(1, [], 'Horror, unwatched by ykrn and I', users, false),
    { ids: [1], query: 'Horror, unwatched' }
  );
  assert.throws(() => searchPeople(1, [99], 'Horror', users, false));
});
