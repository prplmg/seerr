const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/automation.js','utf8');
function context(extra={}){
  // Disable worker startup/storage initialization only; exercise real poll wiring.
  const code=source.slice(0,source.indexOf('chrome.alarms.onAlarm.addListener'))
    .replace(/const instanceId = new Promise\([\s\S]*?\n\}\);/,"const instanceId=Promise.resolve('instance');");
  const ctx={URL,Date,crypto:{randomUUID:()=> 'execution'},importScripts(){},
    setTimeout:fn=>{fn();},...extra};
  vm.createContext(ctx);vm.runInContext(code,ctx);return ctx;
}
test('stable timeout keeps last allowlisted reason without exposing arbitrary text',async()=>{
  const c=context();let count=0;
  const result=await c.stableMediaRead(async()=>({complete:false,reason:++count===1?'editor-unavailable':'secret page contents'}),async()=>{});
  assert.equal(result.reason,'editor-unavailable');assert.equal(count,24);
  assert.equal((await c.stableMediaRead(async()=>({complete:false,reason:'private data'}),async()=>{})).reason,'media-state-not-stable');
});
test('stable successful read and challenge preserve existing behavior',async()=>{
  const c=context();let count=0;
  const result=await c.stableMediaRead(async()=>++count===1?{complete:false,reason:'editor-unavailable'}:{complete:true,account:'alice',values:{rating:2}},async()=>{});
  assert.equal(result.complete,true);assert.equal(result.reason,undefined);
  assert.equal((await c.stableMediaRead(async()=>({challenge:true,complete:false}),async()=>{})).challenge,true);
});
async function run({action='media_write',read={complete:false,reason:'editor-unavailable'},apply,scriptError,success=false,inventory={diaryEntriesComplete:false,diaryEntryIds:[]},jobOverrides={}}={}){
  const reports=[];reports.visits=[];reports.scripts=[];reports.inventoryReads=0;
  const job={id:'job',instance:'instance',action,userId:1,account:'alice',film:'jaws',kind:'review',claimedAt:Date.now(),desired:{rating:2,text:'',spoiler:false},...jobOverrides};
  const chrome={extension:{isAllowedIncognitoAccess:fn=>fn(false)},runtime:{getManifest:()=>({version:'test'})},
    windows:{getAll:async()=>[{}]},tabs:{create:async({url})=>{reports.visits.push(url);return {id:1};},remove:async()=>{},get:async()=>({})},
    scripting:{executeScript:async request=>{reports.scripts.push(request);if(scriptError)throw Error(scriptError);return [{result:typeof read==='function'?read(request):read}];}},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},alarms:{create(){}}};
  const c=context({chrome,reviewWritePage(){},ratingWritePage(){},watchedWritePage(){},inspectWatchedState(){},
    collectDiaryInventory:async()=>{reports.inventoryReads++;return inventory;},
    executeWriteIntent:async(_job,adapter)=>{
      try{await adapter.readFresh();if(apply)await adapter.apply();}
      catch{} // Canonical workflow reduces thrown failures to write-not-verified.
      return success?{outcome:'verified',entryId:'https://letterboxd.com/alice/film/jaws/'}:{outcome:'unknown',reason:'write-not-verified'};
    }});
  c.bridge=async()=>job;c.deliver=async(path,data)=>{if(path==='/queue/result')reports.push(data);return {started:true};};
  c.workflowStorage=async()=>null;c.pendingResult=async()=>null;
  c.ready=async()=>({identity:'alice'});
  await c.poll();return reports;
}
test('write read diagnostic precedes generic outcome and survives final result',async()=>{
  const reports=await run();const final=reports.at(-1);
  assert.equal(reports.find(r=>r.payload.stage==='media-read-incomplete').payload.error,'editor-unavailable');
  assert.equal(final.final,true);assert.equal(final.payload.error,'editor-unavailable');
  assert.equal(final.payload.failureReason,'write-not-verified');assert.equal(final.payload.writeOutcome,'unknown');
});
test('observation failure retains reason without changing protocol',async()=>{
  const reports=await run({action:'review_observe'});
  assert.equal(reports.at(-1).payload.error,'editor-unavailable');
  assert.equal(reports.at(-1).payload.observationStatus,'unknown');
  assert.equal(reports.at(-1).payload.observation,undefined);
});
test('script exception is recorded with a bounded code before generic failure',async()=>{
  const reports=await run({scriptError:'Cannot access page containing private token'});
  assert.equal(reports.at(-1).payload.error,'script-permission-blocked');
  assert.doesNotMatch(JSON.stringify(reports),/private token/);
});
test('apply rejection preserves structural code before workflow swallows exception',async()=>{
  const reports=await run({read:{complete:true,account:'alice',values:{} ,reason:'save-unavailable'},apply:true});
  assert.equal(reports.at(-2).payload.stage,'media-apply-rejected');
  assert.equal(reports.at(-1).payload.error,'save-unavailable');
});
test('diagnostics do not leak across fresh reads or successful results',async()=>{
  const c=context(),d=c.mediaDiagnostics();const record=async p=>d.payload(p);
  await d.read(async()=>({complete:false,reason:'editor-unavailable'}),record);
  await d.read(async()=>({complete:true,values:{}}),record);
  assert.equal(d.payload({outcome:'unknown',error:'write-not-verified'},true).error,'write-not-verified');
  await d.read(async()=>({complete:false,reason:'editor-unavailable'}),record);
  assert.equal(d.payload({outcome:'succeeded'},true).error,undefined);
});
test('unknown adapter reason never escapes and cannot turn failure into success',async()=>{
  const reports=await run({read:{complete:false,reason:'private page HTML'}});
  assert.doesNotMatch(JSON.stringify(reports),/private page HTML/);
  assert.equal(reports.at(-1).payload.outcome,'unknown');
  assert.equal(reports.at(-1).payload.error,'media-state-not-stable');
});

