import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { letterboxdEntryIdentity } from './letterboxdImport';
import * as observations from './letterboxdObservations';
import * as planning from './letterboxdPublicationPlan';
import type { SyncReceipt } from './letterboxdSyncReceipts';
import * as queue from './letterboxdWriteQueue';
import * as target from './reviewPublicationTarget';
import * as diary from './reviewDiaryPublication';
import { assessWriteHealth } from './letterboxdBrowserState';

function harness(realPlanner = false, userId = 1, accountName = 'prplmg') {
  const rows = [1, 2, 3].map((n) => ({
    id: `local:${n}`,
    userId,
    tmdbId: n,
    source: 'local',
    mediaType: 'movie',
    syncToLetterboxd: true,
    updatedAt: new Date(Date.now() - 31000).toISOString(),
    rating: 4,
    text: 'Review',
    spoiler: false,
  }));
  const state = queue.emptyWriteState();
  state.settings[userId] = { enabled: true, account: accountName, enabledSince: 1 };
  const observed: observations.ObservationState = { version: 1, requests: [] };
  const receipts: SyncReceipt[] = [];
  const files = new Map<string, string>();
  const account = { enabled: true, username: accountName };
  let queued = 0;
  let match = true;
  let afterMatch = () => {};
  let afterPrepare = () => {};
  class Account {}
  const deps: Record<string, unknown> = {
    './manualWatched': { prepareManualWatched: async () => {} },
    '@server/api/rating/letterboxd': {
      getLetterboxdRating: async (n: number) => ({
        url: `https://letterboxd.com/film/film-${n}/`,
      }),
    },
    '@server/entity/MovieReview': {
      MovieReview: class {},
      LetterboxdAccount: Account,
    },
    '@server/datasource': {
      getRepository: (target: unknown) =>
        target === Account
          ? { findOneBy: async () => account }
          : {
              find: async () => rows.map((r) => ({ ...r })),
              findBy: async (where: { source: string; userId: number }) =>
                where.source === 'local' ? rows.filter(r=>r.userId===where.userId).map((r) => ({ ...r })) : [],
              findOneBy: async ({ id }: { id: string }) =>
                rows.find((r) => r.id === id)
                  ? { ...rows.find((r) => r.id === id)! }
                  : null,
              save: async (value: (typeof rows)[number]) => {
                Object.assign(rows.find((r) => r.id === value.id)!, value);
                return value;
              },
            },
    },
    '@server/utils/appDataVolume': { appDataPath: () => '/mock' },
    crypto: { randomUUID: () => 'temp' },
    fs: {
      readFileSync: (file: string) => {
        if (!files.has(file)) throw Object.assign(Error(), { code: 'ENOENT' });
        return files.get(file);
      },
      writeFileSync: (file: string, value: string) => files.set(file, value),
      renameSync: (from: string, to: string) => {
        files.set(to, files.get(from)!);
        files.delete(from);
      },
      existsSync: (file: string) => files.has(file),
      unlinkSync: (file: string) => files.delete(file),
    },
    path,
    typeorm: { MoreThanOrEqual: (value: unknown) => value },
    './letterboxdImport': { letterboxdEntryIdentity },
    './reviewPublicationTarget': target,
    './reviewDiaryPublication': diary,
    './letterboxdExportPolicy': { exportPublicationHeld: async()=>false, exportReviewBaseline:async()=>undefined },
    './letterboxdObservations': {
      ...observations,
      readObservations: () => observed,
    },
    './letterboxdPublicationPlan': planning,
    './letterboxdPublishing': {
      prepareLetterboxdPublications: async () => {
        for (const row of rows)
          observations.requestObservation(observed, {
            userId,
            account: accountName,
            film: `film-${row.tmdbId}`,
            entryId: receipts.find((r) => r.originId === row.id)?.entryId,
          });
        afterPrepare();
        return {
          queued,
          issues: rows.map((r) => ({
            userId,
            originEntityId: r.id,
            reason: 'needs-baseline',
          })),
        };
      },
    },
    './letterboxdSyncReceipts': {
      readSyncReceipts: () => receipts,
      recordSyncReceipt: (receipt: SyncReceipt) => {
        const old = receipts.find((r) => r.originId === receipt.originId);
        if (old) Object.assign(old, receipt);
        else receipts.push(receipt);
      },
    },
    './letterboxdWatchlistMatch': {
      matchWatchlistFilm: async (film: string) => {
        afterMatch();
        return match
          ? { tmdbId: Number(film.split('-')[1]), mediaType: 'movie' }
          : null;
      },
    },
    './letterboxdWriteQueue': {
      ...queue,
      readWriteState: () => state,
      updateWriteState: (fn: (s: queue.WriteState) => unknown) => fn(state),
    },
    './reviews': {
      withReviewLock: async (_id: number, fn: () => Promise<unknown>) => fn(),
    },
  };
  if (realPlanner) {
    const exports = {};
    vm.runInNewContext(
      ts.transpileModule(
        fs.readFileSync(
          path.join(__dirname, 'letterboxdPublishing.ts'),
          'utf8'
        ),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
          },
        }
      ).outputText,
      {
        exports,
        URL,
        require: (name: string) => {
          if (name === './letterboxdObservations')
            return {
              ...observations,
              readObservations: () => observed,
              updateObservations: (
                fn: (s: observations.ObservationState) => unknown
              ) => fn(observed),
            };
          if (!(name in deps)) throw Error(name);
          return deps[name];
        },
      }
    );
    deps['./letterboxdPublishing'] = exports;
  }
  const load = () => {
    const exports = {} as {
      prepareLetterboxdPublications: () => Promise<unknown>;
      continueLetterboxdPublications: () => Promise<void>;
    };
    vm.runInNewContext(
      ts.transpileModule(
        fs.readFileSync(
          path.join(__dirname, 'letterboxdPublicationContinuation.ts'),
          'utf8'
        ),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
          },
        }
      ).outputText,
      {
        exports,
        URL,
        require: (name: string) => {
          if (!(name in deps)) throw Error(name);
          return deps[name];
        },
      }
    );
    return exports;
  };
  const verify = (rating: number | null = null, text = '', spoiler = false) => {
    for (const request of observed.requests) {
      if (request.state !== 'queued') continue;
      observations.claimObservation(observed, { userId, account: accountName });
      observations.reportObservation(observed, {
        ...request,
        claimToken: request.claimToken!,
        status: 'verified',
        identityVerified: true,
        complete: true,
        observation: {
          rating,
          text,
          spoiler,
          entryId: request.entryId,
          observedAt: Date.now(),
        },
      });
    }
  };
  return {
    ...load(),
    load,
    rows,
    files,
    state,
    observed,
    receipts,
    account,
    verify,
    setQueued: (n: number) => {
      queued = n;
    },
    setMatch: (v: boolean) => {
      match = v;
    },
    afterMatch: (fn: () => void) => {
      afterMatch = fn;
    },
    afterPrepare: (fn: () => void) => {
      afterPrepare = fn;
    },
  };
}
it('non-pilot account continues after restart using its own durable batch and exact identity', async () => {
  const h=harness(true,7,'evegrissel');
  await h.prepareLetterboxdPublications();
  assert.ok(h.files.has('/mock/letterboxd-publication-continuation-7.json'));
  assert.equal(h.files.has('/mock/letterboxd-publication-continuation.json'),false);
  assert.ok(h.observed.requests.length>0);
  assert.ok(h.observed.requests.every(r=>r.userId===7&&r.account==='evegrissel'));
  h.verify();
  await h.load().continueLetterboxdPublications();
  assert.ok(h.state.intents.length>0);
  assert.ok(h.state.intents.every(i=>i.userId===7&&i.account==='evegrissel'));
  const count=h.state.intents.length;
  await h.load().continueLetterboxdPublications();
  assert.equal(h.state.intents.length,count);
});
it('preparation failure survives pending verification and restart, alerts, then clears when resolved', async () => {
  const h=harness(false,7,'evegrissel');
  h.afterPrepare(()=>{throw Error('test failure');});
  await h.prepareLetterboxdPublications();
  assert.equal(h.state.preparationFailures?.[0]?.userId,7);
  assert.equal(h.state.intents.length,0);
  await h.prepareLetterboxdPublications();
  await h.prepareLetterboxdPublications();
  const failure = h.state.preparationFailures![0];
  failure.firstFailedAt = Date.now() - 16 * 60 * 1000;
  const firstFailedAt = failure.firstFailedAt;
  h.afterPrepare(()=>{});
  // Returning needs-baseline is pending, not a successful resolution.
  await h.prepareLetterboxdPublications();
  assert.equal(h.state.preparationFailures![0].firstFailedAt, firstFailedAt);
  // A restarted process finding an in-flight ticket must preserve it too.
  await h.load().prepareLetterboxdPublications();
  assert.equal(h.state.preparationFailures![0].firstFailedAt, firstFailedAt);
  assert.ok(assessWriteHealth(
    { userId: 7, username: 'evegrissel', instance: 'test', enabled: true },
    h.state.preparationFailures!,
    Date.now()
  ));
  // Once no eligible review or ticket remains, resolution clears the incident.
  h.rows.splice(0);
  h.files.clear();
  await h.load().prepareLetterboxdPublications();
  assert.equal(h.state.preparationFailures?.length,0);
});

