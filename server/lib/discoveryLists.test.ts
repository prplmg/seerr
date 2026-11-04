import assert from 'node:assert/strict';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { it } from 'node:test';
import { curatedLists } from './curatedLists';
import {
  cleanFilms,
  noteVideo,
  listId,
  replaceList,
  setListSaved,
  visibleList,
  type DiscoveryList,
  type ListStore,
} from './discoveryLists';
import {
  catalogueTasteRatings,
  diversify,
  latestRatings,
  listProgress,
  recommend,
  tasteNeighbours,
  type TasteRating,
} from './discoveryRecommendations';

const now = Date.parse('2026-10-22T18:00:00Z');
const film = (tmdbId: number) => ({ type: 'movie' as const, tmdbId });
const list = (patch: Partial<DiscoveryList> = {}): DiscoveryList => ({
  id: listId('https://letterboxd.com/test/list/example/'),
  title: 'Example',
  description: '',
  creator: 'test',
  source: 'letterboxd',
  ownerId: 1,
  visibility: 'unknown',
  checkedAt: now,
  items: [film(1), film(2)],
  history: [],
  ...patch,
});
const store = (): ListStore => ({
  version: 1,
  lists: [],
  saved: {},
  liked: {},
  availability: {},
});
it('current removed Letterboxd ratings supersede historical diaries, matching the community rating', () => {
  const row = {
    id: 'diary',
    userId: 1,
    mediaType: 'movie',
    tmdbId: 10,
    episodeNumber: null,
    seasonNumber: null,
    source: 'letterboxd',
    entryKind: 'diary',
    rating: 5,
    publishedAt: '2026-10-01',
    updatedAt: '2026-10-22',
  };
  assert.deepEqual(
    catalogueTasteRatings([
      row,
      {
        ...row,
        id: 'summary',
        entryKind: 'summary',
        rating: null,
        publishedAt: '2026-10-20',
      },
    ] as any),
    []
  );
  const result = catalogueTasteRatings([
    row,
    {
      ...row,
      id: 'local',
      source: 'local',
      rating: 2,
      updatedAt: '2026-10-21',
    },
  ] as any);
  assert.equal(result.length, 1);
  assert.equal(result[0].rating, 2);
});
it('private and unverified imports are visible only to their owner', () => {
  for (const visibility of ['unknown', 'private'] as const) {
    assert.equal(visibleList(list({ visibility }), 1, now), true);
    assert.equal(visibleList(list({ visibility }), 2, now), false);
  }
  assert.equal(visibleList(list({ visibility: 'public' }), 2, now), true);
  assert.equal(
    visibleList(
      list({ visibility: 'public', checkedAt: now - 86400000 }),
      2,
      now
    ),
    false
  );
  assert.equal(visibleList(list({ unavailable: true }), 1, now), false);
});
it('deduplicates mapped media without confusing films and series, preserves notes and order', () => {
  assert.deepEqual(
    cleanFilms([
      { ...film(2), note: 'first' },
      film(2),
      { type: 'tv', tmdbId: 2 },
      film(1),
    ]),
    [{ ...film(2), note: 'first' }, { type: 'tv', tmdbId: 2 }, film(1)]
  );
  assert.throws(() => cleanFilms([film(-1)]));
  assert.throws(() => cleanFilms(Array(10001).fill(film(1))));
});
it('snapshots are monotonic and idempotent, including verified empty lists', () => {
  const s = store();
  replaceList(s, list(), now);
  replaceList(s, list(), now + 1);
  assert.equal(s.lists[0].history.length, 1);
  replaceList(s, list({ items: [] }), now + 2);
  assert.equal(s.lists[0].items.length, 0);
  replaceList(s, list(), now - 1);
  assert.equal(s.lists[0].items.length, 0);
  assert.equal(s.lists[0].history.length, 2);
});
it('bookmarks are private, idempotent, removable when inaccessible, and do not grant ownership', () => {
  const s = store();
  s.lists = [list({ visibility: 'public' })];
  setListSaved(s, 2, s.lists[0].id, true, now);
  setListSaved(s, 2, s.lists[0].id, true, now);
  assert.equal(s.saved[2].length, 1);
  assert.equal(s.saved[1], undefined);
  assert.equal(s.lists[0].ownerId, 1);
  s.lists[0].visibility = 'private';
  assert.throws(() => setListSaved(s, 3, s.lists[0].id, true, now));
  setListSaved(s, 2, s.lists[0].id, false, now);
  assert.deepEqual(s.saved[2], []);
  assert.deepEqual(s.liked, {});
});
it('curated lists can be saved without any Letterboxd account', () => {
  const s = store();
  setListSaved(s, 9, 'curated-' + curatedLists[0].id, true, now);
  assert.equal(s.saved[9].length, 1);
});
it('latest ratings compare actual timestamps, ignore invalid values, and distinguish users and media', () => {
  const a: TasteRating = {
    ...film(1),
    userId: 1,
    rating: 1,
    date: '2026-10-22T12:00:00-06:00',
  };
  const b = { ...a, rating: 5, date: '2026-10-22T17:00:00Z' };
  assert.deepEqual(
    latestRatings([a, b, { ...a, rating: 9 }, { ...a, date: 'invalid' }]),
    [a]
  );
  assert.equal(
    latestRatings([a, { ...a, userId: 2 }, { ...a, type: 'tv' }]).length,
    3
  );
});
const ratings: TasteRating[] = Array.from({ length: 6 }, (_, i) =>
  [1, 2, 3].map((userId) => ({
    ...film(i + 1),
    userId,
    rating: userId === 3 ? 5 - i * 0.5 : 1 + i * 0.5,
    date: '2026-10-21T00:00:00Z',
  }))
).flat();
it('taste matching needs five shared ratings and discounts low overlap; inverse tastes are not neighbours', () => {
  const ns = tasteNeighbours(1, ratings);
  assert.equal(ns.length, 1);
  assert.equal(ns[0].userId, 2);
  assert.equal(ns[0].overlap, 6);
  assert.ok(ns[0].similarity < 0.4);
  assert.deepEqual(
    tasteNeighbours(
      1,
      ratings.filter((r) => r.tmdbId < 5)
    ),
    []
  );
  assert.deepEqual(
    tasteNeighbours(
      1,
      ratings.map((r) => ({ ...r, rating: 4 }))
    ),
    []
  );
});
it('recommendations exclude watched and rated entries, dedup, and have a cold-start fallback', () => {
  const result = recommend(
    [1],
    ratings,
    [{ ...film(10), userId: 1 }],
    [film(1), film(10), film(11), film(11)]
  );
  assert.deepEqual(
    result.map((r) => r.tmdbId),
    [11]
  );
  assert.equal(recommend([99], [], [], [film(11)])[0].score, 3);
});
it('watch-together excludes any participant viewing and uses unique latest votes', () => {
  const rows = [
    ...ratings,
    { ...film(12), userId: 3, rating: 4, date: '2026-10-21T00:00:00Z' },
    { ...film(12), userId: 3, rating: 5, date: '2026-10-22T00:00:00Z' },
  ];
  const result = recommend(
    [1, 2],
    rows,
    [{ ...film(11), userId: 2 }],
    [film(11), film(12)]
  );
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].supporters, [3]);
  assert.ok(Number.isFinite(result[0].score));
});
it('progress deduplicates rewatches; undated, future and pre-membership watches cannot create recent activity', () => {
  const l = list({
    history: [
      { at: now - 3 * 86400000, items: [film(1)] },
      { at: now - 86400000, items: [film(1), film(2)] },
    ],
  });
  const result = listProgress(
    l,
    1,
    [
      { ...film(1), userId: 1 },
      { ...film(1), userId: 1, at: now - 2 * 86400000 },
      { ...film(1), userId: 1, at: now - 2 * 86400000 },
      { ...film(2), userId: 1, at: now - 2 * 86400000 },
      { ...film(2), userId: 1, at: now + 1000 },
      { ...film(2), userId: 2, at: now },
    ],
    now
  );
  assert.equal(result.watched, 2);
  assert.equal(result.recent, 1);
  assert.equal(result.remaining, 0);
  assert.equal(
    listProgress(list(), 1, [{ ...film(1), userId: 1 }], now).recent,
    0
  );
});
it('first import can suggest current-list overlap from earlier viewings without inventing watch dates', () => {
  const imported = list({ history: [{ at: now, items: [film(1), film(2)] }] });
  assert.equal(
    listProgress(
      imported,
      1,
      [
        { ...film(1), userId: 1, at: now - 86400000 },
        { ...film(2), userId: 1 },
      ],
      now
    ).recent,
    1
  );
});
it('unmatched list entries remain in totals and cannot count as watched', () => {
  const entry = list({
    items: [film(1)],
    unmatched: [
      {
        url: 'https://letterboxd.com/film/twin-peaks-the-return/',
        title: 'Twin Peaks: The Return',
        year: '2017',
        note: '',
        position: 2,
      },
    ],
  });
  const progress = listProgress(
    entry,
    1,
    [{ ...film(1), userId: 1, at: now }],
    now
  );
  assert.equal(progress.total, 2);
  assert.equal(progress.watched, 1);
  assert.equal(progress.remaining, 1);
});
it('large lists have lower activity scores; diversity changes rank without dropping films', () => {
  const watches = [{ ...film(1), userId: 1, at: now }];
  const small = list({ source: 'curated' }),
    large = list({
      source: 'curated',
      items: Array.from({ length: 1000 }, (_, i) => film(i + 1)),
    });
  assert.ok(
    listProgress(small, 1, watches, now).activityScore >
      listProgress(large, 1, watches, now).activityScore
  );
  const ranked = [
    { ...film(1), score: 4 },
    { ...film(2), score: 4 },
    { ...film(3), score: 3.99 },
  ];
  assert.deepEqual(
    diversify(ranked, [small]).map((f) => f.tmdbId),
    [1, 3, 2]
  );
  assert.deepEqual(diversify(ranked, [large]), ranked);
});

it('extracts a single YouTube watch URL and discards tracking and unrelated text', () => {
  assert.equal(noteVideo('youtu.be/rPt-xdufDUs?si=abc'), 'https://www.youtube.com/watch?v=rPt-xdufDUs');
  assert.equal(noteVideo('https://www.youtube.com/watch?v=rPt-xdufDUs'), 'https://www.youtube.com/watch?v=rPt-xdufDUs');
  assert.equal(noteVideo('Trailer: youtu.be/rPt-xdufDUs'), undefined);
  assert.equal(noteVideo('https://youtube.com.example/watch?v=rPt-xdufDUs'), undefined);
});
