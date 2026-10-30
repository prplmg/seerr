import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import type * as ObservationsApi from './letterboxdObservations';
import type {
  ObservationReport,
  ObservationState,
} from './letterboxdObservations';
import {
  claimObservation,
  findObservation,
  reportObservation,
  requestObservation,
  maintainObservationHealth,
} from './letterboxdObservations';
const scope = { userId: 1, account: 'prplmg', film: 'test-film' };
it('health retries a stale read once and retires it only after verified same-scope evidence',()=>{
 const state:ObservationState={version:1,requests:[]};
 const old=requestObservation(state,scope,1);claimObservation(state,scope,2);
 const unrelated=requestObservation(state,{...scope,createNew:true},3);
 unrelated.state='verified';unrelated.observation={rating:3,text:'',spoiler:false,observedAt:4};
 maintainObservationHealth(state,1000000);
 assert.equal(old.supersededBy,undefined);
 const retry=state.requests.find(r=>r.retryOf===old.id)!;assert.ok(retry);
 maintainObservationHealth(state,1000001);assert.equal(state.requests.length,3);
 retry.state='unknown';maintainObservationHealth(state,2000000);assert.equal(state.requests.length,3);
 retry.state='verified';retry.observation={rating:3,text:'',spoiler:false,observedAt:2000001};
 maintainObservationHealth(state,2000002);assert.equal(old.supersededBy,retry.id);
 assert.equal(old.state,'claimed'); // no fabricated verification or changed claim token
});
it('new-form observations have a distinct scope and retain dated inventory without binding the new review',()=>{
 const state:ObservationState={version:1,requests:[]};
 const normal=requestObservation(state,scope,100);
 const fresh=requestObservation(state,{...scope,createNew:true},100);
 assert.notEqual(normal.id,fresh.id);
 normal.state='unknown';
 const claim=claimObservation(state,scope,101)!;
 const entry='https://letterboxd.com/prplmg/film/test-film/2/';
 reportObservation(state,{...scope,createNew:true,id:claim.id,claimToken:claim.claimToken!,status:'verified',identityVerified:true,complete:true,observation:{rating:2.5,text:'',spoiler:false,observedAt:102,watched:true,diaryEntriesComplete:true,diaryEntryIds:[entry],diaryEntryDates:{[entry]:'2026-01-01'}}},103);
 assert.equal(findObservation(state,{...scope,createNew:true},0,104)?.entryId,undefined);
 assert.equal(findObservation(state,scope,0,104),null);
});
it('validates explicit dates for exactly the enumerated diary entries', () => {
  const entry = 'https://letterboxd.com/prplmg/film/test-film/2/';
  for (const dates of [
    null,
    [],
    {},
    { other: '2026-10-18' },
    ...[
      '2026-02-30',
      '2026-2-01',
      '0000-01-01',
      '2026-10-18T00:00:00Z',
      null,
    ].map((date) => ({ [entry]: date })),
  ]) {
    const { state, report } = setup();
    Object.assign(report.observation!, {
      diaryEntriesComplete: true,
      diaryEntryIds: [entry],
      diaryEntryDates: dates,
    });
    assert.throws(() => reportObservation(state, report, 103));
  }
  const { state, report } = setup();
  Object.assign(report.observation!, {
    watched: true,
    diaryEntriesComplete: true,
    diaryEntryIds: [entry],
    diaryEntryDates: { [entry]: '2024-02-29' },
  });
  reportObservation(state, report, 103);
  assert.equal(
    findObservation(state, scope, 0, 104)?.diaryEntryDates?.[entry],
    '2024-02-29'
  );
  report.observation!.diaryEntryDates![entry] = '2026-10-18';
  assert.equal(
    state.requests[0].observation?.diaryEntryDates?.[entry],
    '2024-02-29'
  );
  assert.throws(() => reportObservation(state, report, 104));
  const noInventory = setup();
  noInventory.report.observation!.diaryEntryDates = {};
  assert.throws(() =>
    reportObservation(noInventory.state, noInventory.report, 103)
  );
});
function setup() {
  const state: ObservationState = { version: 1, requests: [] };
  requestObservation(state, scope, 100);
  const claim = claimObservation(state, scope, 101)!;
  const report: ObservationReport = {
    ...scope,
    id: claim.id,
    claimToken: claim.claimToken!,
    status: 'verified',
    complete: true,
    identityVerified: true,
    observation: { rating: null, text: '', spoiler: false, observedAt: 102 },
  };
  return { state, report };
}
it('deduplicates pending requests and claims exactly once', () => {
  const { state } = setup();
  requestObservation(state, scope, 103);
  assert.equal(state.requests.length, 1);
  assert.equal(claimObservation(state, scope, 104), null);
});
it('accepts complete verified empty reads and expires them', () => {
  const { state, report } = setup();
  reportObservation(state, report, 103);
  assert.deepEqual(findObservation(state, scope, 0, 104)?.rating, null);
  assert.equal(findObservation(state, scope, 103, 104), null);
  assert.equal(findObservation(state, scope, 0, 400000), null);
  assert.equal(state.requests[0].observation?.watched, undefined);
  assert.equal(state.requests[0].observation?.diaryEntryIds, undefined);
  assert.equal(state.requests[0].observation?.diaryEntriesComplete, undefined);
});
it('preserves explicit playback evidence and rejects changed evidence on replay', () => {
  for (const complete of [false, true]) {
    const { state, report } = setup();
    Object.assign(report.observation!, {
      watched: false,
      diaryEntriesComplete: complete,
      diaryEntryIds: [],
    });
    reportObservation(state, report, 103);
    assert.deepEqual(findObservation(state, scope, 0, 104)?.diaryEntryIds, []);
    assert.equal(state.requests[0].observation?.diaryEntriesComplete, complete);
    assert.equal(reportObservation(state, report, 400000).state, 'verified');
    assert.throws(() =>
      reportObservation(
        state,
        { ...report, observation: { ...report.observation!, watched: true } },
        104
      )
    );
    assert.throws(() =>
      reportObservation(
        state,
        {
          ...report,
          observation: {
            ...report.observation!,
            diaryEntriesComplete: !complete,
          },
        },
        104
      )
    );
    report.observation!.diaryEntryIds!.push(
      'https://letterboxd.com/prplmg/film/test-film/2/'
    );
    assert.deepEqual(state.requests[0].observation?.diaryEntryIds, []);
    assert.throws(() => reportObservation(state, report, 104));
  }
});
it('validates bounded unique canonical diary inventory and strict optional booleans', () => {
  const entry = 'https://letterboxd.com/prplmg/film/test-film/2/';
  for (const patch of [
    { watched: null },
    { watched: 0 },
    { watched: 'false' },
    { diaryEntriesComplete: true },
    { diaryEntryIds: [] },
    { diaryEntriesComplete: null, diaryEntryIds: [] },
    { diaryEntriesComplete: 1, diaryEntryIds: [] },
    { diaryEntriesComplete: true, diaryEntryIds: null },
    ...[
      [entry, entry],
      [null],
      ['https://letterboxd.com/other/film/test-film/'],
      ['https://letterboxd.com/prplmg/film/other/'],
      [entry + '?page=1'],
      Array.from(
        { length: 1001 },
        (_, i) => `https://letterboxd.com/prplmg/film/test-film/${i + 1}/`
      ),
    ].map((diaryEntryIds) => ({ diaryEntriesComplete: true, diaryEntryIds })),
  ]) {
    const { state, report } = setup();
    Object.assign(report.observation!, patch);
    assert.throws(() => reportObservation(state, report, 103));
    assert.equal(state.requests[0].state, 'claimed');
  }
  const { state, report } = setup();
  Object.assign(report.observation!, {
    watched: true,
    diaryEntriesComplete: true,
    diaryEntryIds: [entry],
  });
  reportObservation(state, report, 103);
  assert.deepEqual(state.requests[0].observation?.diaryEntryIds, [entry]);
});
it('accepts identical durable report replay but rejects changed results', () => {
  const { state, report } = setup();
  reportObservation(state, report, 103);
  assert.equal(reportObservation(state, report, 400000).state, 'verified');
  assert.throws(() =>
    reportObservation(
      state,
      { ...report, observation: { ...report.observation!, rating: 4 } },
      104
    )
  );
});
it('requires complete identity, scoped claims and valid field values', () => {
  for (const override of [
    { complete: false },
    { identityVerified: false },
    { claimToken: 'wrong' },
    { film: 'other-film' },
    { account: 'other' },
    { observation: { rating: 9, text: '', spoiler: false, observedAt: 102 } },
    {
      observation: {
        rating: null,
        text: 'review',
        spoiler: false,
        observedAt: 102,
      },
    },
  ]) {
    const { state, report } = setup();
    assert.throws(() =>
      reportObservation(state, { ...report, ...override }, 103)
    );
    assert.equal(findObservation(state, scope, 0, 104), null);
  }
});
it('rejects cross-account and mismatching canonical entries', () => {
  const { state, report } = setup();
  for (const entryId of [
    'https://letterboxd.com/other/film/test-film/',
    'https://letterboxd.com/prplmg/film/other/',
    'https://evil.test/prplmg/film/test-film/',
  ])
    assert.throws(() =>
      reportObservation(
        state,
        { ...report, observation: { ...report.observation!, entryId } },
        103
      )
    );
  assert.throws(() => requestObservation(state, { ...scope, userId: 0 }));
});
it('unknown or ambiguous results never imply empty, or reuse older verified reads', () => {
  const { state, report } = setup();
  reportObservation(state, report, 103);
  requestObservation(state, scope, 104);
  const claim = claimObservation(state, scope, 105)!;
  reportObservation(
    state,
    {
      ...report,
      id: claim.id,
      claimToken: claim.claimToken!,
      status: 'ambiguous',
    },
    106
  );
  assert.equal(findObservation(state, scope, 0, 107), null);
});
it('rejects expired claims and stale or future observations', () => {
  for (const observedAt of [100, 104]) {
    const { state, report } = setup();
    assert.throws(() =>
      reportObservation(
        state,
        { ...report, observation: { ...report.observation!, observedAt } },
        103
      )
    );
  }
  const { state, report } = setup();
  assert.throws(() =>
    reportObservation(
      state,
      {
        ...report,
        observation: { ...report.observation!, observedAt: 400000 },
      },
      400000
    )
  );
  // Late delivery of an in-lease read is acknowledged, but never refreshed.
  reportObservation(state, report, 400000);
  assert.equal(findObservation(state, scope, 0, 400001), null);
});
it('persists claims and verified results across reloads with private atomic files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-observations-'));
  const load = () => {
    const exports = {} as typeof ObservationsApi;
    const code = ts.transpileModule(
      fs.readFileSync(
        path.join(__dirname, 'letterboxdObservations.ts'),
        'utf8'
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          esModuleInterop: true,
          target: ts.ScriptTarget.ES2020,
        },
      }
    ).outputText;
    vm.runInNewContext(code, {
      exports,
      URL,
      require: (id: string) =>
        id === '@server/utils/appDataVolume'
          ? { appDataPath: () => dir }
          : createRequire(__filename)(id),
    });
    return exports;
  };
  try {
    const first = load();
    first.updateObservations((s) => requestObservation(s, scope, 100));
    const second = load();
    const claim = second.updateObservations((s) =>
      claimObservation(s, scope, 101)
    )!;
    second.updateObservations((s) =>
      reportObservation(
        s,
        {
          ...claim,
          claimToken: claim.claimToken!,
          status: 'verified',
          complete: true,
          identityVerified: true,
          observation: {
            rating: null,
            text: '',
            spoiler: false,
            observedAt: 102,
            watched: false,
            diaryEntriesComplete: true,
            diaryEntryIds: [],
          },
        },
        103
      )
    );
    const third = load();
    assert.equal(
      third.findObservation(third.readObservations(), scope, 0, 104)
        ?.observedAt,
      102
    );
    assert.equal(
      fs.statSync(path.join(dir, 'letterboxd-observations.json')).mode & 0o777,
      0o600
    );
    const reloaded = third.findObservation(
      third.readObservations(),
      scope,
      0,
      104
    )!;
    assert.equal(reloaded.watched, false);
    assert.equal(reloaded.diaryEntriesComplete, true);
    assert.equal(reloaded.diaryEntryIds?.length, 0);
    assert.equal(fs.readdirSync(dir).length, 1);
    assert.throws(() =>
      third.updateObservations(() => {
        throw Error('abort');
      })
    );
    assert.equal(third.readObservations().requests.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it('repeated failed-read polls are bounded across restart and isolated by account/scope',()=>{
 let state:ObservationState={version:1,requests:[]};
 const first=requestObservation(state,scope,100);first.state='unknown';
 for(let now=101;now<900100;now+=1000)assert.equal(requestObservation(state,scope,now).id,first.id);
 state=JSON.parse(JSON.stringify(state));
 const second=requestObservation(state,scope,900100);assert.notEqual(second.id,first.id);second.state='unknown';
 assert.equal(requestObservation(state,scope,900101).id,second.id);
 assert.equal(requestObservation(state,scope,1800100).id,second.id);
 assert.notEqual(requestObservation(state,{...scope,userId:7,account:'other'},900101).id,second.id);
 assert.equal(state.requests.filter(r=>r.userId===1).length,2);
});

it('stops after three consecutive failed reads instead of growing the durable queue forever',()=>{
 const state:ObservationState={version:1,requests:[]};
 for(const now of [1,900001,2700001])requestObservation(state,scope,now).state='unknown';
 assert.equal(state.requests.length,3);
 for(const now of [10000000,100000000,1000000000])requestObservation(state,scope,now);
 assert.equal(state.requests.length,3);
 assert.notEqual(requestObservation(state,{...scope,film:'another-film'},1000000000).id,state.requests[2].id);
});
