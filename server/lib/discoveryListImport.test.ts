import assert from 'node:assert/strict';
// Isolated transpiled-module harness: boundary mocks are deliberately untyped.
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';
import * as lists from './discoveryLists';
import * as csv from './letterboxdImport';
const runtimeRequire = createRequire(__filename);

const example =
  'Letterboxd list export v7\nDate,Name,Tags,URL,Description\n2026-10-22,"My, list",,https://letterboxd.com/alice/list/test/,"Two\nparagraphs"\n\nPosition,Name,Year,URL,Description\n1,Jaws,1975,https://letterboxd.com/film/jaws/,"A note"\n';
function harness() {
  let enabled = true,
    filmHtml = '',
    resolve = true,
    network = 0;
  const files = new Map([
    ['lists/test.csv', example],
    ['likes/lists.csv', 'Date,Content\n2026-10-22,https://boxd.it/abc\n'],
  ]);
  const store: lists.ListStore = {
    version: 1,
    lists: [],
    saved: {},
    liked: {},
    availability: {},
  };
  let responses: unknown[] = [
    {
      status: 200,
      data: '<div class="list-title">Test</div><a href="export/">Export</a>',
      headers: {},
    },
    { status: 200, data: example },
  ];
  const api: any = {};
  const output = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, 'discoveryListImport.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  ).outputText;
  new Function('require', 'exports', output)((name: string) => {
    if (name === './discoveryBrowser')
      return { queueBrowserList: () => 'fixture-job' };
    if (name === 'axios')
      return {
        head: async () => {
          network++;
          const r = responses.shift();
          if (r instanceof Error) throw r;
          if (!r) throw Error('No redirect response');
          return r;
        },
        get: async () => {
          network++;
          const r = responses.shift();
          if (r instanceof Error) throw r;
          if (!r) throw Error('No fixture response');
          return r;
        },
      };
    if (name === '@server/logger') return { info: () => {}, warn: () => {} };
    if (name === './discoveryLists')
      return {
        ...lists,
        discoveryEnabled: () => enabled,
        readListStore: () => store,
        updateListStore: (f: any) => {
          const copy = structuredClone(store);
          const r = f(copy);
          Object.assign(store, copy);
          return r;
        },
      };
    if (name === './letterboxdArchive')
      return { readLetterboxdArchive: async () => files };
    if (name === './letterboxdExportSnapshot')
      return {
        parseExportSnapshot: (_files: unknown, account: string) => {
          if (account !== 'alice') throw Error('Wrong archive account');
        },
      };
    if (name === './letterboxdImport') return csv;
    if (name === './reviews')
      return {
        fetchLetterboxd: async () => filmHtml,
        resolveReview: async (entry: { externalUrl: string }) =>
          resolve
            ? entry.externalUrl.includes('/alien/')
              ? 456
              : 123
            : undefined,
      };
    return runtimeRequire(name);
  }, api);
  return {
    api,
    store,
    files,
    setEnabled: (v: boolean) => {
      enabled = v;
    },
    setResolve: (v: boolean) => {
      resolve = v;
    },
    setFilmHtml: (v: string) => {
      filmHtml = v;
    },
    respond: (v: unknown[]) => {
      responses = v;
    },
    calls: () => network,
  };
}
it('strictly parses v7, multiline notes, order, empty lists, and owner identity', () => {
  const h = harness(),
    p = h.api.parseOwnedList(example, 'alice');
  assert.equal(p.title, 'My, list');
  assert.equal(p.items[0].note, 'A note');
  assert.equal(
    h.api.parseOwnedList(example.slice(0, example.indexOf('\n1,Jaws')), 'alice')
      .items.length,
    0
  );
  for (const bad of [
    example.replace('v7', 'v8'),
    example.replace('1,Jaws', '2,Jaws'),
    example.replace('/film/jaws/', '/settings/'),
    example.replace('alice', 'bob'),
  ])
    assert.throws(() => h.api.parseOwnedList(bad, 'alice'));
});
it('rejects URL credentials, arbitrary hosts, paths, queries and unsafe redirects', async () => {
  const h = harness();
  for (const bad of [
    'http://letterboxd.com/a/list/b/',
    'https://letterboxd.com.evil.test/a/list/b/',
    'https://u:p@letterboxd.com/a/list/b/',
    'https://letterboxd.com/a/list/b/?x=1',
    'https://127.0.0.1/a/list/b/',
    'https://letterboxd.com/film/jaws/',
  ])
    assert.throws(() => h.api.safeListUrl(bad, true));
  h.respond([
    { status: 302, headers: { location: 'https://localhost/admin' } },
  ]);
  await assert.rejects(h.api.importPublicList('https://boxd.it/abc'));
  assert.equal(h.calls(), 1);
  assert.equal(h.store.lists.length, 0);
});
it('real export short links resolve ownership safely and preserve film references', async () => {
  const h = harness();
  h.files.set(
    'lists/test.csv',
    example
      .replace(
        'https://letterboxd.com/alice/list/test/',
        'https://boxd.it/Usz9e'
      )
      .replace('https://letterboxd.com/film/jaws/', 'https://boxd.it/10Sy')
  );
  h.respond([
    {
      status: 302,
      headers: { location: 'https://letterboxd.com/alice/list/test/' },
    },
  ]);
  await h.api.importDiscoveryExport(1, 'alice', 'zip', 100);
  assert.equal(h.store.lists[0].ownerId, 1);
  assert.equal(h.store.lists[0].url, 'https://letterboxd.com/alice/list/test/');
  const previous = JSON.stringify(h.store);
  for (const location of [
    'https://localhost/admin',
    'https://letterboxd.com/bob/list/test/',
    'https://boxd.it/another',
  ]) {
    h.respond([{ status: 302, headers: { location } }]);
    await assert.rejects(h.api.importDiscoveryExport(1, 'alice', 'zip', 200));
    assert.equal(JSON.stringify(h.store), previous);
  }
});
it('UI-disabled users still import owned lists without exposing them publicly', async () => {
  const h = harness();
  h.setEnabled(false);
  await h.api.importDiscoveryExport(1, 'alice', 'zip', 100);
  assert.equal(h.calls(), 0);
  assert.equal(h.store.lists.length, 1);
  assert.equal(h.store.lists[0].visibility, 'unknown');
});
it('owned export and liked references remain separate; missing lists and stale exports reconcile safely', async () => {
  const h = harness();
  await h.api.importDiscoveryExport(1, 'alice', 'zip', 100);
  assert.equal(h.store.lists[0].visibility, 'unknown');
  assert.equal(h.store.lists[0].ownerId, 1);
  assert.deepEqual(h.store.liked[1], ['https://boxd.it/abc']);
  assert.deepEqual(h.store.saved, {});
  h.files.delete('lists/test.csv');
  h.store.lists.push({
    ...h.store.lists[0],
    id: 'catalogue-test',
    source: 'catalogue',
    url: undefined,
  });
  await h.api.importDiscoveryExport(1, 'alice', 'zip', 200);
  assert.equal(h.store.lists[0].unavailable, true);
  assert.equal(
    h.store.lists[1].unavailable,
    undefined,
    'Letterboxd reconciliation must never retire catalogue-created lists'
  );
  h.files.set('lists/test.csv', example);
  await h.api.importDiscoveryExport(1, 'alice', 'zip', 100);
  assert.equal(h.store.lists[0].unavailable, true);
  await assert.rejects(h.api.importDiscoveryExport(1, 'bob', 'zip', 300));
});
it('unresolved films retain the complete previous snapshot rather than truncate a list', async () => {
  const h = harness();
  await h.api.importDiscoveryExport(1, 'alice', 'zip', 100);
  const old = JSON.stringify(h.store);
  h.setResolve(false);
  await assert.rejects(h.api.importDiscoveryExport(1, 'alice', 'zip', 200));
  assert.equal(JSON.stringify(h.store), old);
});
it('public lists retain explicit TMDB-zero entries without inventing IDs; transient failures remain atomic', async () => {
  const h = harness();
  const parsed = h.api.parseOwnedList(example, 'alice');
  h.setResolve(false);
  h.setFilmHtml('<a href="https://www.themoviedb.org/tv/0/">TMDB</a>');
  await h.api.applyPublicList(parsed.url, parsed);
  assert.equal(h.store.lists[0].items.length, 0);
  assert.deepEqual(h.store.lists[0].unmatched, [
    { ...parsed.items[0], position: 1 },
  ]);
  const old = JSON.stringify(h.store);
  for (const html of [
    'Just a moment',
    'No metadata',
    'cf-chl- <a href="https://www.themoviedb.org/tv/0/">TMDB</a>',
  ]) {
    h.setFilmHtml(html);
    await assert.rejects(
      h.api.applyPublicList(parsed.url, parsed),
      /unresolved/
    );
    assert.equal(JSON.stringify(h.store), old);
  }
  h.setResolve(true);
  await h.api.applyPublicList(parsed.url, parsed);
  assert.equal(h.store.lists[0].items.length, 1);
  assert.deepEqual(h.store.lists[0].unmatched, []);
});
it('public import requires public HTML and matching CSV identity, maps short likes, and never sets ownership', async () => {
  const h = harness();
  h.store.liked[1] = ['https://boxd.it/abc'];
  h.respond([
    {
      status: 302,
      headers: { location: 'https://letterboxd.com/alice/list/test/' },
    },
    {
      status: 200,
      headers: {},
      data: '<h1 class="list-title">Test</h1><a href="export/">Export</a>',
    },
    { status: 200, data: example },
  ]);
  await h.api.importPublicList('https://boxd.it/abc');
  assert.equal(h.store.lists[0].visibility, 'public');
  assert.equal(h.store.lists[0].ownerId, undefined);
  assert.deepEqual(h.store.liked[1], [
    'https://letterboxd.com/alice/list/test/',
  ]);
  const old = JSON.stringify(h.store);
  h.respond([{ status: 200, headers: {}, data: 'Just a moment cf-chl-' }]);
  await assert.rejects(
    h.api.importPublicList('https://letterboxd.com/alice/list/test/')
  );
  assert.equal(JSON.stringify(h.store), old);
});
it('refresh failures revoke external visibility and preserve owner access without deleting data', async () => {
  const h = harness();
  await h.api.importDiscoveryExport(1, 'alice', 'zip', 100);
  h.store.lists[0].visibility = 'public';
  h.respond([Error('offline')]);
  await h.api.refreshDiscoveryLists();
  assert.equal(h.store.lists[0].visibility, 'unknown');
  assert.equal(h.store.lists[0].items.length, 1);
  assert.equal(h.store.lists[0].unavailable, undefined);
});
it('public HTML pagination must reach the advertised total; incomplete scans retain previous data', async () => {
  const root = 'https://letterboxd.com/alice/list/test/';
  const html = (slug: string, next = '') =>
    `<link rel="canonical" href="${root}"><meta name="description" content="A list of 2 films"><h1 class="list-title">Example</h1><ul class="poster-list"><li><div data-film-slug="${slug}"></div></li></ul>${next ? `<a rel="next" href="${next}">Next</a>` : ''}`;
  const h = harness();
  h.respond([
    { status: 200, headers: {}, data: html('jaws', 'page/2/') },
    { status: 200, data: html('alien') },
  ]);
  await h.api.importPublicList(root);
  assert.equal(h.store.lists[0].items.length, 2);
  assert.equal(h.calls(), 2);
  const previous = JSON.stringify(h.store);
  h.respond([{ status: 200, headers: {}, data: html('jaws') }]);
  await assert.rejects(h.api.importPublicList(root), /Incomplete/);
  assert.equal(JSON.stringify(h.store), previous);
  h.respond([
    { status: 200, headers: {}, data: html('jaws', 'page/2/') },
    { status: 200, data: 'Just a moment' },
  ]);
  await assert.rejects(h.api.importPublicList(root));
  assert.equal(JSON.stringify(h.store), previous);
});
it('a canonical redirect migrates bookmarks and ownership instead of duplicating the list', async () => {
  const h = harness();
  await h.api.importDiscoveryExport(1, 'alice', 'zip', 100);
  const old = h.store.lists[0].id;
  h.store.saved[2] = [old];
  h.respond([
    {
      status: 302,
      headers: { location: 'https://letterboxd.com/alice/list/renamed/' },
    },
    {
      status: 200,
      headers: {},
      data: '<h1 class="list-title">Renamed</h1><a href="export/">Export</a>',
    },
    { status: 200, data: example.replace('/list/test/', '/list/renamed/') },
  ]);
  const id = await h.api.importPublicList(
    'https://letterboxd.com/alice/list/test/'
  );
  assert.equal(h.store.lists.length, 1);
  assert.equal(h.store.lists[0].ownerId, 1);
  assert.notEqual(id, old);
  assert.deepEqual(h.store.saved[2], [id]);
});

