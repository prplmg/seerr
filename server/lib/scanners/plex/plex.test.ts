/* eslint-disable @typescript-eslint/no-explicit-any */
// Execute the actual scanner/base loop with isolated Plex, persistence and DB boundaries.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { it, mock } from 'node:test';
import ts from 'typescript';
import * as retry from './retryQueue';

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
      getCache: () => ({
        data: { get: () => ({ tmdbId: 999 }), set: () => {} },
      }),
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