it('mixed local rating and remote text remain merged after verification and a second scheduled cycle', async () => {
  const h = harness(true);
  h.rows.splice(1);
  Object.assign(h.rows[0], { rating: 5, text: 'A' });
  const stamp = h.rows[0].updatedAt;
  h.receipts.push({
    userId: 1,
    account: 'prplmg',
    originId: h.rows[0].id,
    entryId: 'https://letterboxd.com/prplmg/film/film-1/',
    baseline: { rating: 4, text: 'A', spoiler: false },
    verifiedAt: Date.now() - 5000,
  });
  await h.prepareLetterboxdPublications();
  h.verify(4, 'B');
  await h.continueLetterboxdPublications();
  assert.equal(h.rows[0].text, 'B');
  assert.equal(h.rows[0].rating, 5);
  assert.equal(h.rows[0].updatedAt, stamp);
  assert.equal(h.state.intents.length, 1);
  assert.equal(h.state.intents[0].desired.text, 'B');
  h.state.intents[0].state = 'verified';
  h.receipts[0].baseline = { rating: 5, text: 'B', spoiler: false };
  h.receipts[0].verifiedAt = Date.now();
  h.observed.requests.forEach((r) => {
    if (r.observation) r.observation.observedAt -= 2000;
  });
  await h.load().prepareLetterboxdPublications();
  h.verify(5, 'B');
  await h.continueLetterboxdPublications();
  assert.equal(h.state.intents.length, 1, 'must not enqueue a reversal');
  assert.equal(h.rows[0].text, 'B');
});