it('explicit empty TMDB identity retains unmatched entries, but challenge pages never qualify', async () => {
  const h = harness();
  h.setResolve(false);
  const parsed = h.api.parseOwnedList(example, 'alice');
  h.setFilmHtml(
    '<title>Known film</title><div data-tmdb-type="movie" data-tmdb-id="">'
  );
  await h.api.applyPublicList(parsed.url, parsed);
  assert.equal(h.store.lists[0].unmatched?.length, 1);
  assert.equal(h.store.lists[0].items.length, 0);
  const previous = JSON.stringify(h.store);
  h.setFilmHtml('Just a moment <div data-tmdb-type="movie" data-tmdb-id="">');
  await assert.rejects(h.api.applyPublicList(parsed.url, parsed));
  assert.equal(JSON.stringify(h.store), previous);
});

it('owned list export also retains explicitly unmapped titles rather than blocking the account import', async () => {
  const h = harness();
  h.setResolve(false);
  h.setFilmHtml('<div data-tmdb-type="movie" data-tmdb-id="">');
  await h.api.importDiscoveryExport(1, 'alice', 'zip', 100);
  assert.equal(h.store.lists[0].ownerId, 1);
  assert.equal(h.store.lists[0].unmatched?.length, 1);
  assert.equal(h.store.lists[0].items.length, 0);
});
