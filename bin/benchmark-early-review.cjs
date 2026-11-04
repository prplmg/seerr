// Isolated before/after measurement of the real review-viewing lookup.
// Reads a sanitized fixture; no production configuration, scheduler or network.
const fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm'),ts=require('typescript'),cp=require('child_process');
const {DatabaseSync}=require('node:sqlite');
const fixture=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'early-review-bench-'));
const db=new DatabaseSync(path.join(dir,'fixture.sqlite'));
db.exec('CREATE TABLE reviews(userId INTEGER,tmdbId INTEGER,mediaType TEXT,value TEXT); CREATE INDEX lookup ON reviews(userId,tmdbId,mediaType)');
const insert=db.prepare('INSERT INTO reviews VALUES(?,?,?,?)');for(const row of fixture.rows)insert.run(row.userId,row.tmdbId,row.mediaType,JSON.stringify(row));
for(const [name,value]of Object.entries(fixture.files))fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
const query=db.prepare('SELECT value FROM reviews WHERE userId=? AND tmdbId=? AND mediaType=?');
let reads=0,bytes=0;
const measuredFs={...fs,readFileSync(...a){reads++;const value=fs.readFileSync(...a);bytes+=Buffer.byteLength(value);return value;}};
function load(source,deps){const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,{exports,require:n=>{if(n in deps)return deps[n];throw Error('Blocked dependency '+n)},Date,Buffer});return exports;}
const file=n=>fs.readFileSync(path.join(root,'server/lib',n+'.ts'),'utf8');
const attribution=load(file('viewingAttribution'),{crypto:require('crypto'),fs:measuredFs,path,'@server/utils/appDataVolume':{appDataPath:()=>dir}});
const early=load(file('earlyReviewViewing'),{crypto:require('crypto'),fs:measuredFs,path,'./viewingAttribution':attribution,'@server/utils/appDataVolume':{appDataPath:()=>dir}});
const recent=load(file('recentUnratedViewing'),{});
const deps={'@server/datasource':{getRepository:()=>({findBy:async w=>query.all(w.userId,w.tmdbId,w.mediaType).map(x=>JSON.parse(x.value))})},'@server/entity/MovieReview':{MovieReview:{}},'@server/utils/appDataVolume':{appDataPath:()=>dir},fs:measuredFs,path,'./letterboxdImport':{letterboxdEntryIdentity:s=>s},'./letterboxdSyncReceipts':{readSyncReceipts:()=>fixture.receipts},'./recentUnratedViewing':recent,'./earlyReviewViewing':early};
const beforeSource=cp.execFileSync('git',['show','ops/adguard-recovery-2026-11-04:server/lib/reviewEntrySelection.ts'],{cwd:root,encoding:'utf8'});
const versions={before:load(beforeSource,deps),after:load(file('reviewEntrySelection'),deps)};
const scenarios={missing:null,empty:[],active:[{id:'playback-session:benchmark',userId:4,tmdbId:565,date:'2026-11-04',observedAt:Date.now()}],busy:Array.from({length:100},(_,i)=>({id:'playback-session:'+i,userId:100+i,tmdbId:565,date:'2026-11-04',observedAt:Date.now()}))};
const p=(a,n)=>[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*n))];
(async()=>{const results=[];for(const [scenario,rows]of Object.entries(scenarios)){const f=path.join(dir,'early-review-viewings.json');if(rows)fs.writeFileSync(f,JSON.stringify(rows));else fs.rmSync(f,{force:true});const cold={before:[],after:[]};for(let n=0;n<20;n++){for(const name of n%2?['after','before']:['before','after']){const module=load(name==='before'?beforeSource:file('reviewEntrySelection'),deps);const t=performance.now();await module.latestReviewViewing(4,565,'movie');cold[name].push(performance.now()-t);}}for(const concurrent of [1,8]){const data={before:[],after:[]},cpu={before:0,after:0},io={before:0,after:0};for(let run=0;run<50;run++){for(const name of run%2?['after','before']:['before','after']){reads=0;bytes=0;const start=performance.now(),c=process.cpuUsage();for(let i=0;i<20;i++)await Promise.all(Array.from({length:concurrent},()=>versions[name].latestReviewViewing(4,565,'movie')));const cost=process.cpuUsage(c);data[name].push((performance.now()-start)/(20*concurrent));cpu[name]+=(cost.user+cost.system)/1000;io[name]+=bytes;}}results.push({scenario,concurrent,applicationColdMedianMs:{before:p(cold.before,.5),after:p(cold.after,.5)},requestsEach:1000*concurrent,before:{medianMs:p(data.before,.5),p95BatchMeanMs:p(data.before,.95),cpuMs:cpu.before,readBytes:io.before},after:{medianMs:p(data.after,.5),p95BatchMeanMs:p(data.after,.95),cpuMs:cpu.after,readBytes:io.after},medianDeltaMs:p(data.after,.5)-p(data.before,.5)});}}console.log(JSON.stringify({fixtureRows:fixture.rows.length,results,rssBytes:process.memoryUsage().rss,scope:'actual lookup + SQLite fixture, batch means, not full browser navigation; OS file cache warm'},null,2));db.close();fs.rmSync(dir,{recursive:true,force:true});})();
