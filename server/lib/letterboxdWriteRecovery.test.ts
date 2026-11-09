import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { ObservationState } from './letterboxdObservations';
import type { SyncReceipt } from './letterboxdSyncReceipts';
import type { WriteState } from './letterboxdWriteQueue';
import {
  DIARY_RECOVERY_EXPORT_MAX_AGE_MS,
  planDiaryWriteRecovery,
  prepareWriteRecovery,
  reconcileDiaryWriteRecovery,
  reconcileWriteRecovery,
} from './letterboxdWriteRecovery';

function fixture() {
  const created = Date.parse('2026-11-04T02:19:00Z');
  const capturedAt = Date.parse('2026-11-09T03:00:37Z');
  const entry = 'https://letterboxd.com/zelzingb/film/a-quiet-place-part-ii/';
  const short = 'https://boxd.it/h9q6yd';
  const scope = {
    userId: 7,
    account: 'zelzingb',
    film: 'a-quiet-place-part-ii',
  };
  const writes: WriteState = {
    version: 1,
    settings: {
      7: { account: scope.account, enabled: true },
    },
    intents: [
      {
        ...scope,
        id: '33865693-277a-47b2-b291-27ef100ba1b3',
        kind: 'diary',
        state: 'unknown',
        created,
        originId: 'playback-write',
        originEntityId: `tautulli:${'a'.repeat(64)}`,
        desired: { watchedDate: '2026-11-03', rewatch: false },
        expected: { watchedDate: null, rewatch: false },
      },
    ],
  };
  const observations: ObservationState = {
    version: 1,
    requests: [
      {
        ...scope,
        id: 'pre-write',
        requestedAt: created - 2000,
        state: 'verified',
        observation: {
          observedAt: created - 1000,
          rating: null,
          text: '',
          spoiler: false,
          diaryEntriesComplete: true,
          diaryEntryIds: [],
        },
      },
      {
        ...scope,
        id: 'editor-unavailable',
        requestedAt: capturedAt - 1000,
        state: 'unknown',
      },
    ],
  };
  const evidence: Parameters<typeof planDiaryWriteRecovery>[2] = {
    userId: scope.userId,
    account: scope.account,
    baseline: {
      revision: 'export-nov9',
      capturedAt,
      snapshot: {
        account: scope.account,
        complete: true,
        active: {
          'watched.csv': [
            {
              'Letterboxd URI':
                'https://letterboxd.com/film/a-quiet-place-part-ii/',
            },
          ],
          'ratings.csv': [],
          'reviews.csv': [],
          'diary.csv': [
            {
              Name: 'A Quiet Place Part II',
              Year: '2020',
              'Letterboxd URI': short,
              'Watched Date': '2026-11-03',
              Rewatch: '',
            },
          ],
        },
      },
      mappings: { [short]: { externalUrl: entry } },
    },
  };
  return {
    writes,
    observations,
    evidence,
    entry,
    short,
    now: capturedAt + 1000,
  };
}

it('recovers the Nov 3 zelza export regression despite a failed editor read, with receipt before transition', () => {
  const f = fixture();
  const original = structuredClone(f);
  const plans = planDiaryWriteRecovery(
    f.writes,
    f.observations,
    f.evidence,
    f.now
  );
  assert.equal(plans.length, 1);
  assert.deepEqual(f, original); // planner is reusable and pure
  const receipts: SyncReceipt[] = [];
  const ids = reconcileDiaryWriteRecovery(
    f.writes,
    f.observations,
    f.evidence,
    (receipt) => {
      assert.equal(f.writes.intents[0].state, 'unknown');
      assert.equal(f.writes.intents[0].entryId, undefined);
      receipts.push(receipt);
    },
    f.now
  );
  assert.deepEqual(ids, [f.writes.intents[0].id]);
  assert.equal(receipts[0].entryId, f.entry);
  assert.deepEqual(receipts[0].diaryBaseline, {
    watchedDate: '2026-11-03',
    rewatch: false,
  });
  assert.equal(receipts[0].baseline, undefined);
  assert.equal(receipts[0].echoObserved, true);
  assert.equal(f.writes.intents[0].state, 'verified');
  assert.equal(f.writes.intents.length, 1);
  assert.equal(f.observations.requests.length, 2);
  assert.deepEqual(
    reconcileDiaryWriteRecovery(
      f.writes,
      f.observations,
      f.evidence,
      () => assert.fail('must not repeat receipt'),
      f.now
    ),
    []
  );
});

