import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { it } from 'node:test';
import ts from 'typescript';
import { executeBackgroundTask } from './backgroundWorkTasks';
import {
  attributedViewers,
  changeAttribution,
  historyViewers,
  reconcileViewingAttributions,
  sessionIdentity,
  type AttributionStore,
  type ContinuityRow,
} from './viewingAttribution';
const episode = (started = 1000, stopped = 1100, n = 1) => ({
  user_id: '42',
  rating_key: String(100 + n),
  machine_id: 'player',
  started,
  stopped,
  media_type: 'episode',
  grandparent_rating_key: '100',
  parent_media_index: 2,
  media_index: n,
  watched_status: 0,
});
const id = (row: ReturnType<typeof episode>) => sessionIdentity(row)!;
const seed = (row: ReturnType<typeof episode>): AttributionStore => ({
  [id(row)]: { added: [1, 4, 16], excluded: [9], completed: [1, 4, 16] },
});
it('observed 13s resume -> 46s next playback -> 14s resume inherits roster but never completion', () => {
  const rows = [
    episode(1794024045, 1794026022, 1),
    episode(1794026035, 1794026205, 1),
    episode(1794026251, 1794027239, 2),
    episode(1794027253, 1794027769, 2),
  ];
  rows[0].watched_status = 0.75;
  rows[1].watched_status = 1;
  rows[2].watched_status = 0;
  rows[3].watched_status = 0.25;
  const initial = seed(rows[0]),
    before = JSON.stringify(initial);
  const result = reconcileViewingAttributions(initial, [...rows].reverse());
  for (const row of rows.slice(1)) {
    assert.deepEqual(result[id(row)].added, [1, 4, 16]);
    assert.deepEqual(result[id(row)].excluded, [9]);
    assert.deepEqual(result[id(row)].completed, []);
  }
  assert.deepEqual(historyViewers(rows[1], 7, result), [7, 1, 4, 16]);
  assert.deepEqual(historyViewers(rows[2], 7, result), []);
  assert.deepEqual(historyViewers(rows[3], 7, result), []);
  assert.equal(JSON.stringify(initial), before);
  assert.equal(reconcileViewingAttributions(result, rows), result);
});
it('next played same-series episode carries across seasons and manual selections with valid metadata', () => {
  const a = episode();
  for (const b of [
    { ...episode(1110, 1200, 1), parent_media_index: 3, rating_key: '301' },
    episode(1110, 1200, 8),
  ]) {
    assert.deepEqual(
      reconcileViewingAttributions(seed(a), [a, b])[id(b)].added,
      [1, 4, 16]
    );
  }
});
it('explicit destination choices and leave win, including propagation after a cached snapshot', () => {
  const a = episode(),
    b = episode(1110, 1200, 2),
    c = episode(1210, 1300, 3);
  let result = reconcileViewingAttributions(seed(a), [a, b, c]);
  result = {
    ...result,
    [id(b)]: changeAttribution(result[id(b)], 'leave', 4, 7, false),
  };
  result = reconcileViewingAttributions(result, [a, b, c]);
  assert.deepEqual(result[id(b)].added, [1, 16]);
  assert.deepEqual(result[id(c)].added, [1, 16]);
  assert(result[id(c)].excluded.includes(4));
  assert.equal(result[id(b)].inheritedFrom, undefined);
  const explicit = {
    added: [],
    excluded: [1, 4, 16],
    completed: [],
    replacement: null,
  };
  result = reconcileViewingAttributions({ ...seed(a), [id(b)]: explicit }, [
    a,
    b,
    c,
  ]);
  assert.equal(result[id(b)], explicit);
  assert.deepEqual(attributedViewers(7, result[id(c)]), []);
  const updated = {
    ...result,
    [id(a)]: changeAttribution(result[id(a)], 'join', 22, 7, false),
  };
  assert.deepEqual(
    reconcileViewingAttributions(updated, [a, b, c])[id(b)],
    explicit
  );
});
it('enforces inclusive 20 minute gap, same account/device/media and valid endpoint evidence', () => {
  const a = episode();
  const allowed = episode(2300, 2400, 2);
  assert(reconcileViewingAttributions(seed(a), [a, allowed])[id(allowed)]);
  const rejected: ContinuityRow[] = [
    episode(2301, 2400, 2),
    episode(1099, 1200, 2),
    { ...episode(1110, 1200, 2), user_id: 'other' },
    { ...episode(1110, 1200, 2), machine_id: 'other' },
    { ...episode(1110, 1200, 2), media_type: 'movie' },
    { ...episode(1110, 1200, 2), grandparent_rating_key: 'other' },
    { ...episode(1110, 1200, 2), parent_media_index: undefined },
    { ...episode(1110, 1200, 2), media_index: null },
    { ...episode(1110, 1200, 2), grandparent_rating_key: undefined },
  ];
  for (const b of rejected)
    assert.deepEqual(reconcileViewingAttributions(seed(a), [a, b]), seed(a));
  assert.deepEqual(
    reconcileViewingAttributions(seed(a), [
      { ...a, stopped: undefined },
      episode(1110, 1200, 2),
    ]),
    seed(a)
  );
});
it('intervening media and A -> B -> A account switch on one player break continuity', () => {
  const a = episode(),
    c = episode(1210, 1300, 2);
  for (const b of [
    { ...episode(1110, 1200, 5), grandparent_rating_key: 'other' },
    { ...episode(1110, 1200, 5), media_type: 'movie' },
    { ...episode(1110, 1200, 5), media_type: 'track' },
    { ...episode(1110, 1200, 5), rating_key: undefined },
    { ...episode(1110, 1200, 5), user_id: 'B' },
  ]) {
    assert.deepEqual(
      attributedViewers(
        7,
        reconcileViewingAttributions(seed(a), [a, b, c])[id(c)]
      ),
      [7]
    );
  }
});
it('new ambiguous or intervening evidence revokes derived credit, never explicit entries; stale snapshots cannot resurrect it', () => {
  const a = episode(),
    b = episode(1210, 1300, 2);
  const inherited = reconcileViewingAttributions(seed(a), [a, b]);
  for (const barrier of [
    { ...episode(1110, 1200), machine_id: undefined },
    { ...episode(1110, 1200), media_type: 'movie' },
    { ...episode(1110, 1200), user_id: undefined },
    { ...episode(1110, 1200), started: undefined },
  ]) {
    const result = reconcileViewingAttributions(inherited, [a, barrier, b]);
    assert.deepEqual(attributedViewers(7, result[id(b)]), [7]);
    assert.deepEqual(
      historyViewers({ ...b, watched_status: 1 }, 7, result),
      [7]
    );
    assert.deepEqual(
      attributedViewers(7, reconcileViewingAttributions(result, [a, b])[id(b)]),
      [7]
    );
    const explicit = changeAttribution(inherited[id(b)], 'join', 22, 7, false);
    assert.equal(
      reconcileViewingAttributions({ ...inherited, [id(b)]: explicit }, [
        a,
        barrier,
        b,
      ])[id(b)],
      explicit
    );
  }
});
it('preserves legacy entries outside snapshots and movie resume without crossing movies', () => {
  const a = { ...episode(), media_type: 'movie' },
    b = { ...episode(1110, 1200), media_type: 'movie' };
  const legacy = { added: [99], excluded: [], completed: [99] };
  const result = reconcileViewingAttributions({ ...seed(a), legacy }, [a, b]);
  assert.equal(result.legacy, legacy);
  assert.deepEqual(result[id(b)].added, [1, 4, 16]);
  assert.deepEqual(result[id(b)].completed, []);
  assert.equal(
    reconcileViewingAttributions(seed(a), [
      a,
      { ...b, rating_key: 'different' },
    ])[id({ ...b, rating_key: 'different' })],
    undefined
  );
});
it('background normalization retains raw series evidence and unsupported/malformed interruption barriers', async () => {
  const a = episode(),
    b = episode(1210, 1300, 2);
  for (const middle of [
    { ...episode(1110, 1200, 5), media_type: 'track' },
    { ...episode(1110, 1200, 5), rating_key: undefined },
    { ...episode(1110, 1200, 5), user_id: 'B' },
  ]) {
    const rows = await executeBackgroundTask({ kind: 'history' }, async () =>
      JSON.stringify({
        response: {
          result: 'success',
          data: { data: [b, middle, a], recordsFiltered: 3 },
        },
      })
    );
    assert(Array.isArray(rows));
    assert.equal(rows.length, 3);
    assert.equal(rows[0].grandparent_rating_key, '100');
    assert.equal(rows[0].parent_media_index, 2);
    assert.deepEqual(
      attributedViewers(7, reconcileViewingAttributions(seed(a), rows)[id(b)]),
      [7]
    );
  }
});
// Actual persistence implementation, pointed only at a temporary test directory.
const runtimeRequire = createRequire(__filename);
function persistence(directory: string) {
  const exports: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, 'viewingAttribution.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  ).outputText;
  new Function('require', 'exports', source)(
    (name: string) =>
      name === '@server/utils/appDataVolume'
        ? { appDataPath: () => directory }
        : runtimeRequire(name),
    exports
  );
  return exports;
}
it('persists once, reuses fresh explicit state on repeated raw-cache reads, and preserves no-op mtime', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viewing-continuity-'));
  try {
    const api = persistence(dir),
      a = episode(),
      b = episode(1110, 1200, 2),
      file = path.join(dir, 'viewing-attribution.json');
    fs.writeFileSync(file, JSON.stringify(seed(a)));
    const snapshot = [a, b];
    const reconciled = api.reconcileAttributions(snapshot);
    assert.equal(
      api.reconcileAttributions(snapshot),
      reconciled,
      'unchanged snapshots reuse reconciliation'
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(file, 'utf8'))[id(b)].added,
      [1, 4, 16]
    );
    fs.utimesSync(file, new Date(1000), new Date(1000));
    api.reconcileAttributions([a, b]);
    assert.equal(fs.statSync(file).mtimeMs, 1000);
    api.saveAttribution(id(a), 'leave', 4, 7, false);
    const next = api.reconcileAttributions(snapshot);
    assert.deepEqual(next[id(b)].added, [1, 16]);
    api.saveAttribution(id(b), 'leave', 1, 7, false);
    assert.deepEqual(api.reconcileAttributions([a, b])[id(b)].added, [16]);
    assert.deepEqual(fs.readdirSync(dir), ['viewing-attribution.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
it('benchmarks bounded 500 and 20000 row reconciliation with unchanged second pass', () => {
  for (const count of [500, 20000]) {
    const rows = Array.from({ length: count }, (_, i) =>
      episode(1000 + i * 110, 1100 + i * 110, i + 1)
    );
    const started = performance.now();
    const result = reconcileViewingAttributions(seed(rows[0]), rows);
    const firstMs = performance.now() - started;
    const again = performance.now();
    assert.equal(reconcileViewingAttributions(result, rows), result);
    // eslint-disable-next-line no-console -- Deliberate focused performance receipt.
    console.log(
      `continuity benchmark ${count}: initial=${firstMs.toFixed(1)}ms no-op=${(performance.now() - again).toFixed(1)}ms`
    );
    assert.deepEqual(result[id(rows[count - 1])].added, [1, 4, 16]);
  }
});

it('negative evidence predating inheritance prevents older cached subsets from bridging an account switch', () => {
  const a = episode(),
    middle = { ...episode(1110, 1200, 4), user_id: 'B' },
    b = episode(1210, 1300, 2);
  const result = reconcileViewingAttributions(seed(a), [a, middle, b]);
  assert.equal(result[id(b)].continuityBlocked, true);
  assert.deepEqual(
    attributedViewers(7, reconcileViewingAttributions(result, [a, b])[id(b)]),
    [7]
  );
  const untouched = episode(5000, 5100, 10);
  assert.equal(
    reconcileViewingAttributions(result, [a, middle, b, untouched])[
      id(untouched)
    ],
    undefined,
    'do not materialize tombstones for unrelated history'
  );
});
it('timestamped ambiguous rows block candidate intervals, not all future history on the account', () => {
  const a = episode(100000, 100100),
    b = episode(100110, 100200, 2);
  const ancient = { ...episode(1000, 1100), machine_id: undefined };
  assert.deepEqual(
    reconcileViewingAttributions(seed(a), [ancient, a, b])[id(b)].added,
    [1, 4, 16]
  );
  const during = { ...ancient, started: 100105, stopped: 100106 };
  assert.equal(
    reconcileViewingAttributions(seed(a), [a, during, b])[id(b)]
      .continuityBlocked,
    true
  );
});

it('live and global route caches reconcile current assignments without extra upstream calls', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viewing-routes-'));
  try {
    const api = persistence(dir),
      a = episode(),
      b = {
        ...episode(1110, 1200, 2),
        session_key: 'session',
        state: 'playing',
      };
    const raw = [a, b];
    let requests = 0;
    const router = { get() {}, post() {}, put() {}, use() {}, delete() {} };
    const mockAxios = {
      get: async (
        _url: string,
        options: { params: { cmd: string }; responseType?: string }
      ) => {
        requests++;
        const payload = {
          response: {
            result: 'success',
            data:
              options.params.cmd === 'get_activity'
                ? { sessions: [b] }
                : { data: raw, recordsFiltered: raw.length },
          },
        };
        return {
          data:
            options.responseType === 'text' ? JSON.stringify(payload) : payload,
        };
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mocks: Record<string, any> = {
      axios: mockAxios,
      express: { Router: () => router },
      'express-rate-limit': () => () => {},
      '@server/middleware/auth': { isAuthenticated: () => () => {} },
      '@server/lib/permissions': { Permission: { ADMIN: 1 } },
      '@server/lib/viewingAttribution': api,
      '../lib/backgroundWork': {
        backgroundWork: { run: executeBackgroundTask },
      },
    };
    const loadRoute = (name: string, fn: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const exports: Record<string, any> = {};
      const source = ts.transpileModule(
        fs.readFileSync(path.join(__dirname, `../routes/${name}.ts`), 'utf8'),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
          },
        }
      ).outputText;
      new Function('require', 'exports', source + `;exports.inspect=${fn};`)(
        (key: string) => {
          if (key in mocks) return mocks[key];
          if (key.startsWith('@server/')) return {};
          return runtimeRequire(key);
        },
        exports
      );
      return exports.inspect;
    };
    const live = loadRoute('watchParty', 'liveActivity');
    const config = { tautulliUrl: 'http://test', tautulliKey: 'test' };
    await live(config);
    assert.equal(requests, 2);
    api.saveAttribution(id(a), 'join', 4, 7, false);
    const active = await live(config);
    assert.equal(requests, 2, 'live snapshot must be reused');
    assert.deepEqual(
      attributedViewers(7, api.readAttributions()[id(active[0])]),
      [7, 4]
    );
    assert.deepEqual(
      historyViewers({ ...b, watched_status: 1 }, 7, api.readAttributions()),
      [7, 4]
    );
    const recent = loadRoute('social', 'recentHistory');
    await recent(config);
    assert.equal(requests, 3);
    api.saveAttribution(id(a), 'join', 16, 7, false);
    await recent(config);
    assert.equal(requests, 3, 'global snapshot must be reused');
    assert.deepEqual(
      attributedViewers(7, api.readAttributions()[id(b)]),
      [7, 4, 16]
    );
    api.saveAttribution(id(b), 'leave', 4, 7, false);
    await live(config);
    await recent(config);
    assert.equal(requests, 3);
    assert.deepEqual(
      attributedViewers(7, api.readAttributions()[id(b)]),
      [7, 16]
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
