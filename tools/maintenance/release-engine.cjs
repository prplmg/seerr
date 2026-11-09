const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const {healthJson}=require('./deployment-health.cjs');
const {readWriteState,backupLedger,prepareLegacyRollback}=require('./ledger-rollout.cjs');
const {stopCommand,recoverRelease}=require('./rollout-control.cjs');
const root='C:/ProgramData/Seerr',live=root+'/app',release=root+'/reconciliation-release-20261019',stage=root+'/reconciliation-native-20261019';
const read=f=>fs.existsSync(f)?fs.readFileSync(f,'utf8'):null;
const hash=s=>s===null?null:crypto.createHash('sha256').update(s.replace(/\r\n/g,'\n')).digest('hex');
const ps=s=>cp.execFileSync('powershell.exe',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';"+s],{stdio:'inherit'});
const allowed=f=>/^(server|src)\//.test(f)&&/\.(ts|tsx|json|css)$/.test(f)&&!f.includes('.test.')||f==='seerr-api.yml'||f==='package.json'||f==='pnpm-lock.yaml'||f==='server/lib/data/UNICODE-LICENSE.txt';
function startReady(){
 // Windows append handles do not reliably emit directory-change notifications.
 // Allow cold startup once, then verify the actual API below; no status polling.
 ps('Start-ScheduledTask -TaskName Seerr');
 return new Promise(resolve=>setTimeout(resolve,120000));
}
async function main(){
 const action=process.argv[2];
 if(action==='pack'){
  const repo=path.resolve(__dirname,'../seerr-fork');
  const names=[...new Set(cp.execFileSync('git',['ls-files','--modified','--others','--exclude-standard','-z'],{cwd:repo,encoding:'utf8'}).split('\0').filter(f=>f&&allowed(f)))];
  fs.writeFileSync('/private/tmp/reconciliation-source.json',JSON.stringify(names.map(file=>({file,after:read(repo+'/'+file)}))));console.log({sources:names.length});return;
 }
 if(action==='build'){
  if(fs.existsSync(release)||fs.existsSync(stage))throw Error('Release already exists');
  if(read(live+'/.next/BUILD_ID').trim()!=='g7IGMd-mQTo3taLfl1Jf9')throw Error('Live build changed');
  const entries=JSON.parse(read(root+'/reconciliation-source.json'));
  if(entries.some(e=>!allowed(e.file)||e.file.includes('..')||typeof e.after!=='string'))throw Error('Invalid source payload');
  fs.mkdirSync(release);
  const manifest=entries.map(e=>({...e,before:read(live+'/'+e.file)})).filter(e=>hash(e.before)!==hash(e.after)).map(e=>{
   const target=release+'/source/'+e.file;fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,e.after);
   return {file:e.file,before:e.before,beforeHash:hash(e.before),afterHash:hash(e.after)};
  });
  fs.writeFileSync(release+'/manifest.json',JSON.stringify(manifest));console.log('Building '+manifest.length+' changed source files');
  cp.execFileSync(process.execPath,[root+'/build-host/mini-build.cjs',live,stage,release],{stdio:'inherit'});
  for(const e of manifest)if(hash(read(stage+'/'+e.file))!==e.afterHash)throw Error('Staged source mismatch '+e.file);
  if(!fs.existsSync(stage+'/dist/lib/letterboxdExportReconciliation.js'))throw Error('Missing compiled reconciliation');
  fs.writeFileSync(release+'/built.json',JSON.stringify({buildId:read(stage+'/.next/BUILD_ID').trim(),manifestHash:hash(JSON.stringify(manifest))}));console.log('BUILD COMPLETE');return;
 }
 if(action==='restage-rolled-back'){
  if(read(live+'/.next/BUILD_ID').trim()!=='g7IGMd-mQTo3taLfl1Jf9')throw Error('Rollback build not active');
  const previous=release+'/previous',archive=release+'/attempt-one';
  if(fs.existsSync(archive))throw Error('Retry already prepared');
  for(const dir of ['.next','dist']){if(fs.existsSync(stage+'/'+dir)||!fs.existsSync(previous+'/failed-'+dir))throw Error('Unexpected rollback artifacts');}
  for(const dir of ['.next','dist'])fs.renameSync(previous+'/failed-'+dir,stage+'/'+dir);
  fs.renameSync(previous,archive);
  for(const name of ['before.sqlite3','state'])if(fs.existsSync(release+'/'+name))fs.renameSync(release+'/'+name,archive+'/'+name);
  console.log('Rolled-back artifacts restaged, first backup retained');return;
 }
 if(action!=='deploy')throw Error('Unknown action');
 const manifest=JSON.parse(read(release+'/manifest.json')),built=JSON.parse(read(release+'/built.json'));
 if(built.manifestHash!==hash(JSON.stringify(manifest)))throw Error('Manifest changed');
 for(const e of manifest)if(hash(read(live+'/'+e.file))!==e.beforeHash||hash(read(stage+'/'+e.file))!==e.afterHash)throw Error('Source drift '+e.file);
 const preflight=JSON.parse(read(release+'/mini-preflight.json'));
 if(!preflight?.verified || preflight.buildId!==built.buildId)throw Error('Mini preflight missing or stale');
 const publishing=()=>Object.entries(readWriteState(root+'/data',live).settings).filter(([,s])=>s.enabled).map(([id,s])=>({id,account:s.account}));
 const mappingsBefore=hash(read(root+'/data/account-mappings.json'));
 const publishingSettingsBefore=JSON.stringify(readWriteState(root+'/data',live).settings);
 const swap=release+'/previous';if(fs.existsSync(swap))throw Error('Already deployed');
 const stop=()=>ps(stopCommand());
 const leaseOwner=path.basename(release);
 const maintenance=action=>cp.execFileSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=8','root@100.87.16.107','/srv/multimeldia-maintenance/lease.sh',action,leaseOwner],{timeout:15000,stdio:'inherit'});
 const directApi='http://192.168.68.50:5055/api/v1';
 const moved=[];let touched=false;
 // Keep the existing catalogue available during staging. Fail before stopping it
 // if the edge cannot reserve the maintenance window.
 maintenance('start');
 try {
  const edge=await fetch('https://catalogue.prpl.com.mx/?maintenance-check='+encodeURIComponent(leaseOwner),{headers:{Accept:'text/html'},signal:AbortSignal.timeout(15000)});
  const page=await edge.text();
  if(edge.status!==503 || edge.headers.get('x-multimeldia-updating')!=='1' || !page.includes('Multimeldia is updating') || !page.includes('It will only take a few moments.')) throw Error('Public maintenance screen did not verify');
  console.log('Public branded maintenance page verified before stopping Seerr');
 } catch(error) {maintenance('finish');throw error;}
 try{
  stop();
  const {openSqlite}=require(root+'/NativeTwoWayChecks.cjs');const db=await openSqlite(require(live+'/node_modules/sqlite3'),root+'/data/db/db.sqlite3',true);
  try{await db.backup(release+'/before.sqlite3');}finally{await db.close();}
  fs.mkdirSync(release+'/state');for(const name of fs.readdirSync(root+'/data').filter(n=>n.startsWith('letterboxd-')&&n.endsWith('.json')))fs.copyFileSync(root+'/data/'+name,release+'/state/'+name);
  backupLedger(root+'/data',release+'/state');
  fs.mkdirSync(swap);
  for(const dir of ['.next','dist']){fs.renameSync(live+'/'+dir,swap+'/'+dir);moved.push(dir);fs.renameSync(stage+'/'+dir,live+'/'+dir);}
  touched=true;for(const e of manifest){fs.mkdirSync(path.dirname(live+'/'+e.file),{recursive:true});fs.copyFileSync(stage+'/'+e.file,live+'/'+e.file);}
  await startReady();
  const settings=JSON.parse(read(root+'/data/settings.json'));
  const api=p=>healthJson(directApi+p,{headers:{'X-Api-Key':settings.main.apiKey,'X-API-User':'1'}});
  await api('/status?checkUpdateAvailable=false');
  const movie=await api('/reviews/average/5698?mediaType=movie'),tv=await api('/reviews/average/456?mediaType=tv'),mine=await api('/reviews/mine/5698?mediaType=movie');
  if(!('average'in movie)||!('count'in tv)||mine.publishing?.enabled!==true||!Array.isArray(mine.entries))throw Error('Review API smoke failed');
  const lb=await api('/tv/87108/letterboxd');if(!('rating'in lb))throw Error('Series rating API failed');
  const {DatabaseSync}=require('node:sqlite');const check=new DatabaseSync(root+'/data/db/db.sqlite3',{readOnly:true});
  try{if(!check.prepare('PRAGMA table_info(movie_review)').all().some(c=>c.name==='viewingEventId'))throw Error('Viewing migration absent');check.prepare('SELECT count(*) FROM letterboxd_export_baseline').get();check.prepare('SELECT count(*) FROM letterboxd_export_audit').get();}finally{check.close();}
  if(hash(read(root+'/data/account-mappings.json'))!==mappingsBefore || JSON.stringify(readWriteState(root+'/data',live).settings)!==publishingSettingsBefore)throw Error('Account toggles changed');
  maintenance('finish');
  const publicHealth=await healthJson('https://catalogue.prpl.com.mx/api/v1/status?checkUpdateAvailable=false');
  if(typeof publicHealth.version!=='string')throw Error('Public health returned an unexpected application response');
  const result={buildId:built.buildId,health:true,migrations:true,publishing:publishing().map(s=>s.account),seriesLetterboxdAvailable:!!lb.rating,backup:release};fs.writeFileSync(release+'/verified.json',JSON.stringify(result));console.log(JSON.stringify(result));
 }catch(error){
  try{maintenance('start');}catch(edgeError){console.error('Could not renew rollback notice:',edgeError.message);}
  try {
   await recoverRelease({
    changed: moved.length > 0 || touched,
    stop,
    restore: () => {
     prepareLegacyRollback(root+'/data',live,swap,release+'/ledger-rollback-current');
     for(const dir of moved){if(fs.existsSync(live+'/'+dir))fs.renameSync(live+'/'+dir,swap+'/failed-'+dir);fs.renameSync(swap+'/'+dir,live+'/'+dir);}
     if(touched)for(const e of manifest){if(e.before===null){if(fs.existsSync(live+'/'+e.file))fs.unlinkSync(live+'/'+e.file);}else fs.writeFileSync(live+'/'+e.file,e.before);}
    },
    startReady,
    nativeHealth: async()=>{const restored=await healthJson(directApi+'/status?checkUpdateAvailable=false');if(typeof restored.version!=='string')throw Error('Restored native health failed');},
    finishMaintenance: ()=>maintenance('finish'),
    publicHealth: async()=>{const restored=await healthJson('https://catalogue.prpl.com.mx/api/v1/status?checkUpdateAvailable=false');if(typeof restored.version!=='string')throw Error('Restored public health failed');},
    cleanup: ()=>{
     if(fs.existsSync(swap)&&fs.readdirSync(swap).length===0)fs.rmdirSync(swap);
     const names=['before.sqlite3','state'].filter(n=>fs.existsSync(release+'/'+n));
     if(names.length){const archive=release+'/pre-swap-attempt-'+Date.now();fs.mkdirSync(archive);for(const n of names)fs.renameSync(release+'/'+n,archive+'/'+n);}
    }
   });
   fs.writeFileSync(release+'/failed-attempt.json',JSON.stringify({error:error.stack,recovered:true,changed:moved.length>0||touched,at:new Date().toISOString()}));
  } catch(recoveryError) {
   fs.writeFileSync(release+'/failed-attempt.json',JSON.stringify({error:error.stack,recoveryError:recoveryError.stack,recovered:false,at:new Date().toISOString()}));
   throw new AggregateError([error,recoveryError],'Release failed and recovery did not complete; inspect failed-attempt.json');
  }
  throw error;
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
