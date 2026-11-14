/* eslint-disable @typescript-eslint/no-explicit-any */
// Execute the actual scanner/base loop with isolated Plex, persistence and DB boundaries.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import * as retry from './retryQueue';

import animeList from '@server/api/animelist';
import type {
  PlexLibrary,
  PlexLibraryItem,
  PlexMetadata,
} from '@server/api/plexapi';
import PlexAPI from '@server/api/plexapi';
import TheMovieDb from '@server/api/themoviedb';
import type {
  TmdbTvDetails,
  TmdbTvSeasonResult,
} from '@server/api/themoviedb/interfaces';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaRequest from '@server/entity/MediaRequest';
import Season from '@server/entity/Season';
import SeasonRequest from '@server/entity/SeasonRequest';
import { User } from '@server/entity/User';
import { plexFullScanner } from '@server/lib/scanners/plex';
import type { Library } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import { runWithMockTimers } from '@server/test/runWithMockTimers';
import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';

const runtimeRequire = createRequire(__filename);

function load(file: string, mocks: Record<string, any>) {
  const exports: any = {};
  const code = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, file), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  ).outputText;
  new Function('require', 'exports', code)((name: string) => {
    if (name in mocks) return mocks[name];
    if (name === 'crypto' || name === 'lodash') return runtimeRequire(name);
    return class Stub {};
  }, exports);
  return exports;
}
const movie = (key = '10', guid = true): any => ({
  ratingKey: key,
  librarySectionID: '1',
  type: 'movie',
  title: 'Test',
  guid: 'plex://movie/test',
  ...(guid
    ? { Guid: [{ id: 'tmdb://433808' }, { id: 'imdb://tt5638642' }] }
    : {}),
  Media: [{ videoResolution: '1080' }],
  addedAt: 1,
  updatedAt: 1,
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plex-scanner-'));
  const file = path.join(dir, 'retry.json');
  const state = {
    items: [] as any[],
    metadata: (async () => movie()) as (key: string) => Promise<any>,
    processed: [] as number[],
    puts: [] as string[],
    reads: [] as string[],
    logs: [] as any[],
    clients: 0,
    save: async () => {},
    process: (async () => {}) as (id: number) => Promise<void>,
    failWrites: false,
  };
  const settings: any = {
    plex: {
      machineId: 'plex-one',
      libraries: [
        { id: '1', name: 'Movies', enabled: true, type: 'movie', lastScan: 1 },
      ],
    },
    radarr: [],
    sonarr: [],
    main: { enableSpecialEpisodes: false },
    save: async () => state.save(),
  };
  class Queue extends retry.PlexRetryQueue {
    constructor() {
      super(file);
    }
    fail(...args: Parameters<retry.PlexRetryQueue['fail']>) {
      if (state.failWrites) throw Error('Disk unavailable');
      return super.fail(...args);
    }
  }
  class Client {
    axios = {
      put: async (url: string) => {
        state.puts.push(url);
      },
    };
    constructor(options: any) {
      state.clients++;
      assert.equal(options.timeout, 30000);
    }
    getLibraries = async () => [];
    getRecentlyAdded = async () => state.items;
    getLibraryContents = async () => ({
      totalSize: state.items.length,
      items: state.items,
    });
    getMetadata = async (key: string) => {
      state.reads.push(key);
      return state.metadata(key);
    };
  }
  const mocks: any = {
    '@server/lib/settings': { getSettings: () => settings },
    '@server/datasource': {
      getRepository: () => ({
        findOne: async () => ({ id: 1, plexToken: 'test' }),
      }),
    },
    '@server/api/plexapi': Client,
    '@server/lib/cache': {
      getCache: () => {
        throw Error(
          'Scanner must resolve current IDs without the removed GUID cache'
        );
      },
    },
    '@server/logger': Object.fromEntries(
      ['info', 'warn', 'debug', 'error'].map((level) => [
        level,
        (...args: any[]) => state.logs.push(args),
      ])
    ),
    './retryQueue': { ...retry, PlexRetryQueue: Queue },
  };
  const base = load('../baseScanner.ts', mocks).default;
  base.prototype.processMovie = async (id: number) => {
    await state.process(id);
    state.processed.push(id);
  };
  mocks['@server/lib/scanners/baseScanner'] = base;
  const restart = () => {
    const scanners = load('index.ts', mocks);
    scanners.plexRecentScanner.updateRate = 0;
    scanners.plexFullScanner.updateRate = 0;
    return scanners;
  };
  return {
    state,
    settings,
    file,
    restart,
    queue: new Queue(),
    entry: {
      server: retry.plexRetryServer(settings.plex),
      libraryId: '1',
      ratingKey: '10',
    },
    close: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
it('persists missing Guid before watermark, recovers an old item after restart, and clears success without trusting stale cached IDs', async () => {
  const f = fixture();
  let now = 1000000;
  const clock = mock.method(Date, 'now', () => now);
  try {
    f.state.items = [movie('10', false)];
    f.state.metadata = async () => movie('10', false);
    let saved = false;
    f.state.save = async () => {
      assert(
        f.queue.has(f.entry),
        'failure must be durable before saving lastScan'
      );
      saved = true;
    };
    await f.restart().plexRecentScanner.run();
    assert(saved);
    assert.equal(f.settings.plex.libraries[0].lastScan, now);
    now += 20 * 60 * 1000;
    f.state.items = [];
    f.state.metadata = async () => movie();
    f.state.save = async () => {};
    await f.restart().plexRecentScanner.run();
    assert.deepEqual(f.state.processed, [433808]);
    assert.equal(f.queue.has(f.entry), false);
    assert.equal(f.state.puts.length, 0);
  } finally {
    clock.mock.restore();
    f.close();
  }
});
it('refreshes missing Guid once per incident across restarts, retains failures, and observes repaired exact identity later', async () => {
  const f = fixture();
  let now = 1000000;
  const clock = mock.method(Date, 'now', () => now);
  try {
    f.state.items = [movie('10', false)];
    f.state.metadata = async () => movie('10', false);
    await f.restart().plexRecentScanner.run();
    for (let i = 0; i < 11; i++) {
      now += 86400000;
      await f.restart().plexRecentScanner.run();
    }
    assert.deepEqual(f.state.puts, ['/library/metadata/10/refresh']);
    assert.equal(f.queue.summary().repairNeeded, 1);
    assert.equal(f.state.processed.length, 0);
    f.state.items = [];
    f.state.metadata = async () => movie();
    now += 86400000;
    await f.restart().plexRecentScanner.run();
    assert.deepEqual(f.state.processed, [433808]);
    assert.equal(f.queue.summary().pending, 0);
  } finally {
    clock.mock.restore();
    f.close();
  }
});
it('only confirmed Plex deletion clears failures; disabled, removed, moved, ambiguous, and downstream 404 stay safe', async () => {
  const f = fixture();
  let now = 1000000;
  const clock = mock.method(Date, 'now', () => now);
  try {
    f.queue.fail(f.entry, 0);
    f.settings.plex.libraries[0].enabled = false;
    await f.restart().plexRecentScanner.run();
    assert.equal(f.state.reads.length, 0);
    assert(f.queue.has(f.entry));
    f.settings.plex.libraries[0].enabled = true;
    f.state.metadata = async () => ({ ...movie(), librarySectionID: '2' });
    await f.restart().plexRecentScanner.run();
    assert.equal(f.state.processed.length, 0);
    assert(f.queue.has(f.entry));
    now += 86400000;
    f.state.metadata = async () => undefined;
    await f.restart().plexRecentScanner.run();
    assert(f.queue.has(f.entry));
    now += 86400000;
    f.state.metadata = async () => movie();
    f.state.process = async () => {
      throw Object.assign(Error('TMDB 404'), { response: { status: 404 } });
    };
    await f.restart().plexRecentScanner.run();
    assert(f.queue.has(f.entry));
    assert.equal(f.state.puts.length, 0);
    now += 86400000;
    f.state.metadata = async () => {
      throw Object.assign(Error('Plex 404'), { response: { status: 404 } });
    };
    await f.restart().plexRecentScanner.run();
    assert.equal(f.queue.has(f.entry), false);
  } finally {
    clock.mock.restore();
    f.close();
  }
});
for (const scannerName of ['plexRecentScanner', 'plexFullScanner']) {
  it(`${scannerName} drains in-flight siblings before releasing guard after queue-write failure`, async () => {
    const f = fixture();
    const entered = deferred(),
      release = deferred();
    try {
      f.state.items = [movie('10', false), movie('11')];
      f.state.metadata = async () => movie('10', false);
      f.state.failWrites = true;
      f.state.process = async () => {
        entered.resolve();
        await release.promise;
      };
      let saves = 0;
      f.state.save = async () => {
        saves++;
      };
      const scanners = f.restart();
      const running = scanners[scannerName].run();
      await entered.promise;
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(scanners[scannerName].status().running, true);
      await scanners[
        scannerName === 'plexRecentScanner'
          ? 'plexFullScanner'
          : 'plexRecentScanner'
      ].run();
      assert.equal(
        f.state.clients,
        1,
        'other scan must not enter while a sibling is unresolved'
      );
      release.resolve();
      await running;
      assert.equal(saves, 0);
      assert.equal(f.settings.plex.libraries[0].lastScan, 1);
      assert.equal(scanners[scannerName].status().running, false);
      assert(f.state.logs.some((args) => args[0] === 'Scan interrupted'));
      f.state.items = [];
      f.state.failWrites = false;
      await scanners.plexRecentScanner.run();
      assert.equal(f.state.clients, 2);
    } finally {
      release.resolve();
      f.close();
    }
  });
}
it('recent overlap cannot bypass the per-scan retry limit or persisted backoff', async () => {
  const f = fixture();
  const clock = mock.method(Date, 'now', () => 1000000);
  try {
    f.state.items = Array.from({ length: 30 }, (_, i) =>
      movie(String(i), false)
    );
    for (const item of f.state.items)
      f.queue.fail({ ...f.entry, ratingKey: item.ratingKey }, 0);
    f.state.metadata = async (key) => movie(key, false);
    await f.restart().plexRecentScanner.run();
    // A missing-Guid retry fetches fresh metadata at the drain and identity lookup.
    assert.equal(f.state.reads.length, retry.RETRY_LIMIT * 2);
    assert.equal(f.state.puts.length, retry.RETRY_LIMIT);
    assert.equal(f.queue.summary().pending, 30);
    await f.restart().plexRecentScanner.run();
    assert.equal(
      f.state.puts.length,
      30,
      'only the five remaining due incidents should run'
    );
    assert.equal(f.state.reads.length, 60);
    await f.restart().plexRecentScanner.run();
    assert.equal(
      f.state.reads.length,
      60,
      'all incidents are now in persisted backoff'
    );
  } finally {
    clock.mock.restore();
    f.close();
  }
});

for (const guid of [
  'plex://show/test',
  'tv.plex.agents.custom.example://show/test',
]) {
  it(`resolves current provider IDs and scopes the ambiguous TVDB override for ${guid}`, async () => {
    const f = fixture();
    try {
      const scanner = f.restart().plexRecentScanner;
      for (const tvdbId of [80552, 12345]) {
        const ids = await scanner.getMediaIds({
          ...movie(),
          type: 'show',
          guid,
          Guid: [
            { id: `tvdb://${tvdbId}` },
            { id: 'tmdb://11294' },
            { id: 'tmdb://235884' },
          ],
        });
        assert.equal(ids.tmdbId, tvdbId === 80552 ? 11294 : 235884);
      }
      const unambiguous = await scanner.getMediaIds({
        ...movie(),
        type: 'show',
        guid,
        Guid: [{ id: 'tvdb://80552' }, { id: 'tmdb://235884' }],
      });
      assert.equal(unambiguous.tmdbId, 235884);
    } finally {
      f.close();
    }
  });
}

Object.defineProperty(animeList, 'sync', {
  value: async () => {},
  configurable: true,
  writable: true,
});

let getLibrariesImpl: () => Promise<PlexLibrary[]> = async () => [];
let getLibraryContentsImpl: (
  id: string
) => Promise<{ totalSize: number; items: PlexLibraryItem[] }> = async () => ({
  totalSize: 0,
  items: [],
});
let getMetadataImpl: (
  key: string
) => Promise<PlexMetadata | undefined> = async () => undefined;
let getChildrenMetadataImpl: (
  key: string
) => Promise<PlexMetadata[]> = async () => [];

Object.defineProperty(PlexAPI.prototype, 'getLibraries', {
  get() {
    return async () => getLibrariesImpl();
  },
  set() {},
  configurable: true,
});

Object.defineProperty(PlexAPI.prototype, 'getLibraryContents', {
  get() {
    return async (id: string) => getLibraryContentsImpl(id);
  },
  set() {},
  configurable: true,
});

Object.defineProperty(PlexAPI.prototype, 'getMetadata', {
  get() {
    return async (key: string) => getMetadataImpl(key);
  },
  set() {},
  configurable: true,
});

Object.defineProperty(PlexAPI.prototype, 'getChildrenMetadata', {
  get() {
    return async (key: string) => getChildrenMetadataImpl(key);
  },
  set() {},
  configurable: true,
});

let getTvShowImpl: (args: {
  tvId: number;
}) => Promise<TmdbTvDetails> = async () => fakeTmdbShow(1);

for (const method of ['getTvShow', 'getTvShowForScan'] as const) {
  Object.defineProperty(TheMovieDb.prototype, method, {
    get() {
      return async (args: { tvId: number }) => getTvShowImpl(args);
    },
    set() {},
    configurable: true,
  });

  // plexFullScanner built its own TheMovieDb on import, before the stubs above.
  Object.defineProperty(plexFullScanner.tmdb, method, {
    value: async (args: { tvId: number }) => getTvShowImpl(args),
    configurable: true,
  });
}

mock.method(MediaRequest, 'sendNotification', async () => undefined);

setupTestDb();

function fakeTmdbShow(
  tmdbId: number,
  seasons: TmdbTvSeasonResult[] = [
    {
      id: 1,
      air_date: '2024-01-01',
      episode_count: 10,
      name: 'Season 1',
      overview: '',
      season_number: 1,
    },
  ]
): TmdbTvDetails {
  return {
    id: tmdbId,
    content_ratings: { results: [] },
    created_by: [],
    episode_run_time: [],
    first_air_date: '2024-01-01',
    genres: [],
    homepage: '',
    in_production: false,
    languages: ['en'],
    last_air_date: '2024-01-01',
    name: 'Test Show',
    networks: [],
    number_of_episodes: 10,
    number_of_seasons: seasons.length,
    origin_country: ['US'],
    original_language: 'en',
    original_name: 'Test Show',
    overview: '',
    popularity: 0,
    production_companies: [],
    production_countries: [],
    spoken_languages: [],
    seasons,
    status: 'Ended',
    type: 'Scripted',
    vote_average: 0,
    vote_count: 0,
    aggregate_credits: { cast: [] },
    credits: { crew: [] },
    external_ids: {},
    keywords: { results: [] },
    videos: { results: [] },
  };
}

function fakePlexShowItem(ratingKey: string): PlexLibraryItem {
  return {
    ratingKey,
    title: 'Test Show',
    guid: 'plex://show/test-show',
    addedAt: 1700000000,
    updatedAt: 1700000000,
    type: 'show',
    Media: [],
  };
}

function fakePlexShowMetadata(
  ratingKey: string,
  tmdbId: number,
  children: PlexMetadata[]
): PlexMetadata {
  return {
    ratingKey,
    title: 'Test Show',
    guid: 'plex://show/test-show',
    type: 'show',
    Guid: [{ id: `tmdb://${tmdbId}` }],
    Children: { size: 12, Metadata: children },
    index: 1,
    leafCount: 0,
    viewedLeafCount: 0,
    addedAt: 1700000000,
    updatedAt: 1700000000,
    Media: [],
  };
}

function fakePlexSeasonMetadata(
  seasonNumber: number,
  ratingKey: string
): PlexMetadata {
  return {
    ratingKey,
    title: `Season ${seasonNumber}`,
    guid: `plex://season/test-season-${seasonNumber}`,
    type: 'season',
    Guid: [],
    index: seasonNumber,
    leafCount: 0,
    viewedLeafCount: 0,
    addedAt: 1700000000,
    updatedAt: 1700000000,
    Media: [],
  };
}

function configurePlexWithLibrary(
  libraries: Library[] = [
    { id: 'test-library-id', name: 'TV Shows', enabled: true, type: 'show' },
  ]
): void {
  const settings = getSettings();
  settings.main.mediaServerType = MediaServerType.PLEX;
  settings.plex = {
    ...settings.plex,
    ip: '127.0.0.1',
    port: 32400,
    libraries,
  };
}

describe('Plex Scanner', () => {
  beforeEach(() => {
    getLibrariesImpl = async () => [
      {
        key: 'test-library-id',
        title: 'TV Shows',
        type: 'show',
        agent: 'tv.plex.agents.series',
      },
    ];
    getLibraryContentsImpl = async () => ({ totalSize: 0, items: [] });
    getMetadataImpl = async () => undefined;
    getChildrenMetadataImpl = async () => [];
    getTvShowImpl = async () => fakeTmdbShow(1);
  });

  describe('in-flight request handling', () => {
    it('leaves an approved request alone when the show has no episodes yet', async () => {
      configurePlexWithLibrary();

      const mediaRepository = getRepository(Media);
      const requestRepository = getRepository(MediaRequest);
      const userRepository = getRepository(User);

      const requestedBy = await userRepository.findOneOrFail({
        where: { id: 1 },
      });

      const media = await mediaRepository.save(
        new Media({
          tmdbId: 6100,
          mediaType: MediaType.TV,
          status: MediaStatus.PROCESSING,
          status4k: MediaStatus.UNKNOWN,
          ratingKey: 'plex-inflight-show-key',
          seasons: [
            new Season({
              seasonNumber: 1,
              status: MediaStatus.PROCESSING,
              status4k: MediaStatus.UNKNOWN,
            }),
          ],
        })
      );

      // sendToSonarr runs on insert and only bails when no server is configured,
      // so leftover settings from another test would reach TMDB and fail the request.
      const settings = getSettings();
      settings.radarr = [];
      settings.sonarr = [];

      const request = await requestRepository.save(
        new MediaRequest({
          type: MediaType.TV,
          status: MediaRequestStatus.APPROVED,
          media,
          requestedBy,
          is4k: false,
          seasons: [
            new SeasonRequest({
              seasonNumber: 1,
              status: MediaRequestStatus.APPROVED,
            }),
          ],
        })
      );

      getTvShowImpl = async () => fakeTmdbShow(6100);

      getLibraryContentsImpl = async (id: string) =>
        id === 'test-library-id'
          ? {
              totalSize: 1,
              items: [fakePlexShowItem('plex-inflight-show-key')],
            }
          : { totalSize: 0, items: [] };

      getMetadataImpl = async (key: string) =>
        key === 'plex-inflight-show-key'
          ? fakePlexShowMetadata('plex-inflight-show-key', 6100, [
              fakePlexSeasonMetadata(1, 'plex-inflight-s1-key'),
            ])
          : undefined;

      getChildrenMetadataImpl = async () => [];

      await runWithMockTimers(() => plexFullScanner.run());

      const updatedRequest = await requestRepository.findOneOrFail({
        where: { id: request.id },
      });

      assert.strictEqual(
        updatedRequest.status,
        MediaRequestStatus.APPROVED,
        'A media server scan must not cancel a request Sonarr is still working on'
      );
    });
  });
});