const negatives: [string, (f: ReturnType<typeof fixture>) => void][] = [
  [
    'wrong user',
    (f) => {
      f.evidence.userId = 8;
    },
  ],
  [
    'wrong account',
    (f) => {
      f.evidence.account = 'other';
    },
  ],
  [
    'wrong snapshot account',
    (f) => {
      f.evidence.baseline.snapshot.account = 'other';
    },
  ],
  [
    'disabled publishing',
    (f) => {
      f.writes.settings[7].enabled = false;
    },
  ],
  [
    'wrong entry account',
    (f) => {
      f.evidence.baseline.mappings![f.short].externalUrl = f.entry.replace(
        'zelzingb',
        'other'
      );
    },
  ],
  [
    'wrong film',
    (f) => {
      f.evidence.baseline.mappings![f.short].externalUrl = f.entry.replace(
        'a-quiet-place-part-ii',
        'another-film'
      );
    },
  ],
  [
    'wrong date',
    (f) => {
      f.evidence.baseline.snapshot.active['diary.csv'][0]['Watched Date'] =
        '2026-11-02';
    },
  ],
  [
    'wrong rewatch',
    (f) => {
      f.evidence.baseline.snapshot.active['diary.csv'][0].Rewatch = 'Yes';
    },
  ],
  [
    'missing rewatch',
    (f) => {
      delete f.evidence.baseline.snapshot.active['diary.csv'][0].Rewatch;
    },
  ],
  [
    'unknown rewatch',
    (f) => {
      f.evidence.baseline.snapshot.active['diary.csv'][0].Rewatch = 'false';
    },
  ],
  [
    'preexisting entry',
    (f) => {
      f.observations.requests[0].observation!.diaryEntryIds = [f.entry];
    },
  ],
  [
    'incomplete inventory',
    (f) => {
      f.observations.requests[0].observation!.diaryEntriesComplete = false;
    },
  ],
  [
    'no baseline',
    (f) => {
      f.observations.requests.shift();
    },
  ],
  [
    'wrong baseline account',
    (f) => {
      f.observations.requests[0].account = 'other';
    },
  ],
  [
    'wrong baseline user',
    (f) => {
      f.observations.requests[0].userId = 8;
    },
  ],
  [
    'wrong baseline film',
    (f) => {
      f.observations.requests[0].film = 'another-film';
    },
  ],
  [
    'stale pre-write baseline',
    (f) => {
      f.observations.requests[0].requestedAt -= 600000;
      f.observations.requests[0].observation!.observedAt -= 600000;
    },
  ],
  [
    'post-write baseline',
    (f) => {
      f.observations.requests[0].observation!.observedAt =
        f.writes.intents[0].created + 1;
    },
  ],
  [
    'uncertain baseline',
    (f) => {
      f.observations.requests[0].state = 'ambiguous';
    },
  ],
  [
    'stale export',
    (f) => {
      f.now += DIARY_RECOVERY_EXPORT_MAX_AGE_MS;
    },
  ],
  [
    'future export',
    (f) => {
      f.evidence.baseline.capturedAt = f.now + 1;
    },
  ],
  [
    'pre-write export',
    (f) => {
      f.evidence.baseline.capturedAt = f.writes.intents[0].created;
    },
  ],
  [
    'missing collection',
    (f) => {
      delete f.evidence.baseline.snapshot.active['reviews.csv'];
    },
  ],
  [
    'incomplete export',
    (f) => {
      Object.assign(f.evidence.baseline.snapshot, { complete: false });
    },
  ],
  [
    'unresolved short link',
    (f) => {
      delete f.evidence.baseline.mappings;
    },
  ],
  [
    'malformed mapped URL',
    (f) => {
      f.evidence.baseline.mappings![f.short].externalUrl = 'invalid';
    },
  ],
  [
    'duplicate canonical alias',
    (f) => {
      f.evidence.baseline.snapshot.active['diary.csv'].push({
        ...f.evidence.baseline.snapshot.active['diary.csv'][0],
        'Letterboxd URI': f.entry,
      });
    },
  ],
  [
    'second same-date entry',
    (f) => {
      f.evidence.baseline.snapshot.active['diary.csv'].push({
        ...f.evidence.baseline.snapshot.active['diary.csv'][0],
        'Letterboxd URI': `${f.entry}2/`,
        Rewatch: 'Yes',
      });
    },
  ],
  [
    'unresolved possible duplicate',
    (f) => {
      f.evidence.baseline.snapshot.active['diary.csv'].push({
        ...f.evidence.baseline.snapshot.active['diary.csv'][0],
        'Letterboxd URI': 'https://boxd.it/unknown',
      });
    },
  ],
  [
    'combined content intent',
    (f) => {
      f.writes.intents[0].desired.rating = 4;
    },
  ],
  [
    'review missing viewing fields',
    (f) => {
      f.evidence.baseline.snapshot.active['reviews.csv'].push({
        'Letterboxd URI': f.entry,
        Review: 'Other content',
      });
    },
  ],
  [
    'inline review content',
    (f) => {
      f.evidence.baseline.snapshot.active['diary.csv'][0].Review =
        'Other content';
    },
  ],
  [
    'update intent',
    (f) => {
      f.writes.intents[0].entryId = f.entry;
    },
  ],
  [
    'missing origin',
    (f) => {
      delete f.writes.intents[0].originEntityId;
    },
  ],
  [
    'two local candidates',
    (f) => {
      f.writes.intents.push({
        ...f.writes.intents[0],
        id: 'second',
        originEntityId: 'second-origin',
      });
    },
  ],
];
for (const [name, change] of negatives)
  it(`does not recover ${name}`, () => {
    const f = fixture();
    change(f);
    const before = structuredClone(f);
    assert.deepEqual(
      reconcileDiaryWriteRecovery(
        f.writes,
        f.observations,
        f.evidence,
        () => assert.fail('must not persist unsupported evidence'),
        f.now
      ),
      []
    );
    assert.deepEqual(f, before);
  });

