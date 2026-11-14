const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const engine=fs.readFileSync(path.join(__dirname,'../maintenance/release-engine.cjs'),'utf8');
const hash=s=>s===null?null:crypto.createHash('sha256').update(s).digest('hex');
for(const failure of [1,2,3,4,5,6,'source','health','public','scheduler'])test('upgrade recovers after '+failure+' failure',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'upgrade-recovery-'));
 const release=root+'/reconciliation-release-20261019',stage=root+'/reconciliation-native-20261019',live=root+'/app',runtime=root+'/runtime';
 const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
 const stops=[];let renames=0,failed=false;
 try {
  for(const [app,id] of [[live,'g7IGMd-mQTo3taLfl1Jf9'],[stage,'new']]){
   write(app+'/.next/BUILD_ID',id);write(app+'/dist/index.js',id);write(app+'/package.json','{}');write(app+'/pnpm-lock.yaml','lock');
  }
  write(live+'/node_modules/identity','old');write(runtime+'/node_modules/identity','new');
  fs.symlinkSync(runtime+'/node_modules',stage+'/node_modules','junction');write(runtime+'/package.json','{}');write(runtime+'/pnpm-lock.yaml','lock');
  write(live+'/next.config.ts','old');write(stage+'/next.config.mjs','new');
  write(root+'/launcher.ps1','old launcher');write(root+'/data/db/db.sqlite3','old database');write(root+'/data/settings.json','{"main":{"apiKey":"fixture"}}');
  const manifest=[{file:'next.config.ts',before:'old',beforeHash:hash('old'),afterHash:null},{file:'next.config.mjs',before:null,beforeHash:null,afterHash:hash('new')}];
  write(release+'/manifest.json',JSON.stringify(manifest));write(release+'/built.json',JSON.stringify({buildId:'new',manifestHash:hash(JSON.stringify(manifest))}));
  write(release+'/mini-preflight.json',JSON.stringify({verified:true,migrations:true,rollbackCompatible:true,nativeNode:'v22.23.5',buildId:'new',manifestHash:hash(JSON.stringify(manifest)),runtime}));
  write(release+'/rollback-preflight.json',JSON.stringify({verified:true,nodeHash:'oldhash',node:'oldversion',buildId:'g7IGMd-mQTo3taLfl1Jf9',protectedRowsUnchanged:true,togglesUnchanged:true}));
  write(release+'/migration-preflight.json',JSON.stringify({verified:true,node:'v22.23.5',buildId:'new',togglesUnchanged:true}));
  const fakeFs=new Proxy(fs,{get(target,key){
   if(key==='renameSync')return (from,to)=>{if(++renames===failure){failed=true;throw Error('injected rename');}return fs.renameSync(from,to);};
   return target[key];
  }});
  const control=require('../maintenance/rollout-control.cjs');
  let starts=0;
  const context={console:{log(){},error(){}},process:{argv:['node','engine','deploy']},setTimeout:resolve=>{if(++starts===1&&failure==='scheduler'){write(root+'/data/db/db.sqlite3','scheduler write');write(root+'/data/db/db.sqlite3-wal','scheduler WAL');write(root+'/data/db/db.sqlite3-shm','scheduler SHM');}resolve();},AbortSignal,AggregateError,
   fetch:async()=>({status:503,headers:{get:()=> '1'},text:async()=> 'Multimeldia is updating It will only take a few moments.'}),
   require(name){
    if(name==='node:sqlite')return {DatabaseSync:class{prepare(){return {all:()=>[{name:'viewingEventId'}],get:()=>({})};}close(){}}};
    if(name==='fs')return fakeFs;
    if(name==='child_process')return {execFileSync(){}};
    if(name==='./deployment-health.cjs')return {healthJson:async url=>{if(failure==='public'){if(url.startsWith('https:')&&!failed){failed=true;write(root+'/data/db/db.sqlite3','post-public write');throw Error('injected public health');}if(url.includes('/reviews/'))return {average:1,count:1,publishing:{enabled:true},entries:[]};if(url.includes('/letterboxd'))return {rating:1};}else if(url.includes('/reviews/')){if(failure!=='scheduler')write(root+'/data/db/db.sqlite3','new migrated database');throw Error('injected health');}return {version:'old'};}};
    if(name==='./ledger-rollout.cjs')return {readWriteState:()=>({settings:{}}),backupLedger(){},prepareLegacyRollback(){}};
    if(name==='./rollout-control.cjs')return {...control,stopCommand:opts=>{stops.push(opts.executable);return '';}};
    if(name==='./build-host/runtime-policy.cjs')return {nodeVersion:'v22.23.5',verifyLauncher:()=>({file:root+'/launcher.ps1',before:'old launcher',after:'new launcher',oldExe:'old-node.exe',newExe:'new-node.exe',oldNode:{hash:'oldhash',version:'oldversion'}})};
    if(name==='./build-host/release-input.cjs')return {...require('./release-input.cjs'),apply(app,entry,source){if(failure==='source'&&entry.file==='next.config.mjs'&&!failed){failed=true;throw Error('injected source');}require('./release-input.cjs').apply(app,entry,source);}};
    if(name===root+'/NativeTwoWayChecks.cjs')return {openSqlite:async()=>({backup:async dest=>fs.copyFileSync(root+'/data/db/db.sqlite3',dest),close:async()=>{}})};
    if(name===live+'/node_modules/sqlite3')return {};
    return require(name);
   }};
  const source=engine.replace("'C:/ProgramData/Seerr'",JSON.stringify(root)).replace('main().catch(e=>{console.error(e.message);process.exitCode=1});','globalThis.run=main;');
  vm.runInNewContext(source,context);
  await assert.rejects(context.run(),/injected/);
  assert.equal(fs.readFileSync(live+'/.next/BUILD_ID','utf8'),'g7IGMd-mQTo3taLfl1Jf9');
  assert.equal(fs.readFileSync(live+'/node_modules/identity','utf8'),'old');
  assert.equal(fs.readFileSync(live+'/dist/index.js','utf8'),'g7IGMd-mQTo3taLfl1Jf9');
  assert.equal(fs.readFileSync(live+'/next.config.ts','utf8'),'old');assert.equal(fs.existsSync(live+'/next.config.mjs'),false);
  assert.equal(fs.readFileSync(root+'/launcher.ps1','utf8'),'old launcher');
  assert.equal(fs.readFileSync(root+'/data/db/db.sqlite3','utf8'),failure==='scheduler'?'scheduler write':failure==='public'?'post-public write':failure==='health'?'new migrated database':'old database');
  assert.equal(stops.at(-1),['health','public','scheduler'].includes(failure)?'new-node.exe':'old-node.exe');
  if(failure==='scheduler'){assert.equal(fs.readFileSync(root+'/data/db/db.sqlite3-wal','utf8'),'scheduler WAL');assert.equal(fs.readFileSync(root+'/data/db/db.sqlite3-shm','utf8'),'scheduler SHM');}
  assert.equal(JSON.parse(fs.readFileSync(release+'/failed-attempt.json')).recovered,true);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
