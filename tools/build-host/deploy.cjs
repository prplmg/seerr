// One-command scoped catalogue release. Credentials remain on the server.
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const host = 'minilie@100.118.63.67';
const remote = 'C:/ProgramData/Seerr';
const run = (bin, args, options = {}) => cp.execFileSync(bin, args, { stdio: 'inherit', ...options });
const ssh = (command, options) => run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', host, command], options);
const manifestPath = path.resolve(process.argv[2] || path.resolve(__dirname, '../../../seerr-social/catalogue-release.json'));
const files = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files;
if (!Array.isArray(files) || !files.length || files.some(f => typeof f !== 'string' || (!['seerr-api.yml','package.json','pnpm-lock.yaml','server/lib/data/UNICODE-LICENSE.txt'].includes(f) && !/^(src|server)\/[\w/.\[\]-]+\.(tsx?|json|css)$/.test(f)) || f.includes('..') || f.includes('.test.'))) throw Error('Invalid release file list');
const repo = path.resolve(__dirname, '../..');
const payload = [...new Set(files)].map(file => ({ file, after: fs.readFileSync(path.join(repo, file), 'utf8') }));
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
 } finally { fs.unlinkSync(lock+'/owner.json'); fs.rmdirSync(lock); }
}
releaseAll().catch(e=>{console.error(e.stack);process.exitCode=1});
`);
fs.writeFileSync(path.join(temp, id + '-source.json'), JSON.stringify(payload));
fs.writeFileSync(path.join(temp, id + '.cjs'), script);
fs.copyFileSync(path.join(__dirname, 'deployment-health.cjs'), path.join(temp, id + '-health.cjs'));
// Native file redirection avoids Windows PowerShell transcript console-buffer errors.
const runner = `const fs=require('fs'),cp=require('child_process');
const fd=fs.openSync(${JSON.stringify(remote+'/'+id+'.log')},'a');
const child=cp.spawn(process.execPath,[${JSON.stringify(remote+'/'+id+'.cjs')}],{stdio:['ignore',fd,fd]});
child.on('error',e=>console.error(e.message));
child.on('close',(code,signal)=>{fs.closeSync(fd);process.stdout.write(fs.readFileSync(${JSON.stringify(remote+'/'+id+'.log')},'utf8'));process.exitCode=code??1;});`;
fs.writeFileSync(path.join(temp,id+'-runner.cjs'),runner);
run('scp', ['-o', 'BatchMode=yes', path.join(temp, id + '-source.json'), path.join(temp, id + '.cjs'), path.join(temp,id+'-health.cjs'), path.join(temp,id+'-runner.cjs'), host + ':' + remote + '/']);
console.log('Building on PRPL-PC; Mini verifies the output before taking the maintenance lease.');
ssh('C:\\ProgramData\\Seerr\\node\\node.exe C:\\ProgramData\\Seerr\\' + id + '-runner.cjs');
console.log('Deployment complete. Backup and verification: ' + remote + '/' + id + '-release');
