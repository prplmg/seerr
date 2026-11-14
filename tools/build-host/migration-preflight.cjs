// Mini only: online SQLite backup, then initialize the candidate datasource in a
// separate process with isolated config and no network/subprocess access.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const [stage,release,liveData]=process.argv.slice(2).map(p=>path.resolve(p));
const rollback=process.argv[5]==='--rollback';
const fixture=path.join(release,'migration-fixture'),database=path.join(fixture,'db/db.sqlite3');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const allowedMigrations=new Set(['DropPushSubscriptionAuthUnique1786619443939','RemapOverseerrDeletedStatus1789257612345']);
const custom=['movie_review','letterboxd_account','letterboxd_export_baseline','letterboxd_export_audit','review_comment','review_reaction','recent_reaction'];
const quote=name=>'"'+name.replaceAll('"','""')+'"';
async function main(){
 fs.mkdirSync(path.dirname(database),{recursive:true});
 assert.notEqual(fs.realpathSync(fixture),fs.realpathSync(liveData));
 const appRequire=createRequire(path.join(stage,'package.json'));
 if(!rollback){
 const {openSqlite}=require(path.join(path.dirname(liveData),'NativeTwoWayChecks.cjs'));
 const source=await openSqlite(appRequire('sqlite3'),path.join(liveData,'db/db.sqlite3'),true);
 try {await source.backup(database);} finally {await source.close();}
 }
 const files=['settings.json','account-mappings.json','letterboxd-write-queue.json'];
 const fileHashes={};
 for(const file of files)if(fs.existsSync(path.join(rollback?fixture:liveData,file))){
  if(!rollback)fs.copyFileSync(path.join(liveData,file),path.join(fixture,file));
  fileHashes[file]=hash(fs.readFileSync(path.join(fixture,file)));
 }
 // Never inherit database endpoints or service credentials from the launcher.
 for(const key of Object.keys(process.env))if(/^(DB_|OPENAI_|POSTHOG_|PLEX_|RADARR_|SONARR_)/.test(key))delete process.env[key];
 Object.assign(process.env,{NODE_ENV:'production',CONFIG_DIRECTORY:fixture,DB_TYPE:'sqlite',NEXT_TELEMETRY_DISABLED:'1'});
 process.chdir(stage);
 const deny=()=>{throw Error('External activity attempted during migration rehearsal');};
 global.fetch=deny;
 for(const [name,methods] of Object.entries({'node:http':['request','get'],'node:https':['request','get'],'node:net':['connect','createConnection'],'node:tls':['connect'],'node:child_process':['exec','execFile','spawn','fork','execSync','execFileSync','spawnSync']})){
  const mod=require(name);for(const method of methods)mod[method]=deny;
 }
 require('node:net').Socket.prototype.connect=deny;
 require('node:net').Server.prototype.listen=deny;
 appRequire('node-schedule').scheduleJob=deny;
 appRequire('reflect-metadata');
 const ds=appRequire('./dist/datasource.js').default;
 assert.equal(ds.options.type,'sqlite');assert.equal(path.resolve(ds.options.database),database);
 ds.setOptions({synchronize:false,dropSchema:false,migrationsRun:false,subscribers:[],logging:false});
 const {DatabaseSync}=require('node:sqlite');
 function snapshot(){
  const db=new DatabaseSync(database,{readOnly:true});
  try {
   const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name);
   const counts=Object.fromEntries(tables.filter(t=>t!=='migrations').map(t=>[t,db.prepare('SELECT count(*) AS n FROM '+quote(t)).get().n]));
   const protectedTables=[...custom,'user','user_settings','user_push_subscription'];
   const contents=Object.fromEntries(protectedTables.map(t=>{
    assert.ok(tables.includes(t),'Missing protected table '+t);
    const rows=db.prepare('SELECT * FROM '+quote(t)).all().map(r=>JSON.stringify(Object.fromEntries(Object.entries(r).sort(([a],[b])=>a.localeCompare(b))))).sort();
    return [t,hash(JSON.stringify(rows))];
   }));
   return {counts,contents};
  }finally{db.close();}
 }
 const before=snapshot();
 let applied;
 try {
  await ds.initialize();
  for(const name of custom)assert.ok(ds.entityMetadatas.some(m=>m.tableName===name),'Missing custom entity '+name);
  if(rollback){
   applied=[];
   assert.equal(await ds.showMigrations(),false,'Old startup would run unexpected migrations');
   for(const metadata of ds.entityMetadatas){
    await ds.getRepository(metadata.target).count();
    await ds.getRepository(metadata.target).find({take:1});
   }
  }else{
   const executed=new Set((await ds.query('SELECT name FROM migrations')).map(m=>m.name));
   const pending=ds.migrations.map(m=>m.name||m.constructor.name).filter(name=>!executed.has(name));
   for(const name of pending)assert.ok(allowedMigrations.has(name),'Unexpected pending migration: '+name);
   // Match actual SQLite startup, with all migrations inside one transaction.
   await ds.query('PRAGMA foreign_keys=OFF');
   try { applied=(await ds.runMigrations({transaction:'all'})).map(m=>m.name); }
   finally { await ds.query('PRAGMA foreign_keys=ON'); }
   for(const name of applied)assert.ok(allowedMigrations.has(name),'Unexpected applied migration: '+name);
   assert.equal(await ds.showMigrations(),false,'Pending migrations after rehearsal');
  }
 }finally{if(ds.isInitialized)await ds.destroy();}
 const after=snapshot();
 for(const [name,count] of Object.entries(before.counts))assert.equal(after.counts[name],count,'Row count changed: '+name);
 assert.deepEqual(after.contents,before.contents,'Protected rows/toggles changed');
 for(const [file,digest] of Object.entries(fileHashes))assert.equal(hash(fs.readFileSync(path.join(fixture,file))),digest,'Config/toggles changed: '+file);
 const db=new DatabaseSync(database,{readOnly:true});
 try {
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  const recorded=new Set(db.prepare('SELECT name FROM migrations').all().map(r=>r.name));
  for(const name of ['DropPushSubscriptionAuthUnique1786619443939','RemapOverseerrDeletedStatus1789257612345'])assert.ok(recorded.has(name),'Missing upstream migration '+name);
  for(const index of db.prepare('PRAGMA index_list(user_push_subscription)').all().filter(i=>i.unique)){
   const columns=db.prepare('PRAGMA index_info('+quote(index.name)+')').all().map(c=>c.name);
   assert.notDeepEqual(columns,['auth'],'auth unique constraint remains');
  }
 }finally{db.close();}
 fs.writeFileSync(path.join(release,rollback?'rollback-preflight.json':'migration-preflight.json'),JSON.stringify({verified:true,node:process.version,nodeHash:hash(fs.readFileSync(process.execPath)),buildId:fs.readFileSync(path.join(stage,'.next/BUILD_ID'),'utf8').trim(),applied,rowCounts:after.counts,protectedRowsUnchanged:true,togglesUnchanged:true,customEntities:custom}));
 // Mini orchestrator removes the private copy only after both candidate and old
 // datasource rehearsals pass. Failure retains it here, never on PRPL-PC.
 console.log(rollback?'Old datasource reads migrated copy; protected rows and toggles unchanged':'Mini datasource migration rehearsal passed; protected rows and toggles unchanged');
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e.stack);process.exitCode=1;});
