import assert from 'node:assert/strict';
import { it } from 'node:test';
import { importKey, letterboxdEntryIdentity } from './letterboxdImport';
import {
  mergeSyncReceipt,
  verifiedReviewEchoBinding,
  boundPlaybackOrigin,
  outboundCreateDisposition,
} from './letterboxdSyncReceipts';
const receipt = {
  userId: 1,
  account: 'prplmg',
  originId: 'party:watch-123',
  entryId: 'https://letterboxd.com/prplmg/film/jaws/2/',
};
it('explicit review binding preserves playback idempotency and rejects a second review', () => {
  const diary = {...receipt, originId: `tautulli:${'a'.repeat(64)}`, diaryBaseline: {watchedDate:'2026-10-19',rewatch:false}, verifiedAt:10};
  const review = {...receipt, originId:'local:1:8373:review', boundDiaryOriginId:diary.originId, baseline:{rating:4,text:'Review',spoiler:false}, verifiedAt:20};
  const rows = mergeSyncReceipt(mergeSyncReceipt([],diary),review);
  const local = {externalEntryId:diary.entryId, watchedDate:'2026-10-19'};
  assert.equal(boundPlaybackOrigin(rows,1,'prplmg',diary.entryId,local),diary.originId);
  for (const invalid of [null,{...local,externalEntryId:null},{...local,watchedDate:'2026-10-18'}])
    assert.equal(boundPlaybackOrigin(rows,1,'prplmg',diary.entryId,invalid),undefined);
  assert.equal(boundPlaybackOrigin(rows,2,'prplmg',diary.entryId,local),undefined);
  assert.equal(boundPlaybackOrigin(rows,1,'other',diary.entryId,local),undefined);
  assert.equal(rows.length,2);
  assert.equal(outboundCreateDisposition(rows,{userId:1,account:'prplmg',originId:diary.originId,source:'local'}),'already-linked');
  assert.deepEqual(rows.reduce((all, r) => mergeSyncReceipt(all,r), [] as typeof rows), rows);
  assert.equal(mergeSyncReceipt(rows,{...review,verifiedAt:21}).length,2);
  assert.equal(mergeSyncReceipt(rows,{...diary,echoObserved:true}).length,2);
  assert.throws(()=>mergeSyncReceipt(rows,{...review,originId:'local:1:8373:other'}),/conflict/);
  assert.throws(()=>mergeSyncReceipt([diary],{...review,boundDiaryOriginId:undefined}),/conflict/);
  assert.throws(()=>mergeSyncReceipt([diary],{...review,account:'other'}));
});
it('diary baselines preserve verified dates and rewatches with legacy compatibility', () => {
  assert.equal(mergeSyncReceipt([], receipt)[0].diaryBaseline, undefined);
  const diaryBaseline = { watchedDate: '2024-02-29', rewatch: true };
  const rows = mergeSyncReceipt([], {
    ...receipt,
    diaryBaseline,
    verifiedAt: 10,
  });
  assert.deepEqual(rows[0].diaryBaseline, diaryBaseline);
  assert.deepEqual(
    mergeSyncReceipt(rows, { ...receipt, echoObserved: true })[0].diaryBaseline,
    diaryBaseline
  );
  const edited = { watchedDate: '2024-03-01', rewatch: false };
  assert.deepEqual(
    mergeSyncReceipt(rows, {
      ...receipt,
      diaryBaseline: edited,
      verifiedAt: 20,
    })[0].diaryBaseline,
    edited
  );
  assert.throws(
    () =>
      mergeSyncReceipt(rows, {
        ...receipt,
        diaryBaseline: edited,
        verifiedAt: 9,
      }),
    /Stale/
  );
  for (const invalid of [
    null,
    { watchedDate: null, rewatch: false },
    { watchedDate: '2026-02-29', rewatch: false },
    { watchedDate: '2026-1-1', rewatch: false },
    { watchedDate: '2026-10-18', rewatch: 'yes' },
  ]) {
    assert.throws(
      () =>
        mergeSyncReceipt([], {
          ...receipt,
          diaryBaseline: invalid as unknown as typeof diaryBaseline,
        }),
      /diary baseline/
    );
  }
});
it('entry identity survives date edits but distinguishes numbered rewatches', () => {
  assert.equal(
    importKey(receipt.entryId, '2026-01-01'),
    importKey(receipt.entryId, '2026-01-02')
  );
  assert.notEqual(
    importKey(receipt.entryId, null),
    importKey('https://letterboxd.com/prplmg/film/jaws/', null)
  );
  assert.equal(
    letterboxdEntryIdentity('https://letterboxd.com/film/jaws/'),
    null
  );
});
it('replayed receipts are idempotent; conflicting origins or destinations are rejected', () => {
  const rows = mergeSyncReceipt([], receipt);
  assert.deepEqual(mergeSyncReceipt(rows, receipt), rows);
  assert.throws(() =>
    mergeSyncReceipt(rows, { ...receipt, originId: 'other' })
  );
  assert.throws(() =>
    mergeSyncReceipt(rows, {
      ...receipt,
      entryId: 'https://letterboxd.com/prplmg/film/jaws/3/',
    })
  );
  assert.throws(() => mergeSyncReceipt([], { ...receipt, account: 'other' }));
});
it('imports never create outbound echoes, linked events do not create again, remaps stop', () => {
  const input = { ...receipt, source: 'local' as const };
  assert.equal(outboundCreateDisposition([], input), 'unlinked');
  assert.equal(outboundCreateDisposition([receipt], input), 'already-linked');
  assert.equal(
    outboundCreateDisposition([receipt], { ...input, source: 'letterboxd' }),
    'imported-no-create'
  );
  assert.equal(
    outboundCreateDisposition([receipt], { ...input, account: 'other' }),
    'account-changed'
  );
});
it('receipt updates preserve identity and reject stale verification or invalid echo metadata', () => {
  const first = {
    ...receipt,
    baseline: { rating: 4, text: 'Keep spoilers protected', spoiler: true },
    verifiedAt: 20,
    echoObserved: false,
  };
  const rows = mergeSyncReceipt([], first);
  assert.equal(
    mergeSyncReceipt(rows, { ...first, echoObserved: true })[0].echoObserved,
    true
  );
  assert.throws(
    () => mergeSyncReceipt(rows, { ...first, verifiedAt: 10 }),
    /Stale/
  );
  assert.throws(
    () =>
      mergeSyncReceipt(rows, {
        ...first,
        echoObserved: 'yes' as unknown as boolean,
      }),
    /echo/
  );
  assert.throws(
    () =>
      mergeSyncReceipt(rows, {
        ...first,
        baseline: { ...first.baseline, rating: NaN },
      }),
    /baseline/
  );
});

it('binds an undated authored review only to one exact verified playback echo',()=>{
 const diary={...receipt,originId:`party:${'b'.repeat(64)}`,diaryBaseline:{watchedDate:'2026-10-28',rewatch:false},verifiedAt:10};
 const fields={rating:2,text:'',spoiler:false};
 const local={...fields,id:'local:1:9:entry',source:'local',tmdbId:9,mediaType:'movie',externalEntryId:null,watchedDate:null};
 const echo={...fields,userId:1,source:'letterboxd',tmdbId:9,mediaType:'movie',externalEntryId:receipt.entryId,watchedDate:'2026-10-28'};
 const check=(l=local,e=[echo],d=fields)=>verifiedReviewEchoBinding([diary],1,'prplmg',receipt.entryId,l,e,d);
 assert.equal(check()?.originId,diary.originId);
 for(const e of [[],[echo,echo],[{...echo,userId:7}],[{...echo,tmdbId:10}],[{...echo,text:'changed'}],[{...echo,watchedDate:'2026-10-29'}]])assert.equal(check(local,e),undefined);
 assert.equal(check({...local,rating:3}),undefined);
 assert.equal(check(local,[echo],{...fields,rating:4}),undefined);
});