it('preserves unknown state on receipt persistence failure and safely retries evidence', () => {
  const f = fixture();
  const before = structuredClone(f.writes);
  assert.throws(
    () =>
      reconcileDiaryWriteRecovery(
        f.writes,
        f.observations,
        f.evidence,
        () => {
          throw Error('disk full');
        },
        f.now
      ),
    /disk full/
  );
  assert.deepEqual(f.writes, before);
  assert.equal(
    reconcileDiaryWriteRecovery(
      f.writes,
      f.observations,
      f.evidence,
      () => undefined,
      f.now
    ).length,
    1
  );
});

it('accepts exact rewatch evidence and canonical entries without mappings', () => {
  const f = fixture();
  f.writes.intents[0].desired.rewatch = true;
  Object.assign(f.evidence.baseline.snapshot.active['diary.csv'][0], {
    'Letterboxd URI': f.entry,
    Rewatch: 'Yes',
  });
  delete f.evidence.baseline.mappings;
  assert.equal(
    planDiaryWriteRecovery(f.writes, f.observations, f.evidence, f.now).length,
    1
  );
});

it('retains existing review recovery and receipt ordering', () => {
  const f = fixture();
  const job = f.writes.intents[0];
  job.kind = 'review';
  job.desired = { rating: 4, text: 'Review', spoiler: false };
  job.recovery = {
    observationId: 'review-check',
    requestedAt: f.now - 100,
    status: 'checking',
  };
  f.observations.requests.push({
    userId: job.userId,
    account: job.account,
    film: job.film,
    id: 'review-check',
    state: 'verified',
    requestedAt: f.now - 100,
    observation: {
      rating: 4,
      text: 'Review',
      spoiler: false,
      observedAt: f.now,
      entryId: f.entry,
    },
  });
  reconcileWriteRecovery(
    f.writes,
    f.observations,
    (receipt) => {
      assert.equal(job.state, 'unknown');
      assert.deepEqual(receipt.baseline, job.desired);
    },
    f.now
  );
  assert.equal(job.state, 'verified');
});

it('scopes receipt-only recovery to reconcileIds without hiding competing intents', () => {
  const f = fixture();
  f.evidence.reconcileIds = ['unrelated'];
  assert.deepEqual(
    planDiaryWriteRecovery(f.writes, f.observations, f.evidence, f.now),
    []
  );
  f.evidence.reconcileIds = [f.writes.intents[0].id];
  assert.equal(
    planDiaryWriteRecovery(f.writes, f.observations, f.evidence, f.now).length,
    1
  );
  f.writes.intents.push({ ...f.writes.intents[0], id: 'competitor' });
  assert.deepEqual(
    planDiaryWriteRecovery(f.writes, f.observations, f.evidence, f.now),
    []
  );
});

it('rejects the entry when Zelza had already logged it before the write', () => {
  const f = fixture();
  const prior = f.observations.requests[0].observation!;
  prior.diaryEntryIds = [f.entry];
  prior.diaryEntryDates = { [f.entry]: '2026-11-03' };
  assert.deepEqual(
    planDiaryWriteRecovery(f.writes, f.observations, f.evidence, f.now),
    []
  );
});

