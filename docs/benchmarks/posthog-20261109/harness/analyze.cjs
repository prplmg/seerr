const fs=require('fs');const root=__dirname,raw=JSON.parse(fs.readFileSync(root+'/results.json'));const rows=raw.filter(x=>x.phase!=='burst');
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;const quant=(a,p)=>{const b=[...a].sort((x,y)=>x-y),i=(b.length-1)*p;return b[Math.floor(i)]+(b[Math.ceil(i)]-b[Math.floor(i)])*(i%1)};
let seed=17421;const rand=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)/4294967296);
function ci(a){const samples=Array.from({length:5000},()=>mean(a.map(()=>a[Math.floor(rand()*a.length)])));return [quant(samples,.025),quant(samples,.975)];}
const summary={version:require('./node_modules/posthog-js/package.json').version,measuredVisits:rows.length,burstGroups:raw.filter(x=>x.phase==='burst').length,groups:[],deltas:[],burst:[]};
for(const phase of ['cold','warm'])for(const width of [390,1440])for(const route of ['/reviews','/find-to-watch'])for(const mode of ['off','events','replay']){
 const group=rows.filter(x=>x.phase===phase&&x.width===width&&x.route===route&&x.mode===mode);if(!group.length)continue;
 const vals={ready:group.map(x=>x.ready),fcp:group.map(x=>x.fcp),lcp:group.map(x=>x.lcp),task:group.map(x=>x.cpuMs),heapMiB:group.map(x=>x.heapBytes/1048576),interaction:group.map(x=>mean(x.clickTimes)),longMs:group.map(x=>x.long.reduce((s,t)=>s+t.duration,0)),eventKiB:group.map(x=>x.events.reduce((s,t)=>s+t.bytes,0)/1024),uploadKiB:group.map(x=>x.receipts.reduce((s,t)=>s+t.bytes,0)/1024),downloadKiB:group.map(x=>x.resources.reduce((s,t)=>s+t.transfer,0)/1024),storageBytes:group.map(x=>x.storageBytes)};
 const stats=Object.fromEntries(Object.entries(vals).map(([k,a])=>[k,{median:quant(a,.5),p95:quant(a,.95),mean:mean(a)}]));summary.groups.push({phase,width,route,mode,n:group.length,stats});
}
for(const phase of ['cold','warm'])for(const mode of ['events','replay']){
 const pairs=rows.filter(x=>x.phase===phase&&x.mode===mode).map(on=>({on,off:rows.find(o=>o.mode==='off'&&o.phase===on.phase&&o.route===on.route&&o.width===on.width&&o.round===on.round)})).filter(x=>x.off);
 if(!pairs.length)continue;
 const metrics={ready:p=>p.ready,fcp:p=>p.fcp,task:p=>p.cpuMs,heapMiB:p=>p.heapBytes/1048576,interaction:p=>mean(p.clickTimes)};
 summary.deltas.push({phase,mode,n:pairs.length,...Object.fromEntries(Object.entries(metrics).map(([k,f])=>{const d=pairs.map(p=>f(p.on)-f(p.off));return [k,{mean:mean(d),ci95:ci(d)}]}))});
}
for(const mode of ['off','events','replay']){const g=raw.filter(x=>x.phase==='burst'&&x.mode===mode);if(g.length)summary.burst.push({mode,n:g.length,groupMsMedian:quant(g.map(x=>x.groupMs),.5),taskMsMedian:quant(g.map(x=>x.rows.reduce((s,r)=>s+r.cpuMs,0)),.5)});}
fs.writeFileSync(root+'/summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
