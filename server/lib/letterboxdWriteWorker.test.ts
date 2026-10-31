import * as lifecycle from './letterboxdObservationLifecycle';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as observationApi from './letterboxdObservations';
import {
  requestObservation,
  type ObservationState,
} from './letterboxdObservations';
import { boundPlaybackOrigin, mergeSyncReceipt, type SyncReceipt } from './letterboxdSyncReceipts';
import * as queueApi from './letterboxdWriteQueue';
import * as recoveryApi from './letterboxdWriteRecovery';
import {
  emptyWriteState,
  enqueueWrite,
  setWriteEnabled,
} from './letterboxdWriteQueue';
import {
  exchangeObservationState,
  exchangeWriteState,
  parseSupportedObservations,
  parseSupportedWriteKinds,
  type exchangeObservations,
  type exchangeWrites,
} from './letterboxdWriteWorker';
const binding = {
  instance: 'pilot',
  userId: 1,
  username: 'prplmg',
  enabled: true,
};

function durableHarness(boundDiary = false) {
  const observed: observationApi.ObservationState = {
    version: 1,
    requests: [],
  };
  const { state, job } = setup('review');
  let receipts: SyncReceipt[] = [];
  if (boundDiary) {
    job.originEntityId = 'local:1:8373:review';
    job.entryId = 'https://letterboxd.com/prplmg/film/jaws/';
    receipts = [{userId:1,account:'prplmg',originId:`tautulli:${'a'.repeat(64)}`,entryId:job.entryId,verifiedAt:1,diaryBaseline:{watchedDate:'2026-10-19',rewatch:false}}];
  }
  const events: string[] = [];
  let locked = false;
  let failCommit = false;
  let playbackCalls = 0;
  class Account {}
  const deps: Record<string, unknown> = {
    './letterboxdObservationLifecycle': lifecycle,
    '@server/routes/social': { refreshRecentMoviePlayback: async () => {} },
    './letterboxdPlaybackContinuation': {
      prepareLetterboxdPlaybackPublications: async()=>{},
      continueLetterboxdPlaybackPublications: async () => {
        assert.equal(locked, false);
        playbackCalls++;
      },
    },
    './letterboxdObservations': {
      ...observationApi,
      updateObservations: (fn: (s: typeof observed) => unknown) => {
        const result = fn(observed);
        events.push('observation-commit');
        return result;
      },
    },
    './letterboxdWriteQueue': {
      ...queueApi,
      readWriteState: () => state,
      updateWriteState: (fn: (s: typeof state) => unknown) => {
        const result = fn(state);
        if (failCommit) throw Error('disk');
        events.push('write-commit');
        return result;
      },
    },
    './letterboxdSyncReceipts': {
      boundPlaybackOrigin,
      readSyncReceipts: () => receipts,
      recordSyncReceipt: (receipt: SyncReceipt) => {
        receipts = mergeSyncReceipt(receipts, receipt);
        events.push('receipt');
      },
    },
    './letterboxdWriteRecovery': recoveryApi,
    './reviewPublishingPolicy': { cancelUnpublishableReviewWrites: () => {} },
    './letterboxdExportPolicy': { exportPublicationHeld: async()=>false },
    './letterboxdFilmEvidence': { evidenceFromVerifiedWrite: () => undefined, recordFilmEvidence: () => {}, readFilmEvidence:()=>[] },
    '@server/datasource': {
      getRepository: (entity: unknown) => ({
        findOneBy: async () =>
          entity === Account ? { enabled: true, username: 'prplmg' } : boundDiary ? {externalEntryId:job.entryId,watchedDate:'2026-10-19'} : null,
      }),
    },
    '@server/entity/MovieReview': {
      LetterboxdAccount: Account,
      MovieReview: class {},
    },
    './letterboxdBrowser': {
      readBrowserState: () => ({ bindings: [binding] }),
    },
    './reviews': {
      refreshReviewsAfterPublication: (userId: number, verifiedAt: number) => {
        assert.equal(locked, false);
        assert.equal(userId, 1);
        assert.ok(verifiedAt > 0);
        assert.ok(events.includes('write-commit'));
        assert.equal(job.state, 'verified');
      },
      withReviewLock: async (_id: number, fn: () => Promise<unknown>) => {
        assert.equal(locked, false);
        locked = true;
        try {
          return await fn();
        } finally {
          locked = false;
        }
      },
    },
    './letterboxdPublicationContinuation': {
      prepareLetterboxdPublications: async () => {},
      continueLetterboxdPublications: async () => {
        assert.equal(locked, false);
        events.push('continue');
      },
    },
  };
  const exports = {} as {
    exchangeObservations: typeof exchangeObservations;
    exchangeWrites: typeof exchangeWrites;
  };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(path.join(__dirname, 'letterboxdWriteWorker.ts'), 'utf8'),
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
      require: (name: string) => {
        if (!(name in deps)) throw Error(name);
        return deps[name];
      },
    }
  );
  return {
    exports,
    observed,
    state,
    job,
    events,
    receipts: () => receipts,
    playbackCalls: () => playbackCalls,
    failCommit: () => {
      failCommit = true;
    },
  };
}
it('verified review acknowledgement can decorate its explicit diary without recreating either entry', async () => {
  const h = durableHarness(true);
  exchangeWriteState(h.state,binding,undefined,undefined,['review']);
  const report = {id:h.job.id,outcome:'verified' as const,identity:'prplmg',values:h.job.desired,entryId:h.job.entryId};
  await h.exports.exchangeWrites('pilot',report);
  await h.exports.exchangeWrites('pilot',report);
  assert.equal(h.job.state,'verified');
  assert.equal(h.state.intents.length,1);
  assert.equal(h.receipts().length,2);
  assert.equal(h.receipts()[1].boundDiaryOriginId,h.receipts()[0].originId);
});
it('observation report commits before continuation; invalid report never resumes', async () => {
  const h = durableHarness();
  const scope = { userId: 1, account: 'prplmg', film: 'jaws' };
  requestObservation(h.observed, scope);
  observationApi.claimObservation(h.observed, scope);
  const report: observationApi.ObservationReport = {
    ...scope,
    id: h.observed.requests[0].id,
    claimToken: h.observed.requests[0].claimToken!,
    status: 'verified',
    identityVerified: true,
    complete: true,
    observation: {
      rating: null,
      text: '',
      spoiler: false,
      observedAt: Date.now(),
    },
  };
  await assert.rejects(
    h.exports.exchangeObservations('pilot', { ...report, complete: false })
  );
  assert.deepEqual(h.events, []);
  await h.exports.exchangeObservations('pilot', report);
  assert.deepEqual(h.events, ['observation-commit', 'continue']);
  await h.exports.exchangeObservations('pilot', report);
  assert.deepEqual(h.events.slice(2), ['observation-commit', 'continue']);
  assert.equal(h.playbackCalls(), 2);
});
it('write continuation happens after receipt and commit outside the review lock, including poll recovery', async () => {
  const h = durableHarness();
  exchangeWriteState(h.state, binding, undefined, undefined, ['review']);
  const report = {
    id: h.job.id,
    outcome: 'verified' as const,
    identity: 'prplmg',
    values: h.job.desired,
    entryId: 'https://letterboxd.com/prplmg/film/jaws/',
  };
  await h.exports.exchangeWrites('pilot', report);
  assert.deepEqual(h.events, ['receipt', 'write-commit', 'continue']);
  await h.exports.exchangeWrites('pilot', report);
  assert.deepEqual(h.events.slice(3), ['write-commit', 'continue']);
  await h.exports.exchangeWrites('pilot');
  assert.deepEqual(h.events.slice(5), ['write-commit', 'continue']);
  assert.equal(h.playbackCalls(), 3);
});
it('a failed durable write commit never invokes continuation', async () => {
  const h = durableHarness();
  h.failCommit();
  await assert.rejects(h.exports.exchangeWrites('pilot'));
  assert.deepEqual(h.events, []);
  assert.equal(h.playbackCalls(), 0);
});
it('uncertain reports are stored without triggering publication continuation', async () => {
  const h = durableHarness();
  exchangeWriteState(h.state, binding, undefined, undefined, ['review']);
  await h.exports.exchangeWrites('pilot', { id: h.job.id, outcome: 'unknown' });
  assert.deepEqual(h.events, ['write-commit']);
  assert.equal(h.playbackCalls(), 0);
});
it('observation capabilities are opt-in and never include mutating actions', () => {
  const state: ObservationState = { version: 1, requests: [] };
  requestObservation(state, { userId: 1, account: 'prplmg', film: 'jaws' });
  for (const supported of [undefined, []])
    assert.equal(
      exchangeObservationState(state, binding, undefined, supported).action,
      'idle'
    );
  assert.equal(state.requests[0].state, 'queued');
  for (const invalid of [
    null,
    'review_observe',
    ['watchlist'],
    ['rating'],
    ['review_observe', 'review_observe'],
  ])
    assert.throws(() => parseSupportedObservations(invalid));
  assert.equal(
    exchangeObservationState(state, binding, undefined, ['review_observe'])
      .action,
    'review_observe'
  );
  assert.equal(
    exchangeObservationState(state, binding, undefined, ['review_observe'])
      .action,
    'idle'
  );
});
it('observation reports enforce binding and accept complete empty reads and replay', () => {
  const state: ObservationState = { version: 1, requests: [] };
  const scope = { userId: 1, account: 'prplmg', film: 'jaws' };
  requestObservation(state, scope);
  exchangeObservationState(state, binding, undefined, ['review_observe']);
  const job = state.requests[0];
  const report = {
    ...scope,
    id: job.id,
    claimToken: job.claimToken!,
    status: 'verified' as const,
    identityVerified: true,
    complete: true,
    observation: {
      rating: null,
      text: '',
      spoiler: false,
      observedAt: Date.now(),
    },
  };
  assert.throws(() =>
    exchangeObservationState(state, binding, { ...report, userId: 2 })
  );
  assert.throws(() =>
    exchangeObservationState(state, { ...binding, username: 'other' }, report)
  );
  assert.throws(() =>
    exchangeObservationState(state, binding, {
      ...report,
      identityVerified: false,
    })
  );
  assert.throws(() =>
    exchangeObservationState(state, binding, { ...report, complete: false })
  );
  assert.equal(
    exchangeObservationState(state, { ...binding, enabled: false }, report)
      .action,
    'idle'
  );
  assert.equal(exchangeObservationState(state, binding, report).action, 'idle');
  assert.equal(state.requests[0].state, 'verified');
});
it('unhealthy observation bindings cannot claim; failed reads remain reportable and replayable', () => {
  const state: ObservationState = { version: 1, requests: [] };
  const scope = { userId: 1, account: 'prplmg', film: 'jaws' };
  requestObservation(state, scope);
  for (const extra of [
    { enabled: false },
    { issue: 'logout' },
    { job: { state: 'running' } },
  ])
    assert.equal(
      exchangeObservationState(state, { ...binding, ...extra }, undefined, [
        'review_observe',
      ]).action,
      'idle'
    );
  exchangeObservationState(state, binding, undefined, ['review_observe']);
  const job = state.requests[0];
  const report = {
    ...scope,
    id: job.id,
    claimToken: job.claimToken!,
    status: 'unknown' as const,
    identityVerified: false,
    complete: false,
  };
  exchangeObservationState(state, binding, report);
  exchangeObservationState(state, binding, report);
  assert.equal(job.state, 'unknown');
  assert.equal(job.observation, undefined);
});
function setup(kind: 'rating' | 'review' | 'watched' | 'diary') {
  const state = emptyWriteState();
  setWriteEnabled(state, 1, 'prplmg', true);
  const values = {
    rating: { rating: 4 },
    review: { rating: 4, text: 'Review', spoiler: true },
    watched: { watched: true },
    diary: { watchedDate: '2026-10-18', rewatch: false },
  }[kind];
  const job = enqueueWrite(
    state,
    {
      userId: 1,
      account: 'prplmg',
      film: 'jaws',
      originId: 'revision',
      originEntityId: 'local-entry',
      kind,
      expected: values,
      desired: values,
    },
    'local',
    0
  );
  return { state, job };
}
it('dispatches each supported media kind once, never watchlists', () => {
  for (const kind of ['rating', 'review', 'watched', 'diary'] as const) {
    const { state, job } = setup(kind);
    assert.equal(
      exchangeWriteState(state, binding, undefined, undefined, [kind]).action,
      'media_write'
    );
    assert.equal(job.state, 'dispatched');
    assert.equal(
      exchangeWriteState(state, binding, undefined, undefined, [kind]).action,
      'idle'
    );
  }
  const { state, job } = setup('rating');
  job.kind = 'watchlist';
  assert.equal(
    exchangeWriteState(state, binding, undefined, undefined, [
      'rating',
      'review',
      'watched',
      'diary',
    ]).action,
    'idle'
  );
});
it('combined diary waits for capable workers and acknowledges all fields in one receipt', () => {
  const {state,job}=setup('diary');
  Object.assign(job.expected,{rating:4,text:'',spoiler:false});
  Object.assign(job.desired,{rating:4.5,text:'New review',spoiler:true});
  assert.equal(exchangeWriteState(state,binding,undefined,undefined,['diary']).action,'idle');
  assert.equal(exchangeWriteState(state,binding,undefined,undefined,['diary','diary-content']).action,'media_write');
  const receipts:SyncReceipt[]=[];
  assert.throws(()=>exchangeWriteState(state,binding,{id:job.id,outcome:'verified',identity:'prplmg',entryId:'https://letterboxd.com/prplmg/film/jaws/',values:{watchedDate:'2026-10-18',rewatch:false}},r=>receipts.push(r)));
  exchangeWriteState(state,binding,{id:job.id,outcome:'verified',identity:'prplmg',entryId:'https://letterboxd.com/prplmg/film/jaws/',values:job.desired},r=>receipts.push(r));
  assert.equal(job.state,'verified');assert.equal(receipts.length,1);
  assert.deepEqual(receipts[0].baseline,{rating:4.5,text:'New review',spoiler:true});
  assert.deepEqual(receipts[0].diaryBaseline,{watchedDate:'2026-10-18',rewatch:false});
});
it('verified review records canonical receipt and baseline, including after disabling', () => {
  const { state, job } = setup('review');
  exchangeWriteState(state, binding, undefined, undefined, ['review']);
  setWriteEnabled(state, 1, 'prplmg', false);
  const receipts: SyncReceipt[] = [];
  const report = {
    id: job.id,
    outcome: 'verified' as const,
    identity: 'prplmg',
    values: job.desired,
    entryId: 'https://letterboxd.com/prplmg/film/jaws/',
  };
  exchangeWriteState(state, binding, report, (r) => receipts.push(r));
  exchangeWriteState(state, binding, report, (r) => receipts.push(r));
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].originId, 'local-entry');
  assert.deepEqual(receipts[0].baseline, job.desired);
  assert.equal(receipts[0].entryId, report.entryId);
  assert.equal(receipts[0].diaryBaseline, undefined);
});
it('verified diary records event identity; uncertain or invalid results do not', () => {
  const { state, job } = setup('diary');
  exchangeWriteState(state, binding, undefined, undefined, ['diary']);
  const receipts: SyncReceipt[] = [];
  assert.throws(() =>
    exchangeWriteState(
      state,
      binding,
      {
        id: job.id,
        outcome: 'verified',
        identity: 'prplmg',
        values: job.desired,
      },
      (r) => receipts.push(r)
    )
  );
  assert.equal(receipts.length, 0);
  exchangeWriteState(
    state,
    binding,
    {
      id: job.id,
      outcome: 'verified',
      identity: 'prplmg',
      values: job.desired,
      entryId: 'https://letterboxd.com/prplmg/film/jaws/2/',
    },
    (r) => receipts.push(r)
  );
  assert.equal(receipts[0].originId, 'local-entry');
  assert.deepEqual(receipts[0].diaryBaseline, job.desired);
  assert.equal(receipts[0].baseline, undefined);
  const next = setup('review');
  exchangeWriteState(next.state, binding, undefined, undefined, ['review']);
  exchangeWriteState(
    next.state,
    binding,
    { id: next.job.id, outcome: 'unknown' },
    () => assert.fail('No uncertain receipt')
  );
});
it('receipt failure propagates so durable queue transaction cannot acknowledge it', () => {
  const { state, job } = setup('review');
  exchangeWriteState(state, binding, undefined, undefined, ['review']);
  assert.throws(
    () =>
      exchangeWriteState(
        state,
        binding,
        {
          id: job.id,
          outcome: 'verified',
          identity: 'prplmg',
          values: job.desired,
          entryId: 'https://letterboxd.com/prplmg/film/jaws/',
        },
        () => {
          throw Error('disk unavailable');
        }
      ),
    /disk unavailable/
  );
});

it('missing, empty, or nonmatching capabilities never claim a job', () => {
  const { state, job } = setup('watched');
  for (const supported of [undefined, [], ['rating', 'review', 'diary']]) {
    assert.equal(
      exchangeWriteState(state, binding, undefined, undefined, supported)
        .action,
      'idle'
    );
    assert.equal(job.state, 'queued');
  }
});

it('validates bounded unique capabilities and excludes watchlist', () => {
  assert.deepEqual(parseSupportedWriteKinds(undefined), []);
  assert.deepEqual(parseSupportedWriteKinds(['diary', 'review']), [
    'diary',
    'review',
  ]);
  for (const value of [
    null,
    'rating',
    {},
    ['rating', 'rating'],
    ['watchlist'],
    ['unknown'],
    [1],
    ['rating', 'review', 'diary', 'watched', 'rating'],
  ]) {
    assert.throws(() => parseSupportedWriteKinds(value));
    const { state, job } = setup('rating');
    assert.throws(() =>
      exchangeWriteState(state, binding, undefined, undefined, value)
    );
    assert.equal(job.state, 'queued');
  }
});