it('persisted cursor advances past held candidates across restart', async () => {
  const h = harness(true);
  await h.prepareLetterboxdPublications();
  assert.deepEqual(
    h.observed.requests.map((r) => r.film),
    ['film-1', 'film-2']
  );
  await h.load().prepareLetterboxdPublications();
  assert.equal(h.observed.requests.length,2,'pending observations must not be replaced');
  for (const request of h.observed.requests) request.requestedAt = Date.now()-360000;
  await h.load().continueLetterboxdPublications();
  await h.load().prepareLetterboxdPublications();
  assert.ok(h.observed.requests.some((r) => r.film === 'film-3'));
});

it('admits explicit saves immediately and preserves admission after restart', async()=>{
  const h=harness(true);
  h.rows.forEach(r=>{r.updatedAt=new Date().toISOString();});
  await h.prepareLetterboxdPublications();
  assert.equal(h.observed.requests.length,2);
  await h.load().prepareLetterboxdPublications();
  assert.equal(h.observed.requests.length,2);
});

it('receipt-linked pre-enable rows reconcile inbound without retroactive export or timestamp promotion', async () => {
  for (const localText of ['A', 'local-unsent']) {
    const h = harness(true);
    h.rows.splice(1);
    h.rows[0].text = localText;
    h.state.settings[1].enabledSince = Date.now() - 100;
    const stamp = h.rows[0].updatedAt;
    h.receipts.push({
      userId: 1,
      account: 'prplmg',
      originId: h.rows[0].id,
      entryId: 'https://letterboxd.com/prplmg/film/film-1/',
      baseline: { rating: 4, text: 'A', spoiler: false },
      verifiedAt: Date.now() - 5000,
    });
    await h.prepareLetterboxdPublications();
    h.verify(4, localText === 'A' ? 'B' : 'A');
    await h.continueLetterboxdPublications();
    assert.equal(h.rows[0].text, localText === 'A' ? 'B' : localText);
    assert.equal(h.rows[0].updatedAt, stamp);
    assert.equal(h.state.intents.length, 0);
  }
});

it('integrates the real scheduled planner baseline requests with immediate bounded continuation', async () => {
  const h = harness(true);
  await h.prepareLetterboxdPublications();
  assert.equal(h.state.intents.length, 0);
  assert.equal(h.observed.requests.length, 2);
  h.verify();
  await h.continueLetterboxdPublications();
  assert.equal(h.state.intents.length, 2);
});

