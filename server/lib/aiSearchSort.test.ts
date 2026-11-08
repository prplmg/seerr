import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AiFilters } from './aiSearchPlan';
import { parseAiSort, sortSearchResults, suggestAiSort } from './aiSearchSort';
const base: AiFilters = {
  type: 'movie',
  available: false,
  unwatched: false,
  maxRuntime: null,
  yearFrom: null,
  yearTo: null,
  genres: [],
};
test('explicit order wins; neutral ranges remain relevance; clear clues infer direction', () => {
  assert.deepEqual(
    suggestAiSort('sci fi rated at least 4', {
      ...base,
      minLetterboxdRating: 4,
    }),
    [{ field: 'rating', direction: 'desc' }]
  );
  assert.deepEqual(
    suggestAiSort('bad movies rated below 2', {
      ...base,
      maxLetterboxdRating: 2,
    }),
    [{ field: 'rating', direction: 'asc' }]
  );
  assert.deepEqual(
    suggestAiSort('movies from the 2010s', {
      ...base,
      yearFrom: 2010,
      yearTo: 2019,
    }),
    []
  );
  assert.deepEqual(
    suggestAiSort('between 3.5 and 4.5', {
      ...base,
      minLetterboxdRating: 3.5,
      maxLetterboxdRating: 4.5,
    }),
    []
  );
  assert.deepEqual(
    suggestAiSort('short highly rated movies', { ...base, maxRuntime: 90 }),
    [{ field: 'rating', direction: 'desc' }]
  );
  assert.deepEqual(suggestAiSort('recent horror', base), [
    { field: 'year', direction: 'desc' },
  ]);
  assert.deepEqual(
    suggestAiSort(
      'sci fi at least 4 sorted by runtime longest first, then score',
      { ...base, minLetterboxdRating: 4 }
    ),
    [
      { field: 'runtime', direction: 'desc' },
      { field: 'rating', direction: 'desc' },
    ]
  );
  assert.deepEqual(
    suggestAiSort('recent movies sorted by best match', base),
    []
  );
});
test('missing values last, stable relevance ties, secondary order and no mutation', () => {
  const rows = [
    { media: { releaseDate: '2020-01-01' }, letterboxdRating: 4, id: 1 },
    { media: { releaseDate: '2020-01-01' }, letterboxdRating: 5, id: 2 },
    { media: {}, letterboxdRating: 5, id: 3 },
    { media: { releaseDate: '2010-01-01' }, id: 4 },
    { media: { releaseDate: '2020-01-01' }, letterboxdRating: 5, id: 5 },
  ];
  assert.deepEqual(
    sortSearchResults(rows, [
      { field: 'year', direction: 'desc' },
      { field: 'rating', direction: 'desc' },
    ]).map((r) => r.id),
    [2, 5, 1, 4, 3]
  );
  assert.deepEqual(
    sortSearchResults(rows, [{ field: 'rating', direction: 'asc' }]).map(
      (r) => r.id
    ),
    [1, 2, 3, 5, 4]
  );
  assert.deepEqual(sortSearchResults(rows, []), rows);
  assert.deepEqual(
    rows.map((r) => r.id),
    [1, 2, 3, 4, 5]
  );
  for (const value of [
    [{ field: 'bogus', direction: 'asc' }],
    [
      { field: 'year', direction: 'asc' },
      { field: 'year', direction: 'desc' },
    ],
    null,
  ])
    assert.throws(() => parseAiSort(value));
});
