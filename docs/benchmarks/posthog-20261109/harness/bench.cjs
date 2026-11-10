const fs=require('fs'),path=require('path'),http=require('http'),zlib=require('zlib'),assert=require('assert/strict');
const {chromium}=require('../../koalasync-fork/node_modules/playwright');
const root=__dirname, dist=root+'/node_modules/posthog-js/dist', rows=process.env.WARM_ONLY==='1'?JSON.parse(fs.readFileSync(__dirname+'/results.json')).filter(x=>x.phase!=='warm'):[], receipts=[];let base;
const modes=['off','events','replay'];
const init=`(()=>{const params=new URLSearchParams(location.search),mode=params.get('mode'),run=params.get('run');window.benchEvents=[];window.posthog.init('phc_isolated_synthetic_benchmark',{opt_out_useragent_filter:true,rewriteRequestPath:u=>{if(['/e/','/s/'].includes(u.pathname))u.searchParams.set('run',run);return u;},request_queue_config:{flush_interval_ms:1000},api_host:location.origin,ui_host:location.origin,autocapture:false,capture_pageview:false,capture_pageleave:false,disable_session_recording:mode!=='replay',disable_surveys:true,disable_conversations:true,capture_heatmaps:false,capture_performance:false,capture_exceptions:false,rageclick:false,advanced_disable_feature_flags:true,person_profiles:'never',persistence:'localStorage+cookie',session_recording:{maskAllInputs:true,maskTextSelector:'*',recordCrossOriginIframes:false},before_send:e=>{window.benchEvents.push({event:e.event,bytes:JSON.stringify(e).length});return e;},loaded:p=>{window.sdkReady=performance.now();p.capture('$pageview',{benchmark:true,page:location.pathname});if(mode==='replay')p.startSessionRecording({sampling:true,linked_flag:true});}});document.addEventListener('click',e=>{if(e.target.closest('button'))posthog.capture('benchmark_action',{kind:'button'});},true);})();`;
const perf=`window.benchPerf={long:[],lcp:0,ready:0};new PerformanceObserver(l=>l.getEntries().forEach(e=>window.benchPerf.long.push({start:e.startTime,duration:e.duration}))).observe({type:'longtask',buffered:true});new PerformanceObserver(l=>l.getEntries().forEach(e=>window.benchPerf.lcp=e.startTime)).observe({type:'largest-contentful-paint',buffered:true});new MutationObserver(()=>{if(!window.benchPerf.ready&&document.querySelectorAll('button').length>3)requestAnimationFrame(()=>requestAnimationFrame(()=>{window.benchPerf.ready ||= performance.now()}))}).observe(document,{childList:true,subtree:true});`;
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://local');if(u.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
 if(req.method==='POST'){let chunks=[];req.on('data',b=>chunks.push(b));req.on('end',()=>{receipts.push({run:u.searchParams.get('run'),path:u.pathname,bytes:Buffer.concat(chunks).length});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(u.pathname.includes('flags')?{featureFlags:{},sessionRecording:{endpoint:'/s/',recorderVersion:'v2',sampleRate:1,minimumDurationMilliseconds:0}}:{status:1}));});return;}
 if(u.pathname.endsWith('/config')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({autocapture_opt_out:true,sessionRecording:{endpoint:'/s/',recorderVersion:'v2',sampleRate:1,minimumDurationMilliseconds:0}}));return;}
 let data,type='text/javascript',cache=true;
 if(u.pathname.endsWith('/config.js')){data='';}
 else if(u.pathname==='/init.js'){data=init;}
 else if(u.pathname==='/sdk.js'){data=fs.readFileSync(dist+'/array.js');}
 else if(u.pathname.startsWith('/static/')){const f=dist+'/'+path.basename(u.pathname);if(!fs.existsSync(f)){res.writeHead(404);res.end();return;}data=fs.readFileSync(f);}
 else if(u.pathname==='/reviews'||u.pathname==='/find-to-watch'){
  const folder=u.pathname==='/reviews'?'reviews':'finder';
  let html=fs.readFileSync(root+'/'+folder+'/index.html','utf8').replaceAll('href="styles.css"','href="/reviews/styles.css"').replaceAll('href="preview.css"','href="/finder/preview.css"').replaceAll('src="app.js"','src="/reviews/app.js"').replaceAll('src="preview.js"','src="/finder/preview.js"');
  html=html.replace('<div id="root">',`<script>${perf}</script><div id="root">`);
  if(u.searchParams.get('mode')!=='off')html+='<script defer src="/sdk.js"></script><script defer src="/init.js"></script>';
  data=html;type='text/html';cache=false;
 }else{
  const f=u.pathname.endsWith('.jpg')?root+'/finder/'+path.basename(u.pathname):root+u.pathname;
  if(!f.startsWith(root+'/')||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end();return;}
  data=fs.readFileSync(f);type=f.endsWith('.css')?'text/css':f.endsWith('.jpg')?'image/jpeg':'text/javascript';
 }
 const body=zlib.gzipSync(data);res.setHeader('Content-Type',type);res.setHeader('Content-Encoding','gzip');res.setHeader('Cache-Control',cache?'public,max-age=3600':'no-store');res.setHeader('Content-Length',body.length);res.end(body);
});
async function visit(ctx,route,mode,measure=true){
 const p=await ctx.newPage(),cdp=await ctx.newCDPSession(p);await cdp.send('Performance.enable');await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['https://*']});await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:2500000,uploadThroughput:1250000});
 const errors=[];if(process.env.PILOT)p.on('console',m=>console.log('BROWSER',mode,m.type(),m.text()));p.on('pageerror',e=>errors.push(e.message));const failed=[];p.on('response',r=>{if(r.status()>=400)failed.push(r.url()+':'+r.status())});
 const run=require('crypto').randomUUID();await p.goto(base+route+'?mode='+mode+'&run='+run,{waitUntil:'load'});
 await p.waitForFunction(()=>window.benchPerf?.ready>0,{timeout:15000});
 if(mode!=='off')await p.waitForFunction(()=>window.sdkReady>0);
 if(mode==='replay'){await p.waitForFunction(()=>posthog.sessionRecordingStarted(),{timeout:10000});}
 if(route==='/find-to-watch')await p.waitForFunction(()=>document.querySelectorAll('img').length>=120,{timeout:15000});
 const ready=await p.evaluate(()=>performance.now());if(!measure){await p.waitForLoadState('networkidle');await p.close();return;}
 const clickTimes=[];
 for(let i=0;i<6;i++){
  const label=route==='/reviews'?'Edit':'More filters';
  const btn=route==='/reviews'?p.getByRole('button',{name:'Edit',exact:true}).first():p.locator('button').filter({hasText:'More filters'}).first();
  if(await btn.count()){
   const t=performance.now();await btn.click();await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));clickTimes.push(performance.now()-t);
   await p.keyboard.press('Escape');
   const cancel=p.getByRole('button',{name:/^Cancel$/}).first();if(await cancel.isVisible().catch(()=>false))await cancel.click();
  }
  await p.evaluate(i=>scrollTo(0,i%2?0:document.body.scrollHeight),i);await p.waitForTimeout(80);
 }
 await p.waitForTimeout(1300);
 const perfData=await p.evaluate(()=>({...window.benchPerf,fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime,sdkReady:window.sdkReady||0,events:window.benchEvents||[],recording:window.posthog?.sessionRecordingStarted()||false,resources:performance.getEntriesByType('resource').map(e=>({name:new URL(e.name).pathname,transfer:e.transferSize,encoded:e.encodedBodySize})),storageBytes:JSON.stringify(localStorage).length+document.cookie.length,domNodes:document.querySelectorAll('*').length}));
 const m=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
 if(mode==='events'&&!perfData.events.some(e=>e.event==='benchmark_action'))throw Error('No action events captured');
 if(mode==='replay'&&!perfData.events.some(e=>e.event==='$snapshot'))throw Error('Replay reported active but no snapshots captured');
 assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
 const r={route,mode,ready,...perfData,clickTimes,cpuMs:m.TaskDuration*1000,heapBytes:m.JSHeapUsedSize,receipts:receipts.filter(x=>x.run===run),errors};
 await p.close();return r;
}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-networking']});
 try{
 const rounds=Number(process.env.ROUNDS||6),pilot=process.env.PILOT==='1';
 for(const viewport of (pilot?[{width:390,height:844}]:[{width:390,height:844},{width:1440,height:900}]))for(const route of ['/reviews','/find-to-watch'])for(const phase of (pilot?['cold']:process.env.WARM_ONLY==='1'?['warm']:['cold','warm']))for(let round=0;round<(pilot?1:rounds);round++){
  const order=modes.slice(round%3).concat(modes.slice(0,round%3));
  for(const mode of order){const ctx=await browser.newContext({viewport,serviceWorkers:'block',userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'});try{
   if(phase==='warm')await visit(ctx,route,mode,false);
   const row=await visit(ctx,route,mode);if(phase==='warm'){const scripts=row.resources.filter(r=>r.name.endsWith('.js'));assert(scripts.length>0);assert(scripts.every(r=>r.transfer===0),'Warm script cache miss: '+JSON.stringify(scripts));}rows.push({...row,width:viewport.width,phase,round});fs.writeFileSync(root+(pilot?'/pilot.json':'/results.json'),JSON.stringify(rows,null,2));
   console.log(JSON.stringify({width:viewport.width,route,phase,round,mode,ready:Math.round(row.ready),cpu:Math.round(row.cpuMs),events:row.events.length,snapshots:row.events.filter(x=>x.event==='$snapshot').length}));
  }finally{await ctx.close();}}
 }
 if(!pilot&&process.env.WARM_ONLY!=='1')for(let round=0;round<3;round++)for(const mode of modes.slice(round%3).concat(modes.slice(0,round%3))){
  const contexts=await Promise.all(Array.from({length:4},()=>browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'})));
  const start=performance.now();try{const group=await Promise.all(contexts.map((c,i)=>visit(c,i%2?'/reviews':'/find-to-watch',mode)));rows.push({phase:'burst',round,mode,groupMs:performance.now()-start,rows:group});fs.writeFileSync(root+'/results.json',JSON.stringify(rows,null,2));console.log(JSON.stringify({phase:'burst',round,mode,groupMs:Math.round(performance.now()-start)}));}finally{await Promise.all(contexts.map(c=>c.close()));}
 }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e.stack);server.close();process.exitCode=1});