it('persists read-only recovery backoff and retries without another write',()=>{
 const f=fixture(),job=f.writes.intents[0];job.kind='review';job.desired={rating:4,text:'hello',spoiler:false};
 f.observations.requests=[];
 prepareWriteRecovery(f.writes,f.observations,f.now);
 const first=job.recovery!.observationId;assert.equal(job.recovery!.attempts,1);
 const request=f.observations.requests[0];request.state='unknown';
 reconcileWriteRecovery(f.writes,f.observations,()=>{throw Error('Must not verify');},f.now+1);
 const due=job.recovery!.nextAttemptAt!;assert(due>f.now);
 prepareWriteRecovery(f.writes,f.observations,due-1);assert.equal(job.recovery!.observationId,first);
 const restored=JSON.parse(JSON.stringify(f.writes));prepareWriteRecovery(restored,f.observations,due);
 assert.notEqual(restored.intents[0].recovery.observationId,first);
 assert.equal(restored.intents[0].recovery.attempts,2);
 assert.equal(restored.intents[0].state,'unknown');assert.equal(restored.intents.length,1);
 assert(f.observations.requests[0].retired);
});

function reviewedFixture() {
  const f = fixture();
  const diary = f.evidence.baseline.snapshot.active['diary.csv'][0];
  diary.Rating = '3';
  f.evidence.baseline.snapshot.active['reviews.csv'].push({
    ...diary, Review: 'la neta si divierte un buen',
  });
  return f;
}

it('associates a reviewed diary without changing review/rating or issuing another write', () => {
  const f = reviewedFixture();
  const evidence = structuredClone(f.evidence);
  const observations = structuredClone(f.observations);
  const settings = structuredClone(f.writes.settings);
  const receipts: SyncReceipt[] = [];
  const apply = () => reconcileDiaryWriteRecovery(f.writes, f.observations, f.evidence, r => {
    assert.equal(f.writes.intents[0].state, 'unknown');
    receipts.push(r);
  }, f.now);
  assert.deepEqual(apply(), [f.writes.intents[0].id]);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].entryId, f.entry);
  assert.equal(receipts[0].baseline, undefined); // No review/rating baseline ownership.
  assert.deepEqual(receipts[0].diaryBaseline, {watchedDate:'2026-11-03',rewatch:false});
  assert.deepEqual(f.evidence, evidence);
  assert.deepEqual(f.observations, observations);
  assert.deepEqual(f.writes.settings, settings);
  assert.equal(f.writes.intents.length, 1);
  assert.equal(f.writes.intents[0].state, 'verified');
  assert.deepEqual(apply(), []); // Replayed export never creates a second association.
});

for (const [name, change] of negatives.filter(([name]) => name !== 'inline review content'))
  it(`reviewed diary still rejects ${name}`, () => {
    const f = reviewedFixture(); change(f);
    assert.deepEqual(planDiaryWriteRecovery(f.writes,f.observations,f.evidence,f.now), []);
  });

for (const [name, change] of [
  ['conflicting review date', (f: ReturnType<typeof fixture>) => { f.evidence.baseline.snapshot.active['reviews.csv'][0]['Watched Date']='2026-11-04'; }],
  ['conflicting review rewatch', (f: ReturnType<typeof fixture>) => { f.evidence.baseline.snapshot.active['reviews.csv'][0].Rewatch='Yes'; }],
  ['other reviewed viewing same day', (f: ReturnType<typeof fixture>) => { f.evidence.baseline.snapshot.active['reviews.csv'][0]['Letterboxd URI']=f.entry+'2/'; }],
  ['duplicate review alias', (f: ReturnType<typeof fixture>) => { f.evidence.baseline.snapshot.active['reviews.csv'].push({...f.evidence.baseline.snapshot.active['reviews.csv'][0],'Letterboxd URI':f.entry}); }],
] as const) it(`does not associate ${name}`, () => {
  const f=reviewedFixture(); change(f);
  assert.deepEqual(planDiaryWriteRecovery(f.writes,f.observations,f.evidence,f.now),[]);
});

it('reviewed entry receipt failure leaves the pending write unchanged', () => {
  const f=reviewedFixture(), before=structuredClone(f);
  assert.throws(()=>reconcileDiaryWriteRecovery(f.writes,f.observations,f.evidence,()=>{throw Error('Sync identity conflict');},f.now),/identity conflict/);
  assert.deepEqual(f,before);
});
