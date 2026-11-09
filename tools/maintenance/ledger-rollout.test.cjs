const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),ts=require('typescript');
const {readWriteState,backupLedger,prepareLegacyRollback}=require('./ledger-rollout.cjs');
test('rollback exports current settings and receipts and permits fresh re-migration',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-rollout-')),data=root+'/data',app=root+'/app',previous=root+'/previous';
 fs.mkdirSync(app+'/dist/lib',{recursive:true});fs.mkdirSync(data,{recursive:true});fs.mkdirSync(previous,{recursive:true});fs.mkdirSync(root+'/backup');
 const source=fs.readFileSync(path.join(__dirname,'../../server/lib/letterboxdTaskStore.ts'),'utf8');fs.writeFileSync(app+'/dist/lib/letterboxdTaskStore.js',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText);
 const ledger=require(app+'/dist/lib/letterboxdTaskStore.js');
 try{
  fs.writeFileSync(data+'/letterboxd-write-queue.json',JSON.stringify({version:1,settings:{1:{enabled:true}},intents:[]}));
  ledger.initializeTaskStore(data);ledger.updateTaskDocument(data+'/letterboxd-write-queue.json',()=>null,s=>{s.settings[1].enabled=false;});ledger.closeTaskStores();
  assert.equal(readWriteState(data,app).settings[1].enabled,false);
  backupLedger(data,root+'/backup');assert(fs.existsSync(root+'/backup/letterboxd-tasks.sqlite3'));
  prepareLegacyRollback(data,app,previous,root+'/export');assert(!fs.existsSync(data+'/db/letterboxd-tasks.sqlite3'));
  assert.equal(readWriteState(data,previous).settings[1].enabled,false);
  ledger.initializeTaskStore(data);assert.equal(readWriteState(data,app).settings[1].enabled,false);
 }finally{ledger.closeTaskStores();fs.rmSync(root,{recursive:true,force:true});}
});