test('latest safe failure wins and unknown reasons cannot overwrite it',()=>{
  const d=context().mediaDiagnostics();
  d.payload({stage:'media-read-incomplete',error:'editor-unavailable'});
  d.payload({stage:'media-apply-rejected',error:'save-unavailable'});
  const unknown=d.payload({stage:'media-apply-rejected',error:'arbitrary private text'});
  assert.equal(unknown.error,'script-observation-failed');
  assert.equal(d.payload({outcome:'unknown',error:'write-not-verified'},true).error,'save-unavailable');
});

const entry='https://letterboxd.com/alice/film/jaws/';
const singleInventory={diaryEntriesComplete:true,diaryEntryIds:[entry],diaryEntryDates:{[entry]:'2026-11-03'}};
const scope={action:'review_observe',account:'alice',film:'jaws'};
const unavailable={complete:false,reason:'editor-unavailable'};
test('fallback selects only a unique canonical dated entry, never values',async()=>{
  const c=context();
  assert.equal(await c.diaryObservationFallback(scope,unavailable,async()=>singleInventory),entry);
  for(const inventory of [
    {...singleInventory,diaryEntriesComplete:false},
    {...singleInventory,diaryEntryIds:[]},
    {...singleInventory,diaryEntryIds:[entry,entry+'2/']},
    {...singleInventory,diaryEntryIds:[entry.replace('alice','bob')]},
    {...singleInventory,diaryEntryIds:[entry.replace('jaws','alien')]},
    {...singleInventory,diaryEntryIds:[entry+'?foo=1']},
    {...singleInventory,diaryEntryDates:{[entry]:'2026-02-30'}},
    {...singleInventory,diaryEntryDates:undefined}
  ])assert.equal(await c.diaryObservationFallback(scope,unavailable,async()=>inventory),undefined);
});
test('explicit entry/createNew and other failures never request fallback inventory',async()=>{
  const c=context();let reads=0;
  const read=async()=>{reads++;return singleInventory;};
  for(const job of [{...scope,entryId:entry},{...scope,createNew:true},{...scope,createNew:false},{...scope,action:'media_write'}])
    assert.equal(await c.diaryObservationFallback(job,unavailable,read),undefined);
  for(const result of [{complete:false,reason:'unrecognized-form'},{...unavailable,challenge:true},{...unavailable,complete:true}])
    assert.equal(await c.diaryObservationFallback(scope,result,read),undefined);
  assert.equal(reads,0);
});
test('poll follows inventory entry once, retries editor read only, and uses editor values',async()=>{
  const values={rating:null,text:'',spoiler:false};
  const reports=await run({action:'review_observe',inventory:singleInventory,read:request=>{
    if(request.func.name!=='reviewWritePage')return {complete:false};
    assert.equal(request.args.length,1); // mutate argument is never supplied.
    const job=JSON.parse(request.args[0]);
    return job.entryId?{complete:true,account:'alice',entryId:job.entryId,values}:unavailable;
  }});
  assert.equal(reports.visits.filter(url=>url===entry).length,1);
  assert.equal(reports.filter(r=>r.payload.stage==='observation-diary-entry-fallback').length,1);
  assert.equal(reports.at(-1).payload.outcome,'succeeded');
  assert.equal(reports.at(-1).payload.observation.text,'');
  assert.equal(reports.at(-1).payload.observation.rewatch,undefined);
  assert.equal(reports.at(-1).payload.observation.entryId,entry);
});
test('fallback retry failure terminates without another scan or loop',async()=>{
  const reports=await run({action:'review_observe',inventory:singleInventory});
  assert.equal(reports.inventoryReads,2); // Existing two-pass inventory scan only.
  assert.deepEqual(reports.visits,['https://letterboxd.com/film/jaws/',entry]);
  assert.equal(reports.at(-1).payload.error,'editor-unavailable');
  assert.equal(reports.at(-1).payload.outcome,'blocked');
});
test('retry cannot verify an editor result for a different entry',async()=>{
  const reports=await run({action:'review_observe',inventory:singleInventory,read:request=>{
    const job=JSON.parse(request.args[0]);
    return job.entryId?{complete:true,account:'alice',entryId:entry+'2/',values:{}}:unavailable;
  }});
  assert.equal(reports.at(-1).payload.outcome,'blocked');
  assert.equal(reports.at(-1).payload.observation,undefined);
});
