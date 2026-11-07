import axios from 'axios';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  matchesAiFilters,
  normalizedTitle,
  parseAiPlan,
  type AiFilters,
} from './aiSearchPlan';
import { AI_SEARCH_MODEL, interpretAiSearch } from './aiSearchProvider';
const filters: AiFilters = {
  type: 'movie',
  available: false,
  unwatched: false,
  maxRuntime: null,
  yearFrom: null,
  yearTo: null,
  genres: [],
};
const plan = {
  filters,
  suggestions: [
    {
      title: 'Arrival',
      year: 2016,
      reason: 'Patient first contact and human connection',
    },
  ],
  note: '',
};
test('rejects malformed plans and unsafe constraints', () => {
  for (const value of [
    null,
    {},
    { ...plan, filters: { ...filters, type: 'person' } },
    { ...plan, filters: { ...filters, genres: [999] } },
    { ...plan, filters: { ...filters, maxRuntime: -1 } },
    { ...plan, filters: { ...filters, yearFrom: 2020, yearTo: 1990 } },
    { ...plan, suggestions: Array(17).fill(plan.suggestions[0]) },
    {
      ...plan,
      suggestions: [{ ...plan.suggestions[0], reason: 'one '.repeat(11) }],
    },
  ])
    assert.throws(() => parseAiPlan(value));
  assert.deepEqual(parseAiPlan(plan), plan);
  assert.equal(normalizedTitle('Amélie!'), normalizedTitle('Amelie'));
});
test('hard constraints never accept unknown runtime or watched/unavailable titles', () => {
  const f = {
    ...filters,
    available: true,
    unwatched: true,
    maxRuntime: 100,
    yearFrom: 2000,
    yearTo: 2020,
    genres: [878],
  };
  const item = {
    available: true,
    watched: false,
    runtime: 90,
    year: 2010,
    genres: [878],
  };
  assert.equal(matchesAiFilters(f, item), true);
  for (const change of [
    { available: false },
    { watched: true },
    { runtime: null },
    { runtime: 101 },
    { year: 1999 },
    { genres: [] },
  ])
    assert.equal(matchesAiFilters(f, { ...item, ...change }), false);
});
test('provider uses server secret, caches per user, and sanitizes upstream failures', async (t) => {
  const original = process.env.OPENAI_API_KEY;
  t.after(() => {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  });
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(interpretAiSearch(98701, 'test'), { status: 503 });
  process.env.OPENAI_API_KEY = 'test-only-not-a-real-key';
  const post = t.mock.method(
    axios,
    'post',
    async (
      _url: string,
      body: Record<string, unknown>,
      options: { headers: { Authorization: string } }
    ) => {
      assert.equal(body.model, AI_SEARCH_MODEL);
      assert.equal(body.store, false);
      const messages = body.input as { role: string; content: string }[];
      assert.equal(messages[0].role, 'developer');
      assert.match(messages[0].content, /JSON/);
      assert.equal(messages[1].role, 'user');
      assert.equal(messages[1].content, 'test');
      assert.equal(
        options.headers.Authorization,
        'Bearer test-only-not-a-real-key'
      );
      return {
        data: {
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify(plan) }],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 20 },
        },
      };
    }
  );
  assert.equal((await interpretAiSearch(98701, 'test')).cached, false);
  assert.equal((await interpretAiSearch(98701, 'test')).cached, true);
  assert.equal(post.mock.callCount(), 1);
  await interpretAiSearch(98702, 'test');
  assert.equal(post.mock.callCount(), 2);
  post.mock.mockImplementation(async () => {
    throw Error('SECRET should never escape');
  });
  await assert.rejects(
    interpretAiSearch(98701, 'failure'),
    (error: Error) =>
      !error.message.includes('SECRET') &&
      error.message.includes('could not interpret')
  );
  post.mock.mockImplementation(async () => ({
    data: {
      status: 'incomplete',
      output: [],
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  }));
  await assert.rejects(interpretAiSearch(98701, 'incomplete'), { status: 502 });
});
