import {
  exactMovieChoice,
  parseMovieLine,
} from '@server/interfaces/api/catalogueLists';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  deleteCatalogueList,
  editableCatalogueList,
  ownedCatalogueList,
  saveCatalogueList,
  shareCatalogueList,
  validateCatalogueList,
} from './catalogueLists';
import { visibleList, type ListStore } from './discoveryLists';
const store = (): ListStore => ({
  version: 1,
  lists: [],
  saved: {},
  liked: {},
  availability: {},
});
const body = {
  title: ' Night movies ',
  description: ' A description ',
  movieIds: [329865, 438631],
};
it('parses optional years, bullets and numbered lines without corrupting numeric titles', () => {
  assert.deepEqual(parseMovieLine(' 1. Arrival (2016) '), {
    title: 'Arrival',
    year: '2016',
  });
  assert.deepEqual(parseMovieLine('• Dune 1984'), {
    title: 'Dune',
    year: '1984',
  });
  assert.deepEqual(parseMovieLine('1917'), { title: '1917', year: '' });
  assert.deepEqual(parseMovieLine('2001: A Space Odyssey'), {
    title: '2001: A Space Odyssey',
    year: '',
  });
});
it('only auto-selects a unique exact title/year, never fuzzy or incomplete results', () => {
  const movies = [
    { id: 1, title: 'Dune', year: '1984', poster: null },
    { id: 2, title: 'Dune', year: '2021', poster: null },
  ];
  assert.equal(exactMovieChoice('Dune', movies, 2), undefined);
  assert.equal(exactMovieChoice('Dune (2021)', movies, 2)?.id, 2);
  assert.equal(exactMovieChoice('Dun', movies.slice(0, 1), 1), undefined);
  assert.equal(exactMovieChoice('Dune', movies.slice(0, 1), 25), undefined);
  assert.equal(exactMovieChoice('Dune (2020)', movies, 2), undefined);
});
it('creates public catalogue-owned lists preserving order, without LB URLs or expiry', () => {
  const s = store();
  const list = saveCatalogueList(s, 7, 'prplmg', body, undefined, 1000);
  assert.equal(list.title, 'Night movies');
  assert.equal(list.description, 'A description');
  assert.equal(list.source, 'catalogue');
  assert.equal(list.ownerId, 7);
  assert.equal('url' in list, false);
  assert.deepEqual(
    list.items.map((f) => f.tmdbId),
    body.movieIds
  );
  assert.equal(visibleList(list, 8, 9999999999999), true);
  assert.deepEqual(s.saved, { 7: [list.id] });
  assert.deepEqual(s.liked, {});
});
it('rejects other owners and imported/curated list edits', () => {
  const s = store();
  const l = saveCatalogueList(s, 7, 'User', body);
  assert.throws(() => ownedCatalogueList(s, 8, l.id), /not found/);
  s.lists[0].source = 'letterboxd';
  assert.throws(() => ownedCatalogueList(s, 7, l.id), /not found/);
  s.lists[0].source = 'curated';
  assert.throws(() => ownedCatalogueList(s, 7, l.id), /not found/);
});
it('edits preserve identity/bookmarks/history and prevent stale or missing revisions', () => {
  const s = store();
  const l = saveCatalogueList(s, 7, 'User', body, undefined, 1000);
  s.saved[8] = [l.id];
  const edited = saveCatalogueList(
    s,
    7,
    'User',
    { ...body, revision: 1000, movieIds: [438631] },
    l.id,
    1000
  );
  assert.equal(edited.id, l.id);
  assert.equal(edited.checkedAt, 1001);
  assert.equal(edited.history.length, 2);
  assert.deepEqual(s.saved[8], [l.id]);
  assert.throws(
    () => saveCatalogueList(s, 7, 'User', { ...body, revision: 1000 }, l.id),
    /another tab/
  );
  assert.throws(
    () => saveCatalogueList(s, 7, 'User', body, l.id),
    /another tab/
  );
});
it('validates IDs, limits, duplicates and metadata before any write', () => {
  for (const patch of [
    { title: '' },
    { title: ' '.repeat(5) },
    { title: 'x'.repeat(201) },
    { description: null },
    { movieIds: [] },
    { movieIds: [1, 1] },
    { movieIds: [0] },
    { movieIds: ['1'] },
    { movieIds: [1.5] },
    { movieIds: Array.from({ length: 201 }, (_, i) => i + 1) },
  ])
    assert.throws(() => validateCatalogueList({ ...body, ...patch }));
  assert.throws(() => validateCatalogueList(null));
});
it('private lists stay owner-only and revision-checked deletion revokes visibility and bookmarks', () => {
  const s = store();
  const list = saveCatalogueList(
    s,
    7,
    'User',
    { ...body, visibility: 'private' },
    undefined,
    1000
  );
  assert(visibleList(list, 7));
  assert.equal(visibleList(list, 8), false);
  assert.throws(() =>
    saveCatalogueList(s, 7, 'User', { ...body, visibility: 'unknown' })
  );
  const shared = saveCatalogueList(
    s,
    7,
    'User',
    { ...body, visibility: 'public', revision: 1000 },
    list.id,
    2000
  );
  assert(visibleList(shared, 8));
  s.saved[8] = [list.id, 'other'];
  assert.throws(() => deleteCatalogueList(s, 8, list.id, 2000), /not found/);
  assert.throws(() => deleteCatalogueList(s, 7, list.id, 1000), /another tab/);
  deleteCatalogueList(s, 7, list.id, 2000, 3000);
  assert.equal(visibleList(shared, 7), false);
  assert.equal(visibleList(shared, 8), false);
  assert.deepEqual(s.saved[8], ['other']);
  assert.equal(shared.items.length, 2);
  assert.throws(() => ownedCatalogueList(s, 7, list.id), /not found/);
});

