import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  parseWorkerHealth,
  summarizeWorkerHealth,
} from './letterboxdSyncHealth';
import {
  claimWrite,
  emptyWriteState,
  type WriteIntent,
  type WriteKind,
} from './letterboxdWriteQueue';
it('distinguishes missing, stale, paused and ready runtime state without changing settings', () => {
  const now = 1000000;
  const report = {
    paused: true,
    pauseReason: 'read-check',
    supportedWriteKinds: ['rating', 'review'],
    errors: [
      { stage: 'lists', at: now - 100, type: 'HTTPError', httpStatus: 409 },
    ],
  };
  const health = parseWorkerHealth(report, now)!;
  const intents: WriteIntent[] = [intent('watched', {}, now - 5000)];
  assert.equal(
    summarizeWorkerHealth(undefined, intents, now).runtime,
    'unknown'
  );
  assert.equal(summarizeWorkerHealth(health, intents, now).runtime, 'paused');
  assert.equal(
    summarizeWorkerHealth(health, intents, now).unsupportedQueued,
    1
  );
  assert.equal(
    summarizeWorkerHealth(health, intents, now).recentErrors.length,
    1
  );
  assert.equal(
    summarizeWorkerHealth({ ...health, paused: false }, intents, now).runtime,
    'blocked'
  );
  assert.equal(
    summarizeWorkerHealth(health, intents, now + 600001).runtime,
    'stale'
  );
  assert.equal(
    summarizeWorkerHealth(health, intents, now + 600001).unsupportedQueued,
    null
  );
  assert.equal(report.paused, true);
  assert.equal(
    parseWorkerHealth(
      {
        ...report,
        errors: [{ stage: 'lists', at: now + 120000, type: 'HTTPError' }],
      },
      now
    )!.errors[0].at,
    now
  );
});
it('rejects malformed health and exposes no arbitrary error payload', () => {
  assert.equal(parseWorkerHealth(undefined), undefined);
  for (const value of [
    null,
    {},
    { paused: 'yes' },
    {
      paused: true,
      pauseReason: 'manual',
      supportedWriteKinds: [],
      errors: [{ stage: 'lists', at: Date.now(), type: 'private message' }],
    },
  ])
    assert.throws(() => parseWorkerHealth(value));
  const v = parseWorkerHealth({
    paused: false,
    pauseReason: 'none',
    supportedWriteKinds: [],
    errors: [],
    secret: 'not exposed',
  })!;
  assert(!('secret' in v));
});

function intent(
  kind: WriteKind,
  desired: Record<string, unknown>,
  created = 1000
): WriteIntent {
  return {
    id: 'test',
    userId: 1,
    account: 'test',
    originId: 'test',
    film: 'https://letterboxd.com/film/test/',
    kind,
    desired,
    expected: {},
    created,
    state: 'queued',
  };
}
it('health and both claim paths agree across capabilities and diary payload shapes', () => {
  const kinds: WriteKind[] = [
    'rating',
    'review',
    'watched',
    'diary',
    'watchlist',
  ];
  const capabilities = [
    'rating',
    'review',
    'watched',
    'diary',
    'diary-content',
  ] as const;
  for (let mask = 0; mask < 2 ** capabilities.length; mask++) {
    const supported = capabilities.filter((_, index) => mask & (1 << index));
    for (const kind of kinds) {
      for (const desired of [
        {},
        { rating: 0 },
        { rating: null },
        { rating: 4.5 },
        { rating: undefined },
        { text: 'review' },
      ]) {
        const job = intent(kind, desired);
        const health = parseWorkerHealth(
          {
            paused: false,
            pauseReason: 'none',
            supportedWriteKinds: supported,
            errors: [],
          },
          1000
        )!;
        const summary = summarizeWorkerHealth(health, [job], 1000);
        const expected =
          kind !== 'watchlist' &&
          supported.some((k) => k === kind) &&
          (kind !== 'diary' ||
            !('rating' in desired) ||
            supported.includes('diary-content'));
        assert.equal(
          summary.unsupportedQueued,
          expected ? 0 : 1,
          JSON.stringify({ kind, desired, supported })
        );
        assert.equal(summary.runtime, expected ? 'ready' : 'blocked');
        const state = emptyWriteState();
        state.settings[1] = { account: 'test', enabled: true };
        state.intents = [{ ...job }];
        assert.equal(!!claimWrite(state, 1, 'test', supported), expected);
        state.intents = [
          { ...job, state: 'dispatched', durableDelivery: true },
        ];
        assert.equal(!!claimWrite(state, 1, 'test', supported, true), expected);
        assert.equal(job.state, 'queued', 'health must not mutate the queue');
      }
    }
  }
});
it('blocked reflects only queued capabilities and preserves paused/stale/unknown precedence', () => {
  const health = parseWorkerHealth(
    {
      paused: false,
      pauseReason: 'none',
      supportedWriteKinds: ['diary', 'rating'],
      errors: [],
    },
    1000
  )!;
  const blocked = intent('diary', { rating: 0 });
  const supported = { ...intent('rating', { rating: 3 }), id: 'rating' };
  assert.equal(summarizeWorkerHealth(health, [], 1000).runtime, 'ready');
  const mixed = summarizeWorkerHealth(health, [blocked, supported], 1000);
  assert.equal(mixed.runtime, 'blocked');
  assert.equal(mixed.unsupportedQueued, 1);
  for (const state of [
    'dispatched',
    'verified',
    'conflict',
    'unknown',
    'cancelled',
  ] as const) {
    assert.equal(
      summarizeWorkerHealth(health, [{ ...blocked, state }], 1000)
        .unsupportedQueued,
      0
    );
  }
  assert.equal(
    summarizeWorkerHealth({ ...health, paused: true }, [blocked], 1000).runtime,
    'paused'
  );
  assert.equal(
    summarizeWorkerHealth(health, [blocked], 601001).runtime,
    'stale'
  );
  assert.equal(
    summarizeWorkerHealth(health, [blocked], 601001).unsupportedQueued,
    null
  );
  assert.equal(
    summarizeWorkerHealth(undefined, [blocked], 1000).runtime,
    'unknown'
  );
  const state = emptyWriteState();
  state.settings[1] = { enabled: true, account: 'test' };
  state.intents = [blocked, supported];
  assert.equal(
    claimWrite(state, 1, 'test', ['diary', 'rating'])?.id,
    'rating',
    'a blocked diary must not prevent a supported queued rating'
  );
});
it('reports unresolved content and the next read-only recovery instead of ready',()=>{
 const now=Date.now(),job=intent('review',{});job.state='unknown';job.recovery={observationId:'read',requestedAt:now,status:'unavailable',nextAttemptAt:now+900000};
 const health=parseWorkerHealth({paused:false,pauseReason:'none',supportedWriteKinds:['review'],errors:[]},now)!;
 const result=summarizeWorkerHealth(health,[job],now);
 assert.equal(result.runtime,'blocked');assert.equal(result.heldWrites,1);assert.equal(result.nextRecoveryAt,now+900000);
});
