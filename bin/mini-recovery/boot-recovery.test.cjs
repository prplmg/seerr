const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {recover,acquireLock}=require('./boot-recovery.cjs');
function mock(states={AdGuardHome:4,Tailscale:4}) {
 let clock=0;const started=[],logs=[],waits=[];
 const io={now:()=>clock,sleep:async ms=>{waits.push(ms);clock+=ms;},log:x=>logs.push(x),
 state:async n=>states[n],start:async n=>{started.push(n);states[n]=4;},ready:async()=>true};
 return {io,started,logs,waits};
}
test('healthy services are checked without restarting',async()=>{let h=mock();assert.equal(await recover(h.io),0);assert.deepEqual(h.started,[]);});
test('only stopped service starts, readiness failure retries without duplicate starts',async()=>{let h=mock({AdGuardHome:1,Tailscale:4});let checks=0;h.io.ready=async n=>n==='Tailscale'||++checks>2;assert.equal(await recover(h.io),0);assert.deepEqual(h.started,['AdGuardHome']);assert.deepEqual(h.waits,[15000,30000]);});
test('pending service is never force-restarted; retries are bounded',async()=>{let h=mock({AdGuardHome:2,Tailscale:4});assert.equal(await recover(h.io),1);assert.deepEqual(h.started,[]);assert.equal(h.waits.length,4);});
test('failed starts retry only up to cap and record unresolved',async()=>{let h=mock({AdGuardHome:1,Tailscale:4});h.io.start=async n=>{h.started.push(n);throw Error('failure');};assert.equal(await recover(h.io),1);assert.equal(h.started.length,5);assert.equal(h.logs.at(-1).result,'unresolved');});
test('running but unreachable services never get restarted',async()=>{let h=mock();h.io.ready=async()=>false;assert.equal(await recover(h.io),1);assert.deepEqual(h.started,[]);});
test('process lock excludes duplicates and recovers previous-boot lock',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boot-test-')),f=path.join(dir,'lock');try{const release=acquireLock(f,1000);assert.ok(release);assert.equal(acquireLock(f,1000),undefined);release();fs.writeFileSync(f,JSON.stringify({pid:process.pid,started:1}));acquireLock(f,1000)();}finally{fs.rmSync(dir,{recursive:true});}});
