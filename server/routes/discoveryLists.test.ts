import express from 'express';
import * as validator from 'express-openapi-validator';
import assert from 'node:assert/strict';
// Isolated transpiled-module harness: boundary mocks are deliberately untyped.
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';
const runtimeRequire = createRequire(__filename);

async function harness(failImport = false, requester = 1, requestStatus = 2) {
  let enabled = false,
    reads = 0,
    saves = 0,
    revoke = false,
    imports = 0,
    requestReads = 0;
  const films = Array.from({ length: 35 }, (_, i) => ({
    type: 'movie',
    tmdbId: i + 1,
  }));
  const l = {
    id: 'curated-test',
    title: 'Test',
    items: films,
    saved: true,
    owned: false,
    liked: false,
  };
  const api: any = {};
  const layoutStore: any = {};
  const viewers: number[] = [];
  const watchlistReads: number[][] = [];
  let rankings = 0;
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, 'discoveryLists.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  ).outputText;
  new Function('require', 'exports', source)((name: string) => {
    if (name === '@server/lib/listSortProgress')
      return {
        sortProgress: {
          read: (_id: string, owner: number, viewer: number) =>
            owner === 1 && viewer === 1
              ? {
                  field: 'rating',
                  state: 'pending',
                  completed: 4,
                  total: 10,
                  unavailable: 1,
                }
              : null,
        },
      };
    if (name === '@server/constants/media')
      return runtimeRequire('../constants/media');
    if (name === '@server/lib/discoveryDatabaseCache')
      return {
        discoveryRequests: async () => {
          requestReads++;
          return [
            {
              id: 1,
              status: requestStatus,
              createdAt: '2026-10-25',
              requestedBy: { id: requester },
              media: { mediaType: 'movie', tmdbId: 2 },
            },
          ];
        },
      };
    if (name === '@server/datasource')
      return {
        getRepository: () => ({
          find: async () => [{ id: 2, displayName: 'Target user' }],
          findOne: async ({ where }: any) =>
            where.id === 2 ? { id: 2, displayName: 'Target user' } : null,
        }),
      };
    if (name === '@server/entity/User') return { User: class {} };
    if (name === '@server/lib/discoveryBrowser')
      return {
        queueBrowserList: () => 'browser-import',
        browserListStatus: (id: string, user: number) =>
          id === 'browser-import' && user === 1
            ? { state: 'queued' }
            : undefined,
      };
    if (name === '@server/lib/discoveryReleases')
      return {
        releasesForUser: async (id: number) => {
          viewers.push(id);
          reads++;
          return { episodes: films, movies: films };
        },
        readReleaseState: () => ({ follows: {} }),
        releaseKey: (type: string, id: number) => `${type}:${id}`,
        setReleaseFollow: () => {
          saves++;
        },
      };
    if (name === '@server/api/themoviedb')
      return class {
        async getMovie() {
          return { runtime: 80 };
        }
      };
    if (name === '@server/lib/discoveryLists')
      return {
        discoveryEnabled: () => enabled,
        filmKey: (f: any) => `${f.type}:${f.tmdbId}`,
        setListSaved: () => {
          saves++;
        },
        readListStore: () => layoutStore,
        updateListStore: (f: any) => f(layoutStore),
      };
    if (name === '@server/lib/discoveryListImport')
      return {
        importPublicList: async () => {
          imports++;
          if (failImport) throw Error('Anonymous fetch blocked');
          return l.id;
        },
      };
    if (name === '@server/lib/discoveryRecommendations')
      return {
        recommend: () => films,
        prioritizeTogether: (rows: any) => rows,
      };
    if (name === '@server/lib/discoveryWatchlists')
      return {
        discoveryWatchlists: async (ids: number[]) => {
          watchlistReads.push(ids);
          return {
            interests: [],
            updating: false,
            unresolved: 0,
          };
        },
      };
    if (name === '@server/lib/discoveryData')
      return {
        discoveryData: async (id: number) => {
          viewers.push(id);
          reads++;
          if (revoke) enabled = false;
          return {
            store: { saved: { 1: ['missing', l.id] }, liked: {} },
            lists: [l],
            mine: [l],
            summary: (x: any) => ({ ...x, items: undefined }),
            available: new Set(['movie:1', 'movie:2']),
            seen: new Set(['movie:1']),
            ratings: [],
            watched: [],
            candidates: films,
            filmHints: () => [],
            users: [
              { id: 1, name: 'One' },
              { id: 2, name: 'Two' },
              { id: 3, name: 'Three' },
            ],
            historyAvailable: true,
            episodeHistory: async () => [],
            visibilityStillValid: () => true,
            feed: {
              get recommendations() {
                rankings++;
                return films;
              },
              available: films,
              newlyAvailable: [],
              friendsLoved: [],
              activity: id === 1 ? [{ list: l, progress: { recent: 2 } }] : [],
              continueLists: id === 1 ? [l] : [],
              almostFinished: id === 1 ? [l] : [],
            },
          };
        },
      };
    return runtimeRequire(name);
  }, api);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.headers['x-test-user'] !== '1') return res.sendStatus(401);
    req.user = {
      id: 1,
      hasPermission: () => req.headers['x-test-admin'] === 'true',
    } as any;
    next();
  });
  app.use(
    validator.middleware({
      apiSpec: path.join(__dirname, '../../seerr-api.yml'),
      validateRequests: true,
      validateSecurity: false,
    })
  );
  app.use('/api/v1/discovery-lists', api.default);
  app.use((e: any, _req: any, res: any, next: any) => {
    void next; // Express identifies error middleware by its four arguments.
    return res.status(e.status || 500).json({ message: e.message });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/discovery-lists`;
  return {
    setEnabled: (v: boolean) => {
      enabled = v;
    },
    revoke: () => {
      revoke = true;
    },
    counts: () => ({ reads, saves, imports }),
    viewers,
    watchlistReads,
    rankings: () => rankings,
    requestReads: () => requestReads,
    request: (
      suffix = '',
      method = 'GET',
      body?: unknown,
      auth = true,
      preview?: string,
      admin = false
    ) =>
      fetch(base + suffix, {
        method,
        headers: {
          ...(auth ? { 'x-test-user': '1' } : {}),
          'content-type': 'application/json',
          ...(preview === undefined
            ? {}
            : { 'X-Discovery-Preview-User': preview }),
          ...(admin ? { 'x-test-admin': 'true' } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    close: () =>
      new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))),
  };
}

it('existing requests are locked follows; explicit follows remain optional and declined requests do not lock', async () => {
  const h = await harness();
  h.setEnabled(true);
  try {
    assert.deepEqual(await (await h.request('/follow/movie/2')).json(), {
      following: true,
      locked: true,
    });
    assert.equal(
      (await h.request('/follow/movie/2', 'PUT', { following: false })).status,
      409
    );
    assert.deepEqual(
      await (
        await h.request('/follow/movie/2', 'PUT', { following: true })
      ).json(),
      { following: true, locked: true }
    );
    assert.equal(h.counts().saves, 0);
    assert.deepEqual(await (await h.request('/follow/tv/2')).json(), {
      following: false,
      locked: false,
    });
    assert.equal(
      (await h.request('/follow/tv/2', 'PUT', { following: false })).status,
      200
    );
  } finally {
    await h.close();
  }
  const declined = await harness(false, 1, 3);
  declined.setEnabled(true);
  try {
    assert.deepEqual(await (await declined.request('/follow/movie/2')).json(), {
      following: false,
      locked: false,
    });
  } finally {
    await declined.close();
  }
  const admin = await harness(false, 2);
  try {
    const result = await (
      await admin.request(
        '/admin/follow/movie/2',
        'GET',
        undefined,
        true,
        undefined,
        true
      )
    ).json();
    assert.equal(result.users[0].following, true);
    assert.equal(result.users[0].locked, true);
    assert.equal(
      (
        await admin.request(
          '/admin/follow/movie/2',
          'PUT',
          { userId: 2, following: false },
          true,
          undefined,
          true
        )
      ).status,
      409
    );
    assert.equal(admin.counts().saves, 0);
  } finally {
    await admin.close();
  }
});

it('independent list rows preserve feed contents without rankings, episode work or picker metadata', async () => {
  const h = await harness();
  h.setEnabled(true);
  try {
    for (const section of ['activity', 'continueLists', 'almostFinished']) {
      const response = await h.request(`/feed?section=${section}`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(
        body.results.map((l: any) => l.id),
        ['curated-test']
      );
      assert.equal(body.next, null);
      assert.equal(body.sections, undefined);
      assert.equal(body.users, undefined);
      assert.equal(body.lists, undefined);
      assert.deepEqual(
        (await (await h.request(`/feed?section=${section}&offset=20`)).json())
          .results,
        []
      );
    }
    assert.equal(h.rankings(), 0);
    assert.equal(h.requestReads(), 0);
    const before = h.counts().reads;
    assert.equal((await h.request('/feed?section=invalid')).status, 400);
    assert.equal(h.counts().reads, before);
    h.revoke();
    assert.equal((await h.request('/feed?section=activity')).status, 404);
  } finally {
    await h.close();
  }
});

it('requested-unwatched is viewer-scoped and hidden/unrelated sections do not fetch requests', async () => {
  const h = await harness();
  h.setEnabled(true);
  try {
    await h.request('/feed?section=available');
    assert.equal(h.requestReads(), 0);
    const feed = await (await h.request('/feed')).json();
    assert.deepEqual(feed.sections.requested, [{ type: 'movie', tmdbId: 2 }]);
    const page = await (await h.request('/feed?section=requested')).json();
    assert.deepEqual(page.results, feed.sections.requested);
    assert.equal(page.next, null);
    const other = await (
      await h.request(
        '/feed?section=requested',
        'GET',
        undefined,
        true,
        '2',
        true
      )
    ).json();
    assert.deepEqual(other.results, []);
    const layout = await (await h.request('/layout')).json();
    await h.request(
      '/layout',
      'PUT',
      layout.map((r: any) => ({ ...r, enabled: r.id !== 'requested' }))
    );
    const before = h.requestReads();
    const hidden = await (await h.request('/feed')).json();
    assert.deepEqual(hidden.sections.requested, []);
    assert.equal(h.requestReads(), before);
  } finally {
    await h.close();
  }
});
it('For you layouts persist per account, preview is read-only and hidden recommendations skip ranking', async () => {
  const h = await harness();
  try {
    h.setEnabled(true);
    const initial = await (await h.request('/layout')).json();
    assert.equal(initial.at(-1).id, 'explore');
    const custom = initial
      .map((row: any) => ({ ...row, enabled: row.id !== 'recommendations' }))
      .reverse();
    assert.equal((await h.request('/layout', 'PUT', custom)).status, 200);
    assert.deepEqual(await (await h.request('/layout')).json(), custom);
    assert.deepEqual(
      await (
        await h.request('/layout', 'GET', undefined, true, '2', true)
      ).json(),
      initial
    );
    assert.equal(
      (await h.request('/layout', 'PUT', initial, true, '2', true)).status,
      403
    );
    assert.equal(
      (await h.request('/layout', 'PUT', [{ id: 'bad', enabled: true }]))
        .status,
      400
    );
    const before = h.rankings();
    const feed = await (await h.request('/feed')).json();
    assert.deepEqual(feed.sections.recommendations, []);
    assert.equal(h.rankings(), before);
    assert.equal(
      (await h.request('/feed?section=recommendations')).status,
      200
    );
    assert(h.rankings() > before);
    assert.equal((await h.request('/layout', 'PUT', [])).status, 200);
    assert.deepEqual(await (await h.request('/layout')).json(), initial);
  } finally {
    await h.close();
  }
});
it('admin manages subscriptions for disabled users without enabling discovery or allowing preview writes', async () => {
  const h = await harness();
  const endpoint = '/admin/follow/tv/42';
  try {
    assert.equal((await h.request(endpoint)).status, 403);
    assert.equal(
      (await h.request(endpoint, 'GET', undefined, true, undefined, true))
        .status,
      200
    );
    assert.equal(
      (
        await h.request(
          endpoint,
          'PUT',
          { userId: 2, following: true },
          true,
          undefined,
          true
        )
      ).status,
      200
    );
    assert.equal(h.counts().saves, 1);
    assert.equal(
      (await h.request(endpoint, 'PUT', { userId: 2, following: true })).status,
      403
    );
    assert.equal(
      (
        await h.request(
          endpoint,
          'PUT',
          { userId: 999, following: true },
          true,
          undefined,
          true
        )
      ).status,
      404
    );
    assert.equal(
      (
        await h.request(
          endpoint,
          'PUT',
          { userId: 2, following: true },
          true,
          '2',
          true
        )
      ).status,
      403
    );
    assert.equal((await (await h.request('/features')).json()).enabled, false);
    assert.equal(h.counts().saves, 1);
  } finally {
    await h.close();
  }
});
it('watchlist matching runs only for a valid group and discover exposes a selected preview', async () => {
  const h = await harness();
  h.setEnabled(true);
  try {
    assert.equal(
      (await h.request('/feed?section=recommendations')).status,
      200
    );
    assert.equal(
      (await h.request('/feed?section=together&with=99')).status,
      400
    );
    assert.equal((await h.request('/feed?section=together')).status, 200);
    assert.deepEqual(h.watchlistReads, []);
    const group = await (
      await h.request('/feed?section=together&with=2%2C2%2C1')
    ).json();
    assert.deepEqual(h.watchlistReads, [[1, 2]]);
    assert.equal(group.watchlistsUpdating, false);
    const discover = await (await h.request('?filter=discover')).json();
    assert.equal(discover.explore.length, 0); // Already saved by the requester.
    const preview = await (
      await h.request('?filter=discover', 'GET', undefined, true, '2', true)
    ).json();
    assert.equal(preview.explore.length, 1);
    assert.equal(preview.explore[0].id, 'curated-test');
    assert.equal(preview.explore[0].associatedUsers, undefined);
  } finally {
    await h.close();
  }
});
it('section pages skip unrelated rankings and send controls only on the first page', async () => {
  const h = await harness();
  h.setEnabled(true);
  try {
    const first = await (await h.request('/feed?section=available')).json();
    assert.equal(first.results.length, 20);
    assert.equal(first.next, 20);
    assert.deepEqual(first.lists, [{ id: 'curated-test', title: 'Test' }]);
    assert.equal(first.sections, undefined);
    assert.equal(h.rankings(), 0);
    const next = await (
      await h.request('/feed?section=available&offset=20')
    ).json();
    assert.equal(next.results.length, 15);
    assert.equal(next.next, null);
    assert.equal(next.lists, undefined);
    assert.equal(next.sections, undefined);
    assert.equal(h.rankings(), 0);
    const group = await (
      await h.request('/feed?section=together&with=2%2C3')
    ).json();
    assert.equal(group.users.length, 3);
    assert.equal(group.sections, undefined);
    assert.equal(h.rankings(), 0);
    assert.equal(
      (await h.request('/feed?section=available&list=missing')).status,
      404
    );
    const filtered = await (
      await h.request('/feed?section=available&list=curated-test')
    ).json();
    assert.deepEqual(filtered.results, first.results);
    for (const section of [
      'recommendations',
      'friendsLoved',
      'unrated',
      'requested',
      'together',
      'short',
    ]) {
      const clean = await (await h.request(`/feed?section=${section}`)).json();
      const leaked = await h.request(`/feed?section=${section}&list=missing`);
      assert.equal(leaked.status, 200);
      assert.deepEqual((await leaked.json()).results, clean.results);
      if (section !== 'together') {
        const unrelatedGroup = await h.request(
          `/feed?section=${section}&with=999&list=missing`
        );
        assert.equal(unrelatedGroup.status, 200);
        assert.deepEqual((await unrelatedGroup.json()).results, clean.results);
      }
    }
    assert.equal((await h.request('/feed?section=newlyAvailable')).status, 400);
    const retiredHome = await (await h.request('/feed')).json();
    assert.equal('newlyAvailable' in retiredHome.sections, false);
    const short = await (
      await h.request('/feed?section=short&runtime=90&offset=20')
    ).json();
    assert.equal(short.results.length, 15);
    assert.ok(short.results.every((film: any) => film.listRuntime === 80));
    assert.equal(short.next, null);
    assert.equal(short.sections, undefined);
    assert.equal(short.users, undefined);
    const preview = await h.request(
      '/feed?section=available',
      'GET',
      undefined,
      true,
      '2',
      true
    );
    assert.equal(preview.status, 200);
    assert.equal(h.viewers.at(-1), 2);
    const home = await (await h.request('/feed')).json();
    assert.equal(home.sections.recommendations.length, 20);
    assert.ok(h.rankings() > 0);
  } finally {
    await h.close();
  }
});
it('blocked direct import returns an asynchronous private status and never saves prematurely', async () => {
  const h = await harness(true);
  h.setEnabled(true);
  try {
    const response = await h.request('/import', 'POST', {
      url: 'https://letterboxd.com/alice/list/test/',
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { jobId: 'browser-import' });
    assert.equal(h.counts().saves, 0);
    assert.deepEqual(
      await (await h.request('/imports/browser-import')).json(),
      { state: 'queued' }
    );
    assert.equal((await h.request('/imports/unknown')).status, 404);
    h.setEnabled(false);
    assert.equal((await h.request('/imports/browser-import')).status, 404);
  } finally {
    await h.close();
  }
});
it('admin preview targets a disabled user without impersonation and rejects every write', async () => {
  const h = await harness();
  try {
    assert.equal(
      (await h.request('/feed', 'GET', undefined, true, '2')).status,
      403
    );
    assert.equal(
      (await h.request('/feed', 'GET', undefined, true, 'bad', true)).status,
      400
    );
    assert.equal(
      (await h.request('/feed', 'GET', undefined, true, '999', true)).status,
      404
    );
    const features = await (
      await h.request('/features', 'GET', undefined, true, '2', true)
    ).json();
    assert.deepEqual(features, {
      enabled: true,
      preview: { id: 2, name: 'Target user' },
    });
    for (const url of ['/feed', '/releases', '/curated-test', ''])
      assert.equal(
        (await h.request(url, 'GET', undefined, true, '2', true)).status,
        200
      );
    assert.deepEqual(h.viewers, [2, 2, 2, 2]);
    for (const [url, method, body] of [
      ['/curated-test/save', 'PUT', { saved: true }],
      ['/follow/movie/1', 'PUT', { following: true }],
      ['/import', 'POST', { url: 'https://letterboxd.com/alice/list/test/' }],
      ['/created', 'POST', { title: 'Local', description: '', movieIds: [1] }],
      [
        '/created/catalogue-test',
        'PUT',
        { title: 'Local', description: '', movieIds: [1], revision: 1 },
      ],
      ['/imports/browser-import', 'GET', undefined],
    ] as const)
      assert.equal(
        (await h.request(url, method, body, true, '2', true)).status,
        403
      );
    assert.equal(h.counts().saves, 0);
    assert.equal(h.counts().imports, 0);
    assert.deepEqual(await (await h.request('/features')).json(), {
      enabled: false,
    });
    assert.equal((await h.request('/feed')).status, 404);
  } finally {
    await h.close();
  }
});
it('authenticated default-off feature gate rejects every data and write route without doing work', async () => {
  const h = await harness();
  try {
    assert.equal(
      (await h.request('/features', 'GET', undefined, false)).status,
      401
    );
    assert.deepEqual(await (await h.request('/features')).json(), {
      enabled: false,
    });
    for (const [url, method, body] of [
      ['', 'GET', undefined],
      ['/feed', 'GET', undefined],
      ['/releases', 'GET', undefined],
      ['/follow/movie/1', 'GET', undefined],
      ['/follow/movie/1', 'PUT', { following: true }],
      ['/curated-test', 'GET', undefined],
      ['/curated-test/save', 'PUT', { saved: true }],
      ['/import', 'POST', { url: 'https://letterboxd.com/alice/list/test/' }],
    ] as const)
      assert.equal((await h.request(url, method, body)).status, 404);
    assert.deepEqual(h.counts(), { reads: 0, saves: 0, imports: 0 });
  } finally {
    await h.close();
  }
});
it('actual OpenAPI middleware accepts the new pages, validates mutations, and preserves pagination/filtering', async () => {
  const h = await harness();
  h.setEnabled(true);
  try {
    const r = await h.request('/curated-test');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
    const p = await r.json();
    assert.equal(p.results.length, 20);
    assert.equal(p.next, 20);
    const next = await (await h.request('/curated-test?offset=20')).json();
    assert.equal(next.results.length, 15);
    assert.equal(next.next, null);
    const filtered = await (
      await h.request('/curated-test?available=true&unwatched=true')
    ).json();
    assert.deepEqual(
      filtered.results.map((f: any) => f.tmdbId),
      [2]
    );
    assert.equal((await h.request('/unknown')).status, 404);
    const releases = await (await h.request('/releases')).json();
    assert.equal(releases.episodes.length, 20);
    const releasePage = await (
      await h.request('/releases?section=episodes&offset=20')
    ).json();
    assert.equal(releasePage.results.length, 15);
    assert.equal(releasePage.next, null);
    assert.equal((await h.request('/releases?section=invalid')).status, 400);
    assert.equal((await h.request('/follow/tv/1')).status, 200);
    assert.equal(
      (await h.request('/follow/tv/1', 'PUT', { following: true })).status,
      200
    );
    assert.equal(
      (await h.request('/follow/tv/1', 'PUT', { following: 'yes' })).status,
      400
    );
    assert.equal((await h.request('/follow/other/1')).status, 400);
    assert.equal((await h.request('/follow/movie/0')).status, 400);
    assert.equal(
      (await h.request('/feed?section=short&runtime=90')).status,
      200
    );
    assert.equal(
      (await h.request('/feed?section=together&with=2')).status,
      200
    );
    const group = await h.request('/feed?section=together&with=2%2C3');
    assert.equal(group.status, 200, await group.text());
    assert.equal(
      (await h.request('/feed?section=together&with=999')).status,
      400
    );
    assert.equal((await h.request('/feed?offset=-1')).status, 400);
    assert.equal((await h.request('/feed?runtime=0')).status, 400);
    assert.equal(
      (await h.request('/curated-test/save', 'PUT', { saved: 'true' })).status,
      400
    );
    assert.equal(
      (await h.request('/curated-test/save', 'PUT', { saved: true })).status,
      200
    );
    assert.equal(
      (
        await h.request('/import', 'POST', {
          url: 'https://letterboxd.com/alice/list/test/',
        })
      ).status,
      202
    );
    assert.equal(
      (
        await h.request('/import', 'POST', {
          url: 'https://letterboxd.com/alice/list/test/',
        })
      ).status,
      202
    );
    assert.deepEqual(
      (await (await h.request('?filter=saved')).json()).unavailable,
      ['missing']
    );
  } finally {
    await h.close();
  }
});
it('revoking the feature during an in-flight read prevents serialization', async () => {
  const h = await harness();
  h.setEnabled(true);
  h.revoke();
  try {
    assert.equal((await h.request('/curated-test')).status, 404);
    h.setEnabled(true);
    assert.equal((await h.request('/feed?section=available')).status, 404);
  } finally {
    await h.close();
  }
});
it('personal watchlist pages use only the authenticated user and remain read-only', async () => {
  const h = await harness();
  h.setEnabled(true);
  try {
    const response = await h.request('/watchlists');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(
      body.results.map((l: any) => l.id),
      ['watchlist-plex', 'watchlist-letterboxd']
    );
    assert.ok(body.results.every((l: any) => l.virtual));
    assert.equal((await h.request('/watchlist-plex')).status, 200);
    assert.ok(
      h.watchlistReads.every(
        (ids: number[]) => ids.length === 1 && ids[0] === 1
      )
    );
    assert.equal((await h.request('/curated-test?sort=invalid')).status, 400);
    assert.equal((await h.request('/curated-test?sort=original')).status, 200);
  } finally {
    await h.close();
  }
});

it('sort progress validates access without rebuilding discovery data or watchlists', async () => {
  const h = await harness();
  h.setEnabled(true);
  const endpoint = '/sort-progress/fe7fe531-26d3-40a3-95b2-966c41b52938';
  try {
    const before = h.counts();
    const response = await h.request(endpoint);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      field: 'rating',
      state: 'pending',
      completed: 4,
      total: 10,
      unavailable: 1,
    });
    assert.deepEqual(h.counts(), before);
    assert.deepEqual(h.watchlistReads, []);
    assert.equal(
      (await h.request(endpoint, 'GET', undefined, true, '2', true)).status,
      404
    );
    assert.equal(
      (await h.request(endpoint, 'GET', undefined, false)).status,
      401
    );
    assert.equal((await h.request('/sort-progress/invalid')).status, 400);
  } finally {
    await h.close();
  }
});
