// Read only numeric resource counters and codec names; never output stream URLs.
const fs=require('fs');
const samples=Number(process.env.BENCH_SAMPLES||12);
const read=p=>{try{return fs.readFileSync(p,'utf8')}catch{return ''}};
let count=0;
function sample(){
 const m=Object.fromEntries([...read('/proc/meminfo').matchAll(/^(\w+):\s+(\d+)/gm)].map(x=>[x[1],Number(x[2])]));
 const procs=fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x));
 const streams=[];
 for(const pid of procs){if(read(`/proc/${pid}/comm`).trim()!=='ffmpeg')continue;const args=read(`/proc/${pid}/cmdline`).split('\0');const idx=args.findIndex(x=>['-vcodec','-c:v','-codec:v'].includes(x));const raw=idx>=0?args[idx+1]:'';const codec=['copy','libx264','h264_vaapi','h264_qsv','h264_nvenc'].includes(raw)?raw:'other/unspecified';const status=read(`/proc/${pid}/status`);streams.push({pid:Number(pid),rssKB:Number(status.match(/VmRSS:\s+(\d+)/)?.[1]||0),codec});}
 const cpu=read('/proc/stat').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
 console.log(JSON.stringify({at:new Date().toISOString(),availableKB:m.MemAvailable,swapUsedKB:m.SwapTotal-m.SwapFree,shmemKB:m.Shmem,cpu,streams}));
 if(++count>=samples)clearInterval(timer);
}
const timer=setInterval(sample,5000);sample();
