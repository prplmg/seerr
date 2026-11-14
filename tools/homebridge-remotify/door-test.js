const {test} = require('node:test');
const assert = require('node:assert/strict');
const {DoorController} = require('./door-controller');
function setup() {
 let now = 0, sent = 0, fail = false, callback;
 const c = new DoorController({deviceId:1,travelSeconds:15,initialState:'closed'}, {
  now:()=>now, schedule:fn=>{callback=fn;return 1;},cancel:()=>{callback=null;},
  client:{ devices:async()=>({client_enabled:true,devices:[{id:1,enabled:true}]}), request:async()=>{sent++;if(fail)throw Error('timeout');} }
 });
 return {c,advance:ms=>now+=ms,count:()=>sent,fail:()=>fail=true,finish:()=>callback()};
}
test('no startup command; matching target is noop; normal open and close complete',async()=>{
 const h=setup();assert.equal(h.count(),0);await h.c.setTarget(1);assert.equal(h.count(),0);
 await h.c.setTarget(0);assert.equal(h.c.current,2);h.advance(15000);h.finish();assert.equal(h.c.current,0);
 await h.c.setTarget(1);assert.equal(h.c.current,3);h.advance(15000);h.finish();assert.equal(h.c.current,1);assert.equal(h.count(),2);
});
test('1500ms interval, shared raw press stops opening, next press reverses',async()=>{
 const h=setup();await h.c.press();h.advance(1499);await assert.rejects(h.c.press());assert.equal(h.count(),1);
 h.advance(1);await h.c.press();assert.equal(h.c.current,4);assert.equal(h.c.position,0.1);
 h.advance(1500);await h.c.setTarget(1);assert.equal(h.c.current,3);assert.equal(h.count(),3);
});
test('ambiguous closing interruption and failed POST require correction; no retry',async()=>{
 const h=setup();h.c.correct(true);await h.c.press();h.advance(1500);await h.c.press();assert.equal(h.c.uncertain,true);
 await assert.rejects(h.c.setTarget(0));assert.equal(h.count(),2);
 h.c.correct(false);assert.equal(h.count(),2);h.advance(1500);h.fail();await assert.rejects(h.c.press());assert.equal(h.count(),3);assert.equal(h.c.uncertain,true);
});
test('target reversal during movement is rejected without automatic extra pulses',async()=>{
 const h=setup();await h.c.setTarget(0);h.advance(1500);await assert.rejects(h.c.setTarget(1));assert.equal(h.count(),1);
});
test('restart with saved state requires correction and does not send commands',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'garage-state-'));const file=path.join(dir,'state.json');
 try {
  fs.writeFileSync(file,JSON.stringify({position:1,lastDirection:1}));let calls=0;
  const c=new DoorController({deviceId:1,travelSeconds:15,initialState:'closed',stateFile:file},{client:{devices:async()=>{calls++;}}});
  assert.equal(c.uncertain,true);await assert.rejects(c.setTarget(1));assert.equal(calls,0);
  c.correct(false);assert.equal(c.current,1);assert.equal(c.uncertain,false);assert.equal(calls,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
