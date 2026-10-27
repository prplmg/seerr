import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  claimWrite,
  emptyWriteState,
  enqueueWrite,
  finishWrite,
  setPreparationFailure,
  setWriteEnabled,
} from './letterboxdWriteQueue';
it('preparation retries preserve first failure and successful checks reset the grace period', () => {
  const state = emptyWriteState();
  setPreparationFailure(state, 1, 'prplmg', 'party-history', true, 100);
  setPreparationFailure(state, 1, 'prplmg', 'party-history', true, 200);
  assert.equal(state.preparationFailures![0].firstFailedAt, 100);
  assert.equal(state.preparationFailures![0].attempts, 2);
  setPreparationFailure(state, 1, 'prplmg', 'party-history', false, 300);
  assert.equal(state.preparationFailures!.length, 0);
  setPreparationFailure(state, 1, 'prplmg', 'party-history', true, 400);
  assert.equal(state.preparationFailures![0].firstFailedAt, 400);
  assert.equal(state.preparationFailures![0].attempts, 1);
});
const intent = {
  userId: 1,
  account: 'prplmg',
  originId: 'rating:operation-1',
  kind: 'rating' as const,
  film: 'jaws',
  expected: { rating: null },
  desired: { rating: 4 },
};
it('negotiated durable delivery replays the same ID after response loss, but never legacy or uncertain writes', () => {
  const s = setup();
  const job = enqueueWrite(s, intent, 'local', 0);
  assert.equal(claimWrite(s, 1, 'prplmg', ['rating'], true)?.id, job.id);
  const restored = JSON.parse(JSON.stringify(s));
  assert.equal(claimWrite(restored, 1, 'prplmg', ['rating'], true)?.id, job.id);
  assert.equal(restored.intents.length, 1);
  assert.equal(claimWrite(restored, 1, 'prplmg', ['rating']), null);
  assert.equal(claimWrite(restored, 2, 'prplmg', ['rating'], true), null);
  finishWrite(restored, 1, 'prplmg', { id: job.id, outcome: 'unknown' });
  assert.equal(claimWrite(restored, 1, 'prplmg', ['rating'], true), null);
  const legacy = setup();
  enqueueWrite(legacy, intent, 'local', 0);
  claimWrite(legacy, 1, 'prplmg', ['rating']);
  assert.equal(claimWrite(legacy, 1, 'prplmg', ['rating'], true), null);
  setWriteEnabled(s, 1, 'prplmg', false);
  assert.equal(claimWrite(s, 1, 'prplmg', ['rating'], true), null);
});
it('late verified result resolves transport uncertainty without re-dispatch and still validates identity', () => {
  const s = setup(),
    job = enqueueWrite(s, intent, 'local', 0);
  claimWrite(s, 1, 'prplmg', ['rating']);
  finishWrite(s, 1, 'prplmg', { id: job.id, outcome: 'unknown' });
  assert.throws(() =>
    finishWrite(s, 1, 'prplmg', {
      id: job.id,
      outcome: 'verified',
      identity: 'other',
      values: { rating: 4 },
    })
  );
  assert.equal(
    finishWrite(s, 1, 'prplmg', {
      id: job.id,
      outcome: 'verified',
      identity: 'prplmg',
      values: { rating: 4 },
    }),
    true
  );
  assert.equal(claimWrite(s, 1, 'prplmg', ['rating']), null);
});
it('verified acknowledgements replay safely and reject contradictory reports', () => {
  const state = setup();
  const job = enqueueWrite(state, intent, 'local', 0);
  claimWrite(state, 1, 'prplmg', ['rating']);
  const report = {
    id: job.id,
    outcome: 'verified' as const,
    identity: 'prplmg',
    values: { rating: 4 },
  };
  assert.equal(finishWrite(state, 1, 'prplmg', report), true);
  assert.equal(finishWrite(state, 1, 'prplmg', report), false);
  assert.throws(() =>
    finishWrite(state, 1, 'prplmg', { ...report, outcome: 'unknown' })
  );
  assert.throws(() =>
    finishWrite(state, 1, 'prplmg', { ...report, values: { rating: 3 } })
  );
  assert.throws(() => finishWrite(state, 2, 'prplmg', report));
});
function setup() {
  const s = emptyWriteState();
  setWriteEnabled(s, 1, 'prplmg', true);
  return s;
}
it('writes default off and enablement is isolated by user and account', () => {
  const s = emptyWriteState();
  assert.throws(() => enqueueWrite(s, intent, 'local', 0));
  setWriteEnabled(s, 7, 'evegrissel', true);
  assert.throws(() => enqueueWrite(s, intent, 'local', 0));
  assert.throws(() => enqueueWrite(s, { ...intent, userId: 7 }, 'local', 0));
  const job = enqueueWrite(
    s,
    { ...intent, userId: 7, account: 'evegrissel' },
    'local',
    1
  );
  assert.equal(claimWrite(s, 1, 'prplmg', ['rating']), null);
  assert.equal(claimWrite(s, 7, 'prplmg', ['rating']), null);
  assert.equal(claimWrite(s, 7, 'evegrissel', ['rating'])?.id, job.id);
  assert.throws(() =>
    finishWrite(s, 1, 'prplmg', {
      id: job.id,
      outcome: 'verified',
      identity: 'prplmg',
      values: { rating: 4 },
    })
  );
  assert.equal(
    finishWrite(s, 7, 'evegrissel', {
      id: job.id,
      outcome: 'verified',
      identity: 'evegrissel',
      values: { rating: 4 },
    }),
    true
  );
});
it('an uncertain account does not block another account or share its operation IDs', () => {
  const s = setup();
  assert.throws(
    () => setWriteEnabled(s, 7, 'prplmg', true),
    /already assigned/
  );
  setWriteEnabled(s, 7, 'evegrissel', true);
  const first = enqueueWrite(s, intent, 'local', 1);
  claimWrite(s, 1, 'prplmg', ['rating']);
  finishWrite(s, 1, 'prplmg', { id: first.id, outcome: 'unknown' });
  const second = enqueueWrite(
    s,
    { ...intent, userId: 7, account: 'evegrissel' },
    'local',
    2
  );
  assert.notEqual(first.id, second.id);
  assert.equal(claimWrite(s, 7, 'evegrissel', ['rating'])?.id, second.id);
  assert.equal(claimWrite(s, 1, 'prplmg', ['rating']), null);
});
it('publishing toggle never enables Letterboxd watchlist writes', () => {
  const state = setup();
  assert.throws(
    () =>
      enqueueWrite(
        state,
        {
          ...intent,
          kind: 'watchlist',
          expected: { member: false },
          desired: { member: true },
        },
        'local',
        0
      ),
    /watchlist publishing is disabled/
  );
  const old = {
    ...intent,
    kind: 'watchlist' as const,
    id: 'old-pilot',
    created: 0,
    state: 'queued' as const,
    expected: { member: false },
    desired: { member: true },
  };
  state.intents.push(old);
  assert.equal(claimWrite(state, 1, 'prplmg', ['watchlist']), null);
});
it('imports cannot echo out; replayed local operation IDs do not duplicate writes', () => {
  const s = setup();
  assert.throws(() => enqueueWrite(s, intent, 'letterboxd', 0));
  const a = enqueueWrite(s, intent, 'local', 1);
  assert.equal(enqueueWrite(s, intent, 'local', 2).id, a.id);
  assert.equal(s.intents.length, 1);
  assert.throws(() =>
    enqueueWrite(s, { ...intent, desired: { rating: 3 } }, 'local', 3)
  );
});
it('durable dispatched state blocks re-delivery after restart and disable cancels only queued writes', () => {
  const s = setup();
  enqueueWrite(s, intent, 'local', 0);
  assert.ok(claimWrite(s, 1, 'prplmg', ['rating']));
  const restored: typeof s = JSON.parse(JSON.stringify(s));
  assert.equal(claimWrite(restored, 1, 'prplmg'), null);
  enqueueWrite(restored, { ...intent, originId: 'next' }, 'local', 1);
  setWriteEnabled(restored, 1, 'prplmg', false);
  assert.deepEqual(
    restored.intents.map((i) => i.state),
    ['dispatched', 'cancelled']
  );
  assert.equal(claimWrite(restored, 1, 'prplmg'), null);
});
it('review text and spoiler are atomic; diary requires a real supplied date', () => {
  const s = setup();
  assert.throws(() =>
    enqueueWrite(
      s,
      {
        ...intent,
        kind: 'review',
        expected: { text: '' },
        desired: { text: 'spoiler' },
      },
      'local',
      0
    )
  );
  assert.throws(() =>
    enqueueWrite(
      s,
      {
        ...intent,
        kind: 'diary',
        expected: { watchedDate: null, rewatch: false },
        desired: { watchedDate: '2026-02-30', rewatch: false },
      },
      'local',
      0
    )
  );
  enqueueWrite(
    s,
    {
      ...intent,
      kind: 'review',
      expected: { rating: null, text: '', spoiler: false },
      desired: { rating: 4, text: 'Spoiler', spoiler: true },
    },
    'local',
    0
  );
});
it('changed account cannot claim another account writes', () => {
  const s = setup();
  enqueueWrite(s, intent, 'local', 0);
  assert.equal(claimWrite(s, 1, 'other'), null);
});