it('continues the scheduled batch immediately after observation, bounded to two, durable and idempotent', async () => {
  const h = harness();
  await h.prepareLetterboxdPublications();
  await h.continueLetterboxdPublications();
  assert.equal(h.state.intents.length, 0);
  h.verify();
  await h.load().continueLetterboxdPublications();
  assert.equal(h.state.intents.length, 2);
  assert.ok(h.state.intents.every((i) => i.kind === 'review'));
  await h.continueLetterboxdPublications();
  assert.equal(h.state.intents.length, 2);
});
it('charges directly queued work against the same two-item scheduled budget', async () => {
  for (const queued of [1, 2]) {
    const h = harness();
    h.setQueued(queued);
    await h.prepareLetterboxdPublications();
    h.verify();
    await h.continueLetterboxdPublications();
    assert.equal(h.state.intents.length, 2 - queued);
  }
});
it('uses latest content during a scoped check without admitting unrelated entries', async () => {
  for (const during of [false, true]) {
    const h = harness();
    const edit = () => {
      h.rows[0].text = 'Later edit';
    };
    if (during) h.afterPrepare(edit);
    await h.prepareLetterboxdPublications();
    if (!during) edit();
    h.rows.push({ ...h.rows[0], id: 'new', tmdbId: 4 });
    h.verify();
    await h.continueLetterboxdPublications();
    assert.ok(
      !h.state.intents.some((i) =>
        ['new'].includes(i.originEntityId!)
      )
    );
    const latest = h.state.intents.find(i => i.originEntityId === 'local:1');
    if (during) assert.equal(latest, undefined, 'admission race defers to the next scan');
    else assert.equal(latest?.desired.text, 'Later edit');
  }
});
it('a rapid edit cannot duplicate a dispatched or uncertain creation', async () => {
  for (const status of ['dispatched', 'unknown'] as const) {
    const h = harness();
    await h.prepareLetterboxdPublications();
    h.verify();
    await h.continueLetterboxdPublications();
    const original = h.state.intents.find(i => i.originEntityId === 'local:1')!;
    assert.ok(original);
    original.state = status;
    h.rows[0].text = 'Edited while creation is unresolved';
    h.rows[0].updatedAt = new Date().toISOString();
    await h.load().prepareLetterboxdPublications();
    await h.load().continueLetterboxdPublications();
    assert.equal(h.state.intents.filter(i => i.originEntityId === 'local:1').length, 1);
    assert.equal(original.state, status);
  }
});
it('honors opt-out, relink, enable generation, mapping failures and changes during mapping', async () => {
  for (const mutate of [
    (h: ReturnType<typeof harness>) => {
      h.rows.forEach((r) => {
        r.syncToLetterboxd = false;
      });
    },
    (h: ReturnType<typeof harness>) => {
      h.account.username = 'other';
    },
    (h: ReturnType<typeof harness>) => {
      h.state.settings[1].enabledSince = 2;
    },
    (h: ReturnType<typeof harness>) => {
      h.setMatch(false);
    },
    (h: ReturnType<typeof harness>) => {
      h.afterMatch(() => {
        h.state.settings[1].enabled = false;
      });
    },
  ]) {
    const h = harness();
    await h.prepareLetterboxdPublications();
    h.verify();
    mutate(h);
    await h.continueLetterboxdPublications();
    assert.equal(h.state.intents.length, 0);
  }
});
it('rejects expired observations and initial remote conflicts', async () => {
  for (const stale of [false, true]) {
    const h = harness();
    await h.prepareLetterboxdPublications();
    h.verify(stale ? null : 3);
    if (stale)
      h.observed.requests.forEach((r) => {
        r.observation!.observedAt -= 300001;
      });
    await h.continueLetterboxdPublications();
    assert.equal(h.state.intents.length, 0);
  }
});
it('uses the verified rating baseline to continue a scheduled rating-to-review revision', async () => {
  const h = harness();
  const job = queue.enqueueWrite(
    h.state,
    {
      userId: 1,
      account: 'prplmg',
      originId: 'old-rating',
      originEntityId: 'local:1',
      kind: 'rating',
      film: 'film-1',
      expected: { rating: null },
      desired: { rating: 4 },
    },
    'local',
    Date.now() - 10000
  );
  job.state = 'verified';
  await h.prepareLetterboxdPublications();
  h.verify(4);
  await h.continueLetterboxdPublications();
  assert.equal(h.state.intents.length, 2);
  assert.equal(h.state.intents[1].kind, 'review');
  assert.equal(h.state.intents[1].expected.rating, 4);
});
it('continues receipt-backed scheduled edits using the exact entry and fresh baseline', async () => {
  const h = harness();
  h.receipts.push({
    userId: 1,
    account: 'prplmg',
    originId: 'local:1',
    entryId: 'https://letterboxd.com/prplmg/film/film-1/',
    baseline: { rating: 4, text: '', spoiler: false },
    verifiedAt: Date.now() - 1000,
  });
  await h.prepareLetterboxdPublications();
  h.verify(4);
  await h.continueLetterboxdPublications();
  assert.equal(h.state.intents.length, 1);
  assert.equal(h.state.intents[0].entryId, h.receipts[0].entryId);
});
