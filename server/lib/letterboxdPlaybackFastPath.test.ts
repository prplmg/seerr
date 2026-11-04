import { historyResult } from './letterboxdHistoryHealth';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { it } from 'node:test';
import ts from 'typescript';

function harness() {
  const source = fs.readFileSync(path.join(__dirname, '../routes/social.ts'), 'utf8');
  const code = source.slice(source.indexOf('let playbackRefreshAt'), source.indexOf('// Collection only:'));
  let now = 100000, enabled = true, fail = false, activityFail = false;
  let health:any={attempts:0,nextAttemptAt:0};
  const calls: any[] = [], collected: any[] = [], active: any[] = [];
  const failures: boolean[] = [];
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(code, {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, {
    readHistoryHealth:()=>health, saveHistoryHealth:(v:any)=>{health=v;}, historyResult:(old:any,error:any,stage:any)=>historyResult(old,error,stage,now), logger:{warn:()=>{}},
    exports, Date: {now: () => now},
    policy: () => ({enabled:true,tautulliUrl:'http://history',tautulliKey:'test'}),
    readWriteState: () => ({settings:{1:{enabled}}}),
    updateWriteState: (fn: any) => fn({settings:{1:{enabled,account:'prplmg'}}}),
    setPreparationFailure: (_s: unknown,_id:number,_account:string,_phase:string,failed:boolean)=>failures.push(failed),
    axios: {get: async (_url: string, options: any) => {
      calls.push(options);
      if (fail) throw Error('offline');
      if (options.params.cmd === 'get_activity') {
        if(activityFail) throw Error('activity unavailable');
        return {data:{response:{result:'success',data:{sessions:[{media_type:'movie',session_key:'s',user_id:1,rating_key:'8',machine_id:'device',duration:7200000,view_offset:6900000,state:'playing'}]}}}};
      }
      return {data:{response:{result:'success',data:{data:[
        {media_type:'movie',stopped:99,started:10,rating_key:'7',row_id:3,reference_id:3,user_id:1,watched_status:1},
        {media_type:'movie',stopped:0,rating_key:'8',session_key:'s',user_id:1,machine_id:'device',started:20},
        {media_type:'episode',stopped:99,rating_key:'9'},
      ]}}}};
    }},
    collectCompletedLetterboxdPlayback: async (rows: unknown, sessions:unknown) => {collected.push(rows);active.push(sessions);},
  });
  return {run:exports.refreshRecentMoviePlayback,calls,collected,active,failures,activityFail:()=>{activityFail=true;},advance:()=>{now+=30000;},disable:()=>{enabled=false;},fail:()=>{fail=true;}};
}
it('fast playback intake is bounded, coalesced, throttled, and additive', async () => {
  const h = harness();
  await Promise.all([h.run(),h.run(),h.run()]);
  assert.equal(h.calls.length,2);
  assert.equal(h.calls.find(c=>c.params.cmd==='get_history').params.length,50);
  assert.equal(h.calls.find(c=>c.params.cmd==='get_history').params.include_activity,1);
  assert.equal(h.collected[0].length,1);
  assert.equal(h.collected[0][0].row_id,3);
  assert.equal(h.collected[0][0].stopped,99);
  await h.run();assert.equal(h.calls.length,2);
  h.advance();await h.run();assert.equal(h.calls.length,4);
});
it('disabled publishing makes no fast history request; history failure cannot block acknowledgements', async () => {
  const disabled = harness();disabled.disable();await disabled.run();assert.equal(disabled.calls.length,0);
  const failed = harness();failed.fail();await failed.run();await failed.run();
  assert.equal(failed.calls.length,2);assert.equal(failed.collected.length,0);
  assert.deepEqual(failed.failures,[false]);
  failed.advance(); await failed.run(); assert.equal(failed.calls.length,2);
});

it('activity snapshot uses matched history start and activity failure leaves completed imports working',async()=>{
 const h=harness();await h.run();
 assert.equal(h.active[0].length,1);
 assert.equal(h.active[0][0].started,20);
 h.activityFail();h.advance();await h.run();
 assert.equal(h.active[1].length,0);
 assert.equal(h.collected[1].length,1);
});
