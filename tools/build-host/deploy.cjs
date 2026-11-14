// One-command scoped catalogue release. Credentials remain on the server.
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const host = 'minilie@100.118.63.67';
const remote = 'C:/ProgramData/Seerr';
const {miniNode}=require('./runtime-policy.cjs');
const run = (bin, args, options = {}) => cp.execFileSync(bin, args, { stdio: 'inherit', ...options });
const ssh = (command, options) => run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', host, command], options);
const manifestPath = path.resolve(process.argv[2] || path.resolve(__dirname, '../../../seerr-social/catalogue-release.json'));
const spec = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const files = spec.files, deletions = spec.delete || [];
const {allowed} = require('./release-input.cjs');
if (!Array.isArray(files) || !Array.isArray(deletions) || !files.length || [...files,...deletions].some(f=>!allowed(f)) || deletions.some(f=>files.includes(f))) throw Error('Invalid release file list');
const repo = path.resolve(__dirname, '../..');
if (cp.execFileSync('git',['ls-files','-u'],{cwd:repo,encoding:'utf8'}).trim()) throw Error('Resolve merge conflicts before releasing');
const payload = [...new Set(files)].map(file => ({file, after:fs.readFileSync(path.join(repo,file),'utf8')}));
for (const file of new Set(deletions)) {
 if (fs.existsSync(path.join(repo,file))) throw Error('Deleted file still exists: '+file);
 payload.push({file,after:null});
}
console.log('Deploying only:\n' + payload.map(e => '  ' + e.file).join('\n'));
const id = 'catalogue-' + new Date().toISOString().replace(/[^0-9]/g, '') + '-' + process.pid;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-deploy-'));
const buildId = ssh('powershell.exe -NoProfile -Command "Get-Content C:/ProgramData/Seerr/app/.next/BUILD_ID"', { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }).trim();
if (!/^[\w-]+$/.test(buildId)) throw Error('Invalid live build identity');
let script = fs.readFileSync(path.resolve(__dirname, '../maintenance/release-engine.cjs'), 'utf8')
  .replaceAll('reconciliation-release-20261019', id + '-release')
  .replaceAll('reconciliation-native-20261019', id + '-native')
  .replaceAll('reconciliation-source.json', id + '-source.json')
  .replace('./deployment-health.cjs', './' + id + '-health.cjs')
  .replace('./rollout-control.cjs', './' + id + '-control.cjs')
  .replace('./ledger-rollout.cjs', './' + id + '-ledger.cjs')
  .replaceAll('./build-host/runtime-policy.cjs', './' + id + '-tools/runtime-policy.cjs')
  .replaceAll('./build-host/release-input.cjs', './' + id + '-tools/release-input.cjs')
  .replaceAll("root+'/build-host/mini-build.cjs'", "root+'/"+id+"-tools/mini-build.cjs'")
  .replaceAll('g7IGMd-mQTo3taLfl1Jf9', buildId);
const ending = 'main().catch(e=>{console.error(e.message);process.exitCode=1});';
if (!script.includes(ending)) throw Error('Release engine changed; update wrapper before deploying');
script = script.replace(ending, `
async function releaseAll() {
 const lock=root+'/catalogue-deploy.lock';
 fs.mkdirSync(lock); // Exclusive: never overlap catalogue deploys.
 try {
  fs.writeFileSync(lock+'/owner.json', JSON.stringify({pid:process.pid,release,started:new Date().toISOString()}));
  process.argv[2]='build'; await main();
  process.argv[2]='deploy'; await main();
  try { console.log(JSON.stringify(require(root+'/${id}-tools/retention.cjs').run(root,true))); }
  catch(e) { throw Error('Deployment succeeded, but retention failed: '+e.message); }
 } finally { fs.unlinkSync(lock+'/owner.json'); fs.rmdirSync(lock); }
}
releaseAll().catch(e=>{console.error(e.stack);process.exitCode=1});
`);
fs.writeFileSync(path.join(temp, id + '-source.json'), JSON.stringify(payload));
fs.writeFileSync(path.join(temp, id + '.cjs'), script);
fs.copyFileSync(path.join(__dirname, 'deployment-health.cjs'), path.join(temp, id + '-health.cjs'));
fs.copyFileSync(path.resolve(__dirname, '../maintenance/rollout-control.cjs'), path.join(temp, id + '-control.cjs'));
fs.copyFileSync(path.resolve(__dirname, '../maintenance/ledger-rollout.cjs'), path.join(temp, id + '-ledger.cjs'));
// Native file redirection avoids Windows PowerShell transcript console-buffer errors.
const runner = `const fs=require('fs'),cp=require('child_process');
const fd=fs.openSync(${JSON.stringify(remote+'/'+id+'.log')},'a');
const child=cp.spawn(process.execPath,[${JSON.stringify(remote+'/'+id+'.cjs')}],{stdio:['ignore',fd,fd]});
child.on('error',e=>console.error(e.message));
child.on('close',(code,signal)=>{fs.closeSync(fd);process.stdout.write(fs.readFileSync(${JSON.stringify(remote+'/'+id+'.log')},'utf8'));process.exitCode=code??1;});`;
fs.writeFileSync(path.join(temp,id+'-runner.cjs'),runner);
run('scp', ['-o', 'BatchMode=yes', path.join(temp, id + '-source.json'), path.join(temp, id + '.cjs'), path.join(temp,id+'-health.cjs'), path.join(temp,id+'-control.cjs'), path.join(temp,id+'-ledger.cjs'), path.join(temp,id+'-runner.cjs'), host + ':' + remote + '/']);
ssh('powershell.exe -NoProfile -Command \"New-Item -ItemType Directory -Force '+remote+'/'+id+'-tools | Out-Null\"');
run('scp', ['-o', 'BatchMode=yes', ...['storage.cjs','runtime-policy.cjs','migration-preflight.cjs','pc-build.cjs','export-links.cjs','retention.cjs','release-input.cjs','mini-build.cjs','restore-links.cjs','smoke-trial.cjs'].map(f=>path.join(__dirname,f)), host + ':' + remote + '/' + id + '-tools/']);
console.log('Building on PRPL-PC; Mini verifies the output before taking the maintenance lease.');
ssh(miniNode + ' ' + remote + '/' + id + '-runner.cjs');
console.log('Deployment complete. Backup and verification: ' + remote + '/' + id + '-release');