it('created lists start saved; explicit unsaving survives edits and legacy normalization', async () => {
  const { initializeCreatedBookmarks, personalList, setListSaved } =
    await import('./discoveryLists');
  const s = store(),
    l = saveCatalogueList(s, 7, 'User', body);
  assert.equal(personalList(l, s, 7), true);
  setListSaved(s, 7, l.id, false);
  assert.equal(personalList(l, s, 7), false);
  const edited = saveCatalogueList(
    s,
    7,
    'User',
    { ...body, revision: l.checkedAt },
    l.id
  );
  initializeCreatedBookmarks(s);
  assert.equal(personalList(edited, s, 7), false);
  setListSaved(s, 7, l.id, true);
  assert.equal(personalList(edited, s, 7), true);
  const legacy = store();
  legacy.lists.push({ ...l, id: 'old-created' });
  initializeCreatedBookmarks(legacy);
  assert.deepEqual(legacy.saved[7], ['old-created']);
  assert.equal(legacy.saved[8], undefined);
  setListSaved(legacy, 7, 'old-created', false);
  initializeCreatedBookmarks(legacy);
  assert.deepEqual(legacy.saved[7], []);
});

it('sharing grants private access without saving; editors preserve owner and cannot escalate', async () => {
  const { personalList } = await import('./discoveryLists');
  const s = store();
  let l = saveCatalogueList(
    s,
    7,
    'Owner',
    { ...body, visibility: 'private' },
    undefined,
    1000
  );
  shareCatalogueList(
    s,
    7,
    l.id,
    l.checkedAt,
    { 8: 'viewer', 9: 'editor' },
    2000
  );
  assert(visibleList(l, 8));
  assert(visibleList(l, 9));
  assert(!visibleList(l, 10));
  assert(!personalList(l, s, 8));
  assert(!personalList(l, s, 9));
  assert.throws(() => editableCatalogueList(s, 8, l.id));
  assert.equal(editableCatalogueList(s, 9, l.id).id, l.id);
  assert.throws(() =>
    shareCatalogueList(s, 9, l.id, l.checkedAt, { 10: 'editor' })
  );
  assert.throws(() => deleteCatalogueList(s, 9, l.id, l.checkedAt));
  assert.throws(
    () =>
      saveCatalogueList(
        s,
        9,
        'Editor',
        { ...body, revision: l.checkedAt, visibility: 'public' },
        l.id
      ),
    /Only the owner/
  );
  const version = l.checkedAt;
  l = saveCatalogueList(
    s,
    9,
    'Editor',
    { ...body, title: 'Edited', revision: version },
    l.id,
    3000
  );
  assert.equal(l.ownerId, 7);
  assert.equal(l.creator, 'Owner');
  assert.equal(l.visibility, 'private');
  assert.equal(l.collaborators?.[8], 'viewer');
  assert.throws(
    () =>
      saveCatalogueList(s, 7, 'Owner', { ...body, revision: version }, l.id),
    /another editor/
  );
  assert.throws(() => shareCatalogueList(s, 7, l.id, version, {}), /changed/);
  const draftVersion = l.checkedAt;
  shareCatalogueList(s, 7, l.id, l.checkedAt, { 8: 'viewer' }, 4000);
  assert(!visibleList(l, 9));
  assert.throws(
    () =>
      saveCatalogueList(
        s,
        9,
        'Editor',
        { ...body, revision: draftVersion },
        l.id
      ),
    /not found/
  );
  assert.throws(
    () => shareCatalogueList(s, 7, l.id, l.checkedAt, { 7: 'editor' }),
    /Invalid/
  );
  assert.throws(
    () =>
      shareCatalogueList(s, 7, l.id, l.checkedAt, { '9': 'owner' } as never),
    /Invalid/
  );
  deleteCatalogueList(s, 7, l.id, l.checkedAt, 5000);
  assert(!visibleList(l, 8));
});
