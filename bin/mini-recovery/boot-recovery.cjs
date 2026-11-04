'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const { Resolver } = require('node:dns').promises;
const SERVICES = ['AdGuardHome', 'Tailscale'];
async function recover(io, delays = [0, 15000, 30000, 60000, 120000]) {
  const deadline = io.now() + 10 * 60 * 1000;
  for (let round = 0; round < delays.length; round++) {
    if (io.now() + delays[round] >= deadline) break;
    if (delays[round]) await io.sleep(delays[round]);
    const results = await Promise.all(SERVICES.map(async service => {
      try {
        const state = await io.state(service);
        if (state === 1) {
          io.log({service, round, action: 'start-stopped-service'});
          await io.start(service);
        } else if (state !== 4) {
          io.log({service, round, state, ready: false});
          return false;
        }
        const ready = await io.ready(service);
        io.log({service, round, state, ready});
        return ready;
      } catch (error) {
        io.log({service, round, error: error.code || error.name || 'Error'});
        return false;
      }
    }));
    if (results.every(Boolean)) { io.log({result:'healthy', rounds:round+1}); return 0; }
  }
  io.log({result:'unresolved', action:'manual-investigation-required'});
  return 1;
}
function command(file, args, timeout = 12000) {
  return new Promise((resolve, reject) => cp.execFile(file, args,
    {timeout, windowsHide:true, maxBuffer:1024*1024}, (err, stdout) => err ? reject(err) : resolve(stdout)));
}
function acquireLock(file, uptime = os.uptime()) {
  const started = Date.now(), boot = started - uptime*1000;
  try {
    const old = JSON.parse(fs.readFileSync(file, 'utf8'));
    let alive = false;
    if (old.started >= boot - 30000) {
      try { process.kill(old.pid,0); alive=true; } catch(e) { if(e.code!=='ESRCH') alive=true; }
    }
    if (alive) return undefined;
    fs.unlinkSync(file);
  } catch(e) { if(e.code!=='ENOENT') throw e; }
  try { fs.writeFileSync(file,JSON.stringify({pid:process.pid,started}),{flag:'wx'}); }
  catch(e) { if(e.code==='EEXIST') return undefined; throw e; }
  return () => fs.unlinkSync(file);
}
async function main() {
  if(process.platform!=='win32') throw Error('Windows only');
  const dir=__dirname, logfile=path.join(dir,'recovery.jsonl');
  const release=acquireLock(path.join(dir,'running.lock'));
  if(!release) return 0;
  if(fs.existsSync(logfile) && fs.statSync(logfile).size>1024*1024) {
    fs.rmSync(logfile+'.4',{force:true});
    for(let n=3;n>=1;n--) if(fs.existsSync(logfile+'.'+n)) fs.renameSync(logfile+'.'+n,logfile+'.'+(n+1));
    fs.renameSync(logfile,logfile+'.1');
  }
  const log=record=>fs.appendFileSync(logfile,JSON.stringify({at:new Date().toISOString(),...record})+'\n');
  try {
    log({event:'begin',pid:process.pid});
    const result=await recover({now:Date.now,sleep:ms=>new Promise(r=>setTimeout(r,ms)),log,
      state:async name=>{
        const text=await command('sc.exe',['query',name]);
        const match=text.match(/STATE\s*:\s*(\d+)/);
        if(!match) throw Error('Unknown service state');
        return Number(match[1]);
      },
      start:name=>command('sc.exe',['start',name]),
      ready:async name=>{
        if(name==='AdGuardHome') {
          const dns=new Resolver({timeout:3000,tries:1});dns.setServers(['127.0.0.1']);
          const [internet,privateHost]=await Promise.all([dns.resolve4('example.com'),dns.resolve4('torrent.prpl.com.mx')]);
          return internet.length>0 && privateHost.includes('100.87.16.107');
        }
        const exe='C:/Program Files/Tailscale/tailscale.exe';
        const status=JSON.parse(await command(exe,['status','--json']));
        if(status.BackendState!=='Running'||!status.Self?.Online) return false;
        const ping=await command(exe,['ping','--c','1','--timeout','4s','100.87.16.107'],8000);
        return /pong from/i.test(ping);
      }});
    fs.writeFileSync(path.join(dir,'last-result.json'),JSON.stringify({at:new Date().toISOString(),exitCode:result}));
    return result;
  } finally {release();}
}
module.exports={recover,acquireLock};
if(require.main===module)main().then(code=>{process.exitCode=code;}).catch(err=>{console.error(err.code||err.name);process.exitCode=1;});
