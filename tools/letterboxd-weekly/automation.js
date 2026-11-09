importScripts('config.js', 'page-probe.js', 'watchlist-page.js', 'browser-workflow.js', 'write-executor.js', 'review-page.js', 'review-write-page.js', 'rating-write-page.js','list-browser.js');
let running = false;
let fastPolls = 5;
const instanceId = new Promise((resolve,reject) => {
  const open=indexedDB.open('pilot-identity',1);
  open.onupgradeneeded=()=>open.result.createObjectStore('settings');
  open.onerror=()=>reject(new Error('storage'));
  open.onsuccess=()=>{
    const db=open.result, tx=db.transaction('settings','readwrite'), store=tx.objectStore('settings');
    const get=store.get('instance'); let id;
    get.onsuccess=()=>{id=get.result||crypto.randomUUID(); store.put(id,'instance');};
    tx.oncomplete=()=>{db.close();resolve(id);}; tx.onerror=()=>{db.close();reject(new Error('storage'));};
  };
});
async function bridge(path, data) {
  const response=await fetch(`http://127.0.0.1:18764${path}`,{method:data?'POST':'GET',
    headers:{Authorization:`Bearer ${PILOT_TOKEN}`,...(data?{'Content-Type':'application/json'}:{})},
    ...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('bridge-failed');
  return response.json();
}
// One durable result per profile. Retry delivery, never the Letterboxd action.
function workflowStorage(key, value) {
  return new Promise((resolve,reject)=>{
    const open=indexedDB.open('pilot-identity',1);
    open.onerror=()=>reject(Error('storage'));
    open.onsuccess=()=>{
      const db=open.result,tx=db.transaction('settings','readwrite'),store=tx.objectStore('settings');
      const request=value===undefined?store.get(key):store.put(value,key);
      tx.oncomplete=()=>{const result=request?.result;db.close();resolve(result);};
      tx.onerror=()=>{db.close();reject(Error('storage'));};
    };
  });
}
const pendingResult=value=>workflowStorage('pending-result',value);
async function deliver(path,data) {
  for(let attempt=0;attempt<3;attempt++) {
    try{return await bridge(path,data);}catch(error){if(attempt===2)throw error;await delay(500*(attempt+1));}
  }
}
async function flushResult() {
  const saved=await pendingResult();
  if(saved){await deliver('/queue/result',saved);await pendingResult(null);await workflowStorage('active-media-workflow',null);}
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Only structural codes cross the diagnostic boundary; never raw browser errors.
function safeMediaReason(reason) {
  return new Set([
    'challenge','identity','identity-not-verified','page-not-ready','missing-observation',
    'editor-unavailable','unrecognized-form','incomplete-form','missing-film-id',
    'missing-entry-id','unexpected-entry-id','nonempty-new-diary-form','save-unavailable',
    'invalid-job','unsupported-write','wrong-origin','wrong-film','wrong-entry',
    'invalid-date','invalid-rating','invalid-desired','rating-control-unavailable',
    'watched-control-unavailable','remote-changed','entry-mismatch','ambiguous-entry',
    'ambiguous-new-entry','new-entry-not-found','entry-redirect-loop','entry-redirect-limit',
    'incomplete-diary-inventory','ambiguous-diary-date','ambiguous-new-diary-entry',
    'rewatch-required','wrong-history','unrecognized-history','ambiguous-date','missing-date',
    'invalid-entry','unconfirmed-empty','incomplete-pagination','invalid-pagination',
    'workflow-baseline-missing','workflow-navigation-timeout','media-state-not-stable',
    'script-permission-blocked','observation-tab-unavailable','script-observation-failed',
    'script-arguments-invalid','write-precondition-failed'
  ]).has(reason) ? reason : undefined;
}
function mediaDiagnostics() {
  let lastReason;
  return {
    payload(payload, final=false){
      const reason=safeMediaReason(payload.error);
      if(!final){
        if(reason)lastReason=reason;
        return payload.error===undefined?payload:{...payload,error:reason||'script-observation-failed'};
      }
      if(payload.outcome==='succeeded')return payload;
      const generic=!payload.error||['write-not-verified','incomplete','identity','worker-or-transport-failure'].includes(payload.error);
      return generic&&lastReason?{...payload,error:lastReason}:payload;
    },
    async read(read, record, stage='media-read-incomplete'){
      // A new fresh read cannot inherit an earlier page's transient failure.
      lastReason=undefined;
      let result;
      try{result=await read();}
      catch(error){
        await record({stage,error:safeMediaReason(error?.message)||observationFailure(error)});
        throw error;
      }
      if(!result?.complete&&!result?.followEntry)
        await record({stage,error:result?.challenge?'challenge':safeMediaReason(result?.reason)||'missing-observation'});
      return result;
    }
  };
}
// Navigation evidence only. Field values still come from the existing editor read.
async function diaryObservationFallback(job, result, readInventory) {
  if(job.action!=='review_observe'||job.entryId!==undefined||job.createNew!==undefined||
    result?.complete!==false||result?.challenge||result?.reason!=='editor-unavailable'||
    !/^[a-z0-9_]{1,40}$/.test(job.account||'')||!/^[a-z0-9-]{1,200}$/.test(job.film||''))return;
  // readInventory authenticates each page and requires two matching complete scans.
  const inventory=await readInventory(job.film);
  if(inventory?.diaryEntriesComplete!==true||!Array.isArray(inventory.diaryEntryIds)||inventory.diaryEntryIds.length!==1)return;
  const entry=inventory.diaryEntryIds[0];
  if(typeof entry!=='string'||!new RegExp('^https://letterboxd\\.com/'+job.account+'/film/'+job.film+'/(?:[1-9][0-9]*/)?$').test(entry))return;
  const dates=inventory.diaryEntryDates,date=dates?.[entry];
  if(!dates||Object.keys(dates).length!==1||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||
    !Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)return;
  return entry;
}
async function stableMediaRead(read, wait=delay) {
  let previous, stable=0, lastReason;
  for(let count=0;count<24;count++){
    const value=await read();
    if(safeMediaReason(value?.reason))lastReason=safeMediaReason(value.reason);
    if(value?.challenge||value?.followEntry)return value;
    const key=value?.complete?JSON.stringify([value.account,value.entryId,Object.entries(value.values||{}).sort()]):null;
    stable=key!==null&&key===previous?stable+1:key!==null?1:0;
    previous=key;
    // Identity can load before account-specific controls. Never accept the
    // initial default, even when several immediate reads agree with it.
    if(count>=6&&stable>=4)return value;
    await wait(500);
  }
  return {complete:false,reason:lastReason||'media-state-not-stable'};
}
function observationFailure(error) {
  const message=String(error?.message || '');
  if(/developer mode|user gesture|not allowed|permission|cannot access/i.test(message))return 'script-permission-blocked';
  if(/no tab|tab.*closed|frame.*removed|no frame/i.test(message))return 'observation-tab-unavailable';
  return 'script-observation-failed';
}
async function inspect(tabId, account, change=false, expected=null) {
  const [result]=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:inspectPilotPage,args:[account,change,expected]});
  if(!result?.result)throw new Error('missing-observation');
  return result.result;
}
async function ready(tabId, account, wanted=undefined, requireWatchlist=false) {
  let last, stable=0;
  for(let count=0;count<24;count++){
    try {
      last=await inspect(tabId,account);
      if(last.challenge)throw new Error('challenge');
      const matches=last.identity===account && (!requireWatchlist || typeof last.watchlisted==='boolean') && (wanted===undefined || last.watchlisted===wanted);
      // A single optimistic UI update is not enough to verify a mutation.
      stable=matches?stable+1:0;
      if(stable>=2)return last;
    } catch(error){stable=0;if(error.message==='challenge')throw error;}
    await delay(1000);
  }
  return {...(last || {identity:null}),error:'page-not-ready'};
}
async function poll() {
  if(running)return; running=true;
  let job, instance, tab, execution, touched=false, completed=false, started=false, finalPending=false;
  const ownedTabs=[];
  const diagnostics=mediaDiagnostics();
  const record=async(payload,final=false)=>{
    if(['media_write','review_observe'].includes(job?.action))payload=diagnostics.payload(payload,final);
    const report={instance,job:job.id,execution,payload,final};
    if(final){await pendingResult(report);finalPending=true;}
    const result=await deliver('/queue/result',report);
    if(final){await pendingResult(null);await workflowStorage('active-media-workflow',null);finalPending=false;}
    return result;
  };
  const open=async url=>{
    if(job?.action==='media_write'&&tab&&ownedTabs.includes(tab.id)&&chrome.tabs.onUpdated){
      tab=await navigateWorkflowPage(chrome.tabs,tab.id,url);
      await record({stage:'workflow-navigation-complete',tabId:tab.id});
      return tab;
    }
    const windows=chrome.windows ? await chrome.windows.getAll({windowTypes:['normal']}) : [true];
    if(!windows.length){
      const window=await chrome.windows.create({url,focused:false});
      tab=window.tabs?.[0];
      if(!tab)throw Error('missing-observation');
    }else tab=await chrome.tabs.create({url,active:false});
    ownedTabs.push(tab.id);
    await record({stage:'opened-pilot-tab',tabId:tab.id});
    return tab;
  };
  const observe=async (stage,wanted)=>{
    const observed=await ready(tab.id,job.account,wanted,true);
    await record({stage,...observed});
    return !observed.error && observed.identity===job.account && observed.watchlisted===wanted;
  };
  const readWatched=async film=>{
    await open('https://letterboxd.com/film/'+film+'/');
    const own=await ready(tab.id,job.account);if(own.error)return {complete:false};
    return stableMediaRead(async()=>{const [r]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:inspectWatchedState,args:[job.account,film]});return r?.result;});
  };
  const readInventory=async film=>{
    let previous;
    for(let pass=0;pass<2;pass++){
      const inventory=await collectDiaryInventory(job.account,film,async path=>{
        await open('https://letterboxd.com'+path);
        const own=await ready(tab.id,job.account);if(own.error)return {complete:false};
        return stableMediaRead(async()=>{
          const [r]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:inspectDiaryPage,args:[job.account,film]});
          const page=r?.result;return page?{...page,account:page.identity,values:{entries:page.entries,next:page.next}}:{complete:false};
        });
      });
      if(!inventory.diaryEntriesComplete)return inventory;
      if(previous&&JSON.stringify(previous)!==JSON.stringify(inventory))return {diaryEntriesComplete:false,diaryEntryIds:[]};
      previous=inventory;
    }
    return previous;
  };
  const verifyFresh=async (stage,wanted)=>{
    // Independent navigation avoids reading stale or partially rebuilt reload DOM.
    await open('https://letterboxd.com/film/the-great-train-robbery/');
    return observe(stage,wanted);
  };
  try {
    instance=await instanceId;
    await flushResult();
    const active=await workflowStorage('active-media-workflow');
    if(active&&active.instance!==instance)throw Error('workflow-profile-mismatch');
    const inPrivateAllowed=await new Promise(resolve=>{
      try { chrome.extension.isAllowedIncognitoAccess(resolve); }
      catch { resolve(false); } // List capability must never block ordinary publishing.
    });
    job=active?.job||await bridge(`/queue?instance=${encodeURIComponent(instance)}&version=${encodeURIComponent(chrome.runtime.getManifest().version)}&inPrivateAllowed=${inPrivateAllowed===true}`);
    if(job.action==='reload-extension' && !job.id){chrome.runtime.reload();return;}
    if(!job.id)return;
    execution=active?.execution||crypto.randomUUID();
    const permission=await deliver('/queue/start',{instance,job:job.id,execution});
    if(permission.started!==true){if(active){await workflowStorage('active-media-workflow',null);await chrome.action.setBadgeText({text:'WAIT'});}return;}
    started=true;
    if(job.action==='media_write')await workflowStorage('active-media-workflow',{instance,execution,job});
    if(job.instance!==instance || !/^[a-zA-Z0-9_]{1,40}$/.test(job.account || '') || !['list_scan','export_scan','identity_probe','watchlist_probe','watchlist_cycle','watchlist_restore','cleanup_tabs','watchlist_scan','close_profile_for_test','media_write','review_observe','review_probe','review_existing_probe','review_history_probe','review_cleanup'].includes(job.action))throw new Error('invalid-job');
    if(job.action==='list_scan'){
      let snapshot;
      try {snapshot=await scanAnonymousList(chrome,job.url,record,undefined,{mode:job.mode,maxFilms:job.maxFilms});}
      catch(error){await record({outcome:'blocked',error:error.message==='incognito-access-required'?error.message:'public-list-unavailable'},true);completed=true;return;}
      await record({outcome:'succeeded',snapshot},true);
      completed=true;return;
    }
    if(job.action==='export_scan'){
      await open('https://letterboxd.com/settings/');
      const own=await ready(tab.id,job.account);
      if(own.error||own.identity!==job.account)throw Error('identity-not-verified');
      await open('https://letterboxd.com/user/exportdata/');
      await delay(1500);
      const [download]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:async()=>{
        const a=Array.from(document.querySelectorAll('a')).find(a=>a.textContent.trim()==='Export Data');
        if(!a||new URL(a.href).origin!==location.origin||new URL(a.href).pathname!=='/data/export/')return null;
        const capturedAt=Date.now();
        const response=await fetch(a.href,{credentials:'same-origin',signal:AbortSignal.timeout(90000)});
        if(!response.ok||new URL(response.url).origin!==location.origin)return null;
        const bytes=new Uint8Array(await response.arrayBuffer());
        if(bytes.length>10*1024*1024||bytes[0]!==80||bytes[1]!==75)return null;
        let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));
        return {encoded:btoa(s),capturedAt};
      }});
      if(!download?.result?.encoded)throw Error('export-download-failed');
      await record({outcome:'succeeded',identity:own.identity,complete:true,...download.result},true);
      completed=true;
      for(const id of ownedTabs)try{await chrome.tabs.remove(id);}catch{}
      return;
    }
    if(job.action==='review_cleanup'){
      if(job.account!=='prplmg'||instance!=='6e282ef9-86a2-4356-9387-16f99807e283')throw Error('invalid-job');
      const input={userId:1,account:'prplmg',kind:'review',film:'the-great-train-robbery'};
      await open('https://letterboxd.com/film/the-great-train-robbery/');
      await ready(tab.id,job.account);
      const before=await stableMediaRead(async()=>{const [r]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:reviewWritePage,args:[JSON.stringify(input)]});return r?.result;});
      const alreadyEmpty=before?.account===job.account&&before.complete&&!before.entryId&&before.values.rating===null&&before.values.text===''&&before.values.spoiler===false;
      {
      await open('https://letterboxd.com/prplmg/film/the-great-train-robbery/5/');
      const identity=await ready(tab.id,job.account);
      if(identity.error||identity.identity!==job.account)throw Error('identity-not-verified');
      const [read]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:reviewWritePage,args:[JSON.stringify({...input,entryId:'https://letterboxd.com/prplmg/film/the-great-train-robbery/5/'})]});
      if(!read?.result?.complete||read.result.values.text!=='1-2-3, probando'||read.result.values.rating!==2.5||read.result.values.spoiler!==false)throw Error('invalid-job');
      await record({stage:'before-pilot-cleanup'});touched=true;
      try{
        const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:cleanupPilotReview});
        await record({stage:'pilot-delete-returned',controls:[result?.result||{reason:'no-result'}]});
        if(result?.result?.reason)throw Error('cleanup-precondition-failed');
      }catch(error){if(error.message==='cleanup-precondition-failed')throw error;await record({stage:'pilot-delete-result-unavailable'});}
      await delay(2000);
      }
      // Deleting a review can leave the film-level rating behind. Restore only
      // the known pilot rating, and stop if the user changed it in the meantime.
      const ratingJob={...input,kind:'rating',expected:{rating:2.5},desired:{rating:null}};
      const cleared=await executeWriteIntent(ratingJob,{
        readFresh:async()=>{
          await open('https://letterboxd.com/film/the-great-train-robbery/');
          const own=await ready(tab.id,job.account);if(own.error)return {complete:false};
          return stableMediaRead(async()=>{const [r]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:ratingWritePage,args:[JSON.stringify(ratingJob)]});return r?.result;});
        },
        recordDispatch:async()=>{await record({stage:'before-pilot-rating-restore',identity:job.account});touched=true;},
        apply:async()=>{const [r]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:ratingWritePage,args:[JSON.stringify(ratingJob),true]});if(!r?.result?.dispatched)throw Error('restore-precondition-failed');await delay(2000);}
      });
      if(cleared.outcome!=='verified')throw Error('rating-cleanup-not-verified');
      await open('https://letterboxd.com/film/the-great-train-robbery/');
      const fresh=await ready(tab.id,job.account);if(fresh.error||fresh.identity!==job.account)throw Error('identity-not-verified');
      const empty=await stableMediaRead(async()=>{
        const [r]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:reviewWritePage,args:[JSON.stringify(input)]});return r?.result;
      });
      if(!empty?.complete||empty.entryId||empty.values.rating!==null||empty.values.text!==''||empty.values.spoiler!==false)throw Error('cleanup-not-verified');
      const watchedJob={...input,kind:'watched',expected:{watched:true},desired:{watched:false}};
      const restored=await executeWriteIntent(watchedJob,{
        readFresh:async()=>{
          await open('https://letterboxd.com/film/the-great-train-robbery/');
          const own=await ready(tab.id,job.account);if(own.error)return {complete:false};
          return stableMediaRead(async()=>{const [r]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:watchedWritePage,args:[JSON.stringify(watchedJob)]});return r?.result;});
        },
        recordDispatch:async()=>{await record({stage:'before-pilot-watched-restore',identity:job.account});touched=true;},
        apply:async()=>{const [r]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:watchedWritePage,args:[JSON.stringify(watchedJob),true]});if(!r?.result?.dispatched)throw Error('restore-precondition-failed');await delay(2000);}
      });
      await record({outcome:restored.outcome==='verified'?'succeeded':'unknown',stage:'pilot-cleanup-verified',identity:job.account,controls:[{entryRemoved:true,watched:restored.outcome==='verified'?false:null}]},true);completed=true;
      for(const id of ownedTabs)try{await chrome.tabs.remove(id);}catch{}
      return;
    }
    if(job.action==='review_observe'){
      if(!Number.isSafeInteger(job.userId)||job.userId<1||typeof job.account!=='string'||!/^[a-z0-9_]{1,40}$/.test(job.account)||!/^[a-z0-9-]{1,200}$/.test(job.film)||!Number.isFinite(job.claimedAt)||Date.now()-job.claimedAt>300000||job.claimedAt>Date.now()+5000)throw Error('invalid-job');
      // Separate hosts can differ by a few milliseconds. Wait for the claim
      // timestamp, retaining strict observation freshness instead of inventing it.
      if(job.claimedAt>Date.now())await delay(job.claimedAt-Date.now()+50);
      const validEntry=value=>{try{const u=new URL(value);return u.origin==='https://letterboxd.com'&&!u.search&&!u.hash&&new RegExp('^/'+job.account+'/film/'+job.film+'/(?:[1-9][0-9]*/)?$').test(u.pathname);}catch{return false;}};
      if(job.entryId&&!validEntry(job.entryId))throw Error('invalid-job');
      let entry=job.entryId, result, observationPage;
      for(let attempt=0;attempt<2;attempt++){
        await open(observationPage||entry||'https://letterboxd.com/film/'+job.film+'/');
        const identity=await ready(tab.id,job.account);
        if(identity.error||identity.identity!==job.account||identity.challenge){await record({stage:'observation-identity-incomplete',error:identity.error||'identity',identity:identity.identity,challenge:!!identity.challenge});result={complete:false};break;}
        result=await diagnostics.read(()=>stableMediaRead(async()=>{
          const [read]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:reviewWritePage,args:[JSON.stringify({...job,kind:'review',entryId:entry})]});
          return read?.result||{complete:false};
        }),record,'observation-read-incomplete');
        if(attempt===0&&!entry&&result?.followEntry&&validEntry(result.followEntry)){if(job.createNew)observationPage=result.followEntry;else entry=result.followEntry;continue;}
        if(attempt===0&&!entry){
          const fallback=await diaryObservationFallback(job,result,readInventory);
          if(fallback){
            entry=fallback;
            await record({stage:'observation-diary-entry-fallback'});
            continue;
          }
        }
        break;
      }
      const verified=result?.complete===true&&result.account===job.account&&(!entry||result.entryId===entry)&&(!result.entryId||validEntry(result.entryId));
      const watched=verified?await readWatched(job.film):null;
      const inventory=verified?await readInventory(job.film):null;
      await record(verified?{outcome:'succeeded',observationStatus:'verified',identity:job.account,complete:true,observation:{...result.values,...(watched?.complete?watched.values:{}),...inventory,observedAt:Date.now(),...(result.entryId?{entryId:result.entryId}:{})}}:{outcome:'blocked',observationStatus:result?.reason==='ambiguous-entry'?'ambiguous':'unknown',complete:false},true);
      completed=true;
      for(const id of ownedTabs)try{await chrome.tabs.remove(id);}catch{}
      return;
    }
    if(job.action==='media_write'){
      if(!Number.isSafeInteger(job.userId)||job.userId<1||typeof job.account!=='string'||!/^[a-z0-9_]{1,40}$/.test(job.account)||!['rating','review','diary','watched'].includes(job.kind)||!/^[a-z0-9-]{1,200}$/.test(job.film))throw Error('invalid-job');
      const pageAdapter=job.kind==='rating'?ratingWritePage:job.kind==='watched'?watchedWritePage:reviewWritePage;
      let entry=job.entryId;
      let diaryBaseline,diaryDispatched=false,reviewDispatched=false,reviewBeforeIds;
      const validEntry=value=>{try{const u=new URL(value);return u.origin==='https://letterboxd.com'&&!u.search&&!u.hash&&new RegExp('^/'+job.account+'/film/'+job.film+'/(?:[1-9][0-9]*/)?$').test(u.pathname);}catch{return false;}};
      if(entry&&!validEntry(entry))throw Error('invalid-job');
      const result=await executeWriteIntent(job,{
        workflowStore:{load:id=>workflowStorage('workflow:'+id),save:(id,state)=>workflowStorage('workflow:'+id,state)},
        captureState:async()=>({entry:entry||null,diaryBaseline:diaryBaseline||null,reviewBeforeIds:reviewBeforeIds||null}),
        restoreState:async state=>{
          entry=state?.entry||job.entryId;diaryBaseline=state?.diaryBaseline;reviewBeforeIds=state?.reviewBeforeIds;
          diaryDispatched=job.kind==='diary';reviewDispatched=job.kind==='review';
          if(diaryDispatched&&!job.entryId&&!diaryBaseline)throw Error('workflow-baseline-missing');
        },
        readFresh:()=>diagnostics.read(async()=>{
          if(job.kind==='diary'&&!job.entryId){
            const watched=await readWatched(job.film),inventory=await readInventory(job.film);
            if(!watched?.complete||!inventory?.diaryEntriesComplete)return {complete:false,account:job.account,reason:'incomplete-diary-inventory'};
            if(diaryDispatched){
              const added=inventory.diaryEntryIds.filter(id=>!diaryBaseline.diaryEntryIds.includes(id));
              if(added.length!==1||inventory.diaryEntryDates[added[0]]!==job.desired.watchedDate||diaryBaseline.diaryEntryIds.some(id=>inventory.diaryEntryDates[id]!==diaryBaseline.diaryEntryDates[id]))return {complete:false,account:job.account,reason:'ambiguous-new-diary-entry'};
              entry=added[0];
            }else{
              if(Object.values(inventory.diaryEntryDates).some(date=>date>=job.desired.watchedDate))return {complete:false,account:job.account,reason:'ambiguous-diary-date'};
              diaryBaseline={...inventory,watched:watched.values.watched,account:job.account,film:job.film,observedAt:Date.now()};
            }
          }
          const visited=new Set();
          for(let attempt=0;attempt<3;attempt++){
            const url=entry||(job.kind==='diary'&&!diaryDispatched&&diaryBaseline?.diaryEntryIds.length?diaryBaseline.diaryEntryIds[0]:'https://letterboxd.com/film/'+job.film+'/');
            if(visited.has(url))return {complete:false,account:job.account,reason:'entry-redirect-loop'};
            visited.add(url);
            const old=tab;await open(url);if(old&&old.id!==tab.id)try{await chrome.tabs.remove(old.id);}catch{}
            const identity=await ready(tab.id,job.account);
            if(identity.error||identity.identity!==job.account)return {complete:false,reason:identity.error||'identity',challenge:identity.challenge,account:identity.identity};
            const result=await stableMediaRead(async()=>{
              const [fresh]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:pageAdapter,args:[JSON.stringify({...job,entryId:entry,diaryBaseline,...(reviewDispatched&&reviewBeforeIds?{reviewBeforeIds}:{})})]});
              return fresh?.result||{complete:false};
            });
            if(!result.followEntry)return result;
            if(!validEntry(result.followEntry)||(job.entryId&&result.followEntry!==job.entryId))return {complete:false,account:job.account,reason:'entry-mismatch'};
            if(job.createNew&&reviewDispatched&&result.followEntry===job.previousEntryId)return {complete:false,account:job.account,reason:'new-entry-not-found'};
            if((job.kind==='diary'&&!job.entryId&&!diaryDispatched)||(job.createNew&&!entry&&!reviewDispatched)){
              if(job.createNew)reviewBeforeIds=result.reviewEntryIds||[result.followEntry];
              // A previous entry provides the explicit "log again" control,
              // never an entry ID to edit or acknowledge as this event.
              await open(result.followEntry);await ready(tab.id,job.account);
              const [fresh]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:pageAdapter,args:[JSON.stringify({...job,diaryBaseline})]});
              return fresh?.result||{complete:false};
            }
            entry=result.followEntry;
          }
          return {complete:false,account:job.account,reason:'entry-redirect-limit'};
        },record),
        recordDispatch:async()=>{await record({stage:'before-write-dispatch',identity:job.account});touched=true;},
        apply:async()=>{
          let applied;
          try{[applied]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:pageAdapter,args:[JSON.stringify({...job,entryId:entry,diaryBaseline}),true]});}
          catch(error){await record({stage:'media-apply-failed',error:/serializ|undefined|JSON/i.test(String(error.message))?'script-arguments-invalid':observationFailure(error)});throw error;}
          if(!applied?.result?.dispatched){await record({stage:'media-apply-rejected',...(job.kind==='rating'&&applied?.result?.values?{values:applied.result.values}:{}),error:safeMediaReason(applied?.result?.reason)||'write-precondition-failed'});throw Error('write-precondition-failed');}
          await record({stage:'media-apply-dispatched',identity:job.account});
          if(job.kind==='diary')diaryDispatched=true;
          if(job.kind==='review')reviewDispatched=true;
          // Read only after the save has had time to navigate; never resubmit.
          await delay(2000);
          const current=await chrome.tabs.get(tab.id);
          if(current.url&&validEntry(current.url))entry=current.url;
          if(job.createNew&&(entry===job.previousEntryId||reviewBeforeIds?.includes(entry)))entry=undefined;
        }
      });
      await record({outcome:result.outcome==='verified'?'succeeded':result.outcome==='unknown'?'unknown':'blocked',writeOutcome:result.outcome,error:result.reason,identity:job.account,...(result.outcome==='verified'?{values:job.desired,entryId:result.entryId}:{}),...(result.reason==='challenge'?{challenge:true}:{})},true);
      completed=true;
      for(const id of ownedTabs){if(result.outcome!=='verified'&&id===tab?.id)continue;try{await chrome.tabs.remove(id);}catch{}}
      await chrome.action.setBadgeText({text:result.outcome==='verified'?'OK':'WAIT'});return;
    }
    if(['review_probe','review_existing_probe','review_history_probe'].includes(job.action)){
      if(job.account!=='prplmg'||instance!=='6e282ef9-86a2-4356-9387-16f99807e283')throw Error('invalid-job');
      await open('https://letterboxd.com/film/the-great-train-robbery/');
      const identity=await ready(tab.id,job.account);
      if(identity.error||identity.identity!==job.account||identity.challenge)throw Error('identity-not-verified');
      if(job.action==='review_history_probe'){
        const watched=await stableMediaRead(async()=>{const [r]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:watchedWritePage,args:[JSON.stringify({userId:1,account:job.account,film:'the-great-train-robbery',kind:'watched'})]});return r?.result;});
        await open('https://letterboxd.com/prplmg/film/the-great-train-robbery/diary/');
        await ready(tab.id,job.account);
        const [history]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:inspectFilmHistory,args:[job.account,'the-great-train-robbery']});
        const diagnostics=[{label:'watched-read',...watched},{label:'film-diary',...history?.result}];
        diagnostics.push({label:'pilot-inventory',...await readInventory('the-great-train-robbery')});
        await open('https://letterboxd.com/prplmg/films/diary/');await ready(tab.id,job.account);
        const [sample]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:()=>Array.from(document.querySelectorAll('a[href]')).map(a=>new URL(a.href,location.href)).find(u=>u.origin===location.origin&&/^\/prplmg\/film\/[a-z0-9-]+\/(?:[1-9][0-9]*\/)?$/.test(u.pathname))?.pathname});
        if(sample?.result){
          const film=sample.result.split('/')[3];
          await open('https://letterboxd.com/prplmg/film/'+film+'/diary/');await ready(tab.id,job.account);
          const [diary]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:inspectFilmHistory,args:[job.account,film]});
          diagnostics.push({label:'dated-diary-sample',...diary?.result});
          const inventory=await readInventory(film),watched=await readWatched(film);
          diagnostics.push({label:'dated-inventory',film,...inventory});
          diagnostics.push({label:'dated-watched',...watched});
          if(inventory.diaryEntriesComplete&&inventory.diaryEntryIds.length&&watched.complete){
            await open(inventory.diaryEntryIds[0]);await ready(tab.id,job.account);
            const baseline={...inventory,watched:watched.values.watched,account:job.account,film,observedAt:Date.now()};
            const input={userId:1,account:job.account,film,kind:'diary',expected:{watchedDate:null,rewatch:false},desired:{watchedDate:new Date().toISOString().slice(0,10),rewatch:true},diaryBaseline:baseline};
            const dry=await stableMediaRead(async()=>{const [r]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:reviewWritePage,args:[JSON.stringify(input)]});return r?.result;});
            diagnostics.push({label:'rewatch-read-only-precondition',...dry});
            if(!dry?.complete){
              const [controls]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:inspectReviewControls,args:[job.account]});
              diagnostics.push({label:'rewatch-controls',...controls?.result});
            }
          }
        }
        await record({outcome:history?.result?.identity===job.account?'succeeded':'blocked',controls:diagnostics},true);completed=true;
        for(const id of ownedTabs)try{await chrome.tabs.remove(id);}catch{}
        return;
      }
      if(job.action==='review_existing_probe'){
        await open('https://letterboxd.com/prplmg/films/reviews/');
        const profile=await ready(tab.id,job.account);if(profile.error||profile.identity!==job.account)throw Error('identity-not-verified');
        const [link]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:()=>Array.from(document.querySelectorAll('a[href]')).map(a=>new URL(a.href,location.href)).find(u=>u.origin==='https://letterboxd.com'&&/^\/prplmg\/film\/[a-z0-9-]+\/(?:\d+\/)?$/.test(u.pathname))?.href});
        if(!link?.result)throw Error('no-own-review-found');
        await open(link.result);const own=await ready(tab.id,job.account);if(own.error||own.identity!==job.account)throw Error('identity-not-verified');
      }
      const diagnostic=[];
      if(job.action==='review_history_probe'){
        const [history]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:inspectFilmHistory,args:[job.account,'the-great-train-robbery']});
        diagnostic.push({label:'film-history',...history?.result});
      }
      if(job.action==='review_probe'){
        const input={userId:1,account:job.account,kind:'rating',film:'the-great-train-robbery',expected:{rating:null},desired:{rating:2.5}};
        for(let count=0;count<2;count++){
          const [dry]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:ratingWritePage,args:[JSON.stringify(input),true,true]});
          diagnostic.push({label:'rating-dry-precondition',...dry?.result});await delay(250);
        }
        const stable=await stableMediaRead(async()=>{
          const [read]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:ratingWritePage,args:[JSON.stringify(input)]});
          return read?.result||{complete:false};
        });
        diagnostic.push({label:'rating-stable-read',...stable});
        const [reviewRead]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:reviewWritePage,args:[JSON.stringify({...input,kind:'review'})]});
        diagnostic.push({label:'review-read-precondition',...reviewRead?.result});
      }
      const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:inspectReviewControls,args:[job.account]});
      if(result?.result?.identity!==job.account||result.result.challenge)throw Error('identity-not-verified');
      await record({...result.result,controls:[...result.result.controls,...diagnostic],outcome:'succeeded'},true);completed=true;
      for(const id of ownedTabs)try{await chrome.tabs.remove(id);}catch{}
      return;
    }
    if(job.action==='watchlist_set'){
      if(instance!=='6e282ef9-86a2-4356-9387-16f99807e283'||job.userId!==1||job.account!=='prplmg'||!/^[a-z0-9-]{1,200}$/.test(job.film))throw Error('invalid-job');
      const result=await executeWriteIntent({...job,kind:'watchlist'},{
        readFresh:async()=>{
          await open('https://letterboxd.com/film/'+job.film+'/');
          const observed=await ready(tab.id,job.account,undefined,true);
          return {account:observed.identity,challenge:observed.challenge,complete:!observed.error&&typeof observed.watchlisted==='boolean',values:{member:observed.watchlisted}};
        },
        recordDispatch:async()=>{await record({stage:'before-write-dispatch',identity:job.account});touched=true;},
        apply:async()=>{
          const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:inspectPilotPage,args:[job.account,true,job.expected.member,job.film]});
          if(!result?.result||result.result.error)throw Error('write-precondition-failed');
        }
      });
      await record({outcome:result.outcome==='verified'?'succeeded':result.outcome==='unknown'?'unknown':'blocked',writeOutcome:result.outcome,identity:job.account,...(result.outcome==='verified'?{values:job.desired}:{}),...(result.reason==='challenge'?{challenge:true}:{})},true);
      completed=true;
      for(const id of ownedTabs){if(result.outcome!=='verified'&&id===tab?.id)continue;try{await chrome.tabs.remove(id);}catch{}}
      await chrome.action.setBadgeText({text:result.outcome==='verified'?'OK':'WAIT'});return;
    }
    if(['watchlist_cycle','watchlist_restore'].includes(job.action) && job.account!=='prplmg')throw new Error('write-pilot-account-only');
    if(job.action==='close_profile_for_test'){
      if(job.account!=='prplmg' || instance!=='6e282ef9-86a2-4356-9387-16f99807e283')throw Error('invalid-job');
      await open('https://letterboxd.com/settings/');
      const identity=await ready(tab.id,job.account);
      if(identity.error || identity.identity!=='prplmg' || identity.challenge)throw Error('identity-not-verified');
      await chrome.tabs.remove(tab.id);
      // Chrome scopes extension windows to this browser profile. Never kill Edge processes.
      const windows=(await chrome.windows.getAll({windowTypes:['normal']})).filter(w=>!w.incognito);
      await record({outcome:'succeeded',stage:'authorized-profile-close-dispatched',identity:'prplmg'},true);
      completed=true;
      for(const window of windows)await chrome.windows.remove(window.id);
      return;
    }
    if(job.action==='watchlist_scan'){
      const snapshot=await collectWatchlist(job.account,async path=>{
        const old=tab;
        await open('https://letterboxd.com'+path);
        if(old)try{await chrome.tabs.remove(old.id);}catch{}
        let page, observationError;
        for(let attempt=0;attempt<24;attempt++){
          try {
            const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:inspectWatchlistPage,args:[job.account]});
            page=result?.result;
            if(page?.challenge)throw new Error('challenge');
            if(page?.identity===job.account && !page.error && (page.items?.length || page.emptyConfirmed===true))return page;
          } catch(error){if(error.message==='challenge')throw error;observationError=observationFailure(error);}
          await delay(1000);
        }
        // Bounded, sanitized structural diagnostic; no page HTML or credentials.
        const reason=page?.error || observationError || 'page-not-ready';
        await record({stage:'watchlist-page-unavailable',error:reason,identity:page?.identity || null});
        throw Error(reason);
      });
      await record({outcome:'succeeded',stage:'watchlist-snapshot',identity:job.account,complete:snapshot.complete,items:snapshot.items},true);
      completed=true;
      for(const id of ownedTabs)try{await chrome.tabs.remove(id);}catch{}
      await chrome.action.setBadgeText({text:'OK'});
      return;
    }
    if(job.action==='cleanup_tabs'){
      let closedTabs=0,skippedTabs=0;
      for(const id of job.tabIds || []){
        if(!Number.isInteger(id))throw new Error('invalid-job');
        try {
          const existing=await chrome.tabs.get(id);
          // Preserve a pilot tab if the user has navigated it elsewhere.
          if(!['https://letterboxd.com/settings/','https://letterboxd.com/film/the-great-train-robbery/'].includes(existing.url) || existing.pinned){skippedTabs++;continue;}
          await chrome.tabs.remove(id);closedTabs++;
        } catch {skippedTabs++;}
      }
      await record({outcome:'succeeded',stage:'pilot-tabs-cleaned',closedTabs,skippedTabs},true);
      completed=true;
      await chrome.action.setBadgeText({text:'OK'});
      return;
    }
    await chrome.action.setBadgeText({text:'RUN'});
    const url=job.action==='identity_probe'?'https://letterboxd.com/settings/':'https://letterboxd.com/film/the-great-train-robbery/';
    await open(url);
    const initial=await ready(tab.id,job.account,undefined,job.action!=='identity_probe');
    await record({stage:'fresh-page-observed',...initial});
    if(initial.error || initial.identity!==job.account || initial.challenge)throw new Error('identity-not-verified');
    if(job.action==='identity_probe'){
      await record({outcome:'succeeded',stage:'fresh-navigation-identity-verified',identity:initial.identity},true);
    } else {
      if(initial.watchlisted===null)throw new Error('watchlist-control-unrecognized');
      if(job.action==='watchlist_restore'){
        // Recovery for this pilot only: its durable baseline was absent.
        if(initial.watchlisted){
          await record({stage:'before-restore',original:false,watchlisted:true});
          touched=true;
          const restoring=await inspect(tab.id,job.account,true,true);
          if(restoring.error)throw new Error('restore-precondition-failed');
          if(!await observe('restore-ui-observed',false))throw new Error('restore-not-verified');
        }
        if(!await verifyFresh('restore-fresh-page-observed',false))throw new Error('restore-persistence-not-verified');
        await record({outcome:'succeeded',stage:'original-state-restored',identity:job.account,original:false,restored:true},true);
      } else if(job.action==='watchlist_probe'){
        await record({outcome:'succeeded',stage:'watchlist-state-verified',identity:initial.identity,original:initial.watchlisted},true);
      } else {
        const original=initial.watchlisted;
        // Persist the original state before any change. Never blindly repeat a toggle.
        await record({stage:'before-test-change',original,tabId:tab.id,identity:initial.identity});
        touched=true;
        const dispatched=await inspect(tab.id,job.account,true,original);
        if(dispatched.error)throw new Error('change-precondition-failed');
        if(!await observe('change-ui-observed',!original))throw new Error('change-not-verified');
        if(!await verifyFresh('change-fresh-page-observed',!original))throw new Error('persistence-not-verified');
        await record({stage:'before-restore',original,watchlisted:!original});
        const restoring=await inspect(tab.id,job.account,true,!original);
        if(restoring.error)throw new Error('restore-precondition-failed');
        if(!await observe('restore-ui-observed',original))throw new Error('restore-not-verified');
        if(!await verifyFresh('restore-fresh-page-observed',original))throw new Error('restore-persistence-not-verified');
        await record({outcome:'succeeded',stage:'original-state-restored',identity:job.account,original,restored:true},true);
      }
    }
    completed=true;
    await chrome.action.setBadgeText({text:'OK'});
    // Close only the tab we created, never the user's existing tabs.
    for(const id of ownedTabs)try{await chrome.tabs.remove(id);}catch{}
  } catch(error) {
    if(job?.id && started && !completed){
      const safeErrors=['challenge','identity-not-verified','watchlist-control-unrecognized','change-precondition-failed','change-not-verified','persistence-not-verified','restore-precondition-failed','restore-not-verified','restore-persistence-not-verified','invalid-job','incomplete-watchlist','pagination-limit-or-loop','duplicate-or-invalid-film','invalid-pagination','watchlist-changed-during-scan'];
      const needsInspection=['empty-or-unrecognized-watchlist','script-permission-blocked','script-observation-failed','observation-tab-unavailable','page-not-ready','sign-in-required'].includes(error.message);
      if(!finalPending)try{await record({outcome:touched?'unknown':'blocked',error:safeErrors.includes(error.message)||needsInspection?error.message:'worker-or-transport-failure',...(error.message==='challenge'?{challenge:true}:{}),...(tab?{tabId:tab.id}:{})},true);}catch{}
      await chrome.action.setBadgeBackgroundColor({color:'#b45309'});
      await chrome.action.setBadgeText({text:'WAIT'});
      // Only a human-resolvable challenge needs an open tab; diagnostics are durable.
      for(const id of ownedTabs){
        if((error.message==='challenge' || needsInspection) && id===tab?.id)continue;
        try{await chrome.tabs.remove(id);}catch{}
      }
      if(error.message==='challenge' && tab)try{await chrome.tabs.update(tab.id,{active:true});}catch{}
    }
  } finally {
    running=false;
    // Only transport/queue pickup is accelerated. A remote write still requires
    // its durable execution permission and independent persistence verification.
    if(completed)fastPolls=5;
    if(completed || (job?.action==='idle' && job.retryAfterMs && fastPolls-- > 0))
      chrome.alarms.create('pilot-followup',{when:Date.now()+1000});
  }
}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm?.name==='pilot')fastPolls=5;poll();});
function start(){chrome.alarms.create('pilot',{periodInMinutes:0.5});poll();}
chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
start();
