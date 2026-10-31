import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retireCompletedObservations } from './letterboxdObservationLifecycle';
import { requestObservation,claimObservation,maintainObservationHealth,findObservation,reportObservation,type ObservationState } from './letterboxdObservations';
import { observationHealthIssues } from './letterboxdBrowserState';
import type { WriteIntent } from './letterboxdWriteQueue';
const scope={userId:1,account:'prplmg',film:'iboy'};
const intent={...scope,id:'write',originEntityId:'event',originId:'revision',kind:'diary',state:'verified',created:20,verifiedAt:30,expected:{},desired:{}} as WriteIntent;
function fixture(){const s:ObservationState={version:1,requests:[]};requestObservation(s,scope,10,'playback:event');claimObservation(s,scope,11);s.requests[0].state='unknown';return s;}
test('verified owning publication retires work across restart; no retry, claim, baseline or false alert',()=>{
 const s=fixture();retireCompletedObservations(s,[intent],40);
 const restored:ObservationState=JSON.parse(JSON.stringify(s));maintainObservationHealth(restored,1000000);
 assert.equal(restored.requests.length,1);assert.equal(restored.requests[0].state,'unknown');
 assert.equal(claimObservation(restored,scope,1000000),null);assert.equal(findObservation(restored,scope,0,1000000),null);
 assert.equal(observationHealthIssues(restored.requests,1000000).length,0);
 const old=restored.requests[0];reportObservation(restored,{...scope,id:old.id,claimToken:old.claimToken!,status:'unknown',identityVerified:false,complete:false},1000001);
 assert.ok(old.retired);
 const next=requestObservation(restored,scope,1000002,'playback:new-event');assert.notEqual(next.id,old.id);assert.equal(claimObservation(restored,scope,1000003)?.id,next.id);
});
test('unresolved, unrelated, older, different-account and partially completed shared work still alert',()=>{
 for(const changes of [{state:'unknown'},{userId:7},{account:'other'},{film:'other'},{originEntityId:'other'},{created:1}]){
 const s=fixture();retireCompletedObservations(s,[{...intent,...changes} as WriteIntent],40);assert.equal(s.requests[0].retired,undefined);assert.equal(observationHealthIssues(s.requests,1000000).length,1);
 }
 const s=fixture();s.requests[0].owners!.push('playback:another');retireCompletedObservations(s,[intent],40);assert.equal(s.requests[0].retired,undefined);
});
test('health scans alone never retry abandoned reads',()=>{const s=fixture();for(let n=1;n<10;n++)maintainObservationHealth(s,n*1000000);assert.equal(s.requests.length,1);assert.equal(observationHealthIssues(s.requests,10000000).length,1);});
test('explicit consolidation retires its playback work, never unrelated owners or changed review content',async()=>{
 const {retireConsolidatedPlaybackObservations:retire}=await import('./letterboxdObservationLifecycle');
 const entry='https://letterboxd.com/prplmg/film/iboy/';
 const local={id:'local:1',userId:1,viewingEventId:'event',externalEntryId:entry,watchedDate:'2026-10-28',rating:2,text:'',spoiler:false};
 const receipts=[{userId:1,account:'prplmg',originId:'local:1',entryId:entry,boundDiaryOriginId:'party:1',baseline:{rating:2,text:'',spoiler:false}},{userId:1,account:'prplmg',originId:'party:1',entryId:entry,diaryBaseline:{watchedDate:'2026-10-28',rewatch:false},verifiedAt:20}];
 const s=fixture();retire(s,[local],receipts,40);assert.ok(s.requests[0].retired);
 for(const row of [{...local,rating:3},{...local,viewingEventId:'different'},{...local,userId:7}]) {const pending=fixture();retire(pending,[row],receipts,40);assert.equal(pending.requests[0].retired,undefined);}
});
