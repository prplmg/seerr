// Run under the shared Mini deployment lock, before taking Caddy's lease.
const fs = require('node:fs'),
  path = require('node:path'),
  cp = require('node:child_process'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict');
const [live, stage, release] = process.argv.slice(2),
  id = path.basename(release).replace(/-release$/, '');
assert.match(id, /^catalogue-\d+-\d+$/);
const {nodeVersion,pcNode}=require('./runtime-policy.cjs');
assert.equal(process.version,nodeVersion);
const host = 'MSI@100.72.204.19',
  builder = 'D:/CatalogueBuilder',
  job = builder + '/jobs/' + id;
const opts = [
  '-o',
  'BatchMode=yes',
  '-o',
  'ConnectTimeout=10',
  '-o',
  'ServerAliveInterval=15',
  '-o',
  'ServerAliveCountMax=3',
];
const hash = (f) =>
  crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const run = (cmd, args, cwd) =>
  cp.execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const ssh = (cmd) => run('ssh.exe', ['-p', '2222', ...opts, host, cmd]);
const scp = (...args) => run('scp.exe', ['-P', '2222', ...opts, ...args]);
const inputs = [
  'src',
  'server',
  'public',
  'bin',
  'next-env.d.ts',
  'next.config.ts',
  'next.config.mjs',
  'next.config.js',
  'package.json',
  'pnpm-lock.yaml',
  'postcss.config.js',
  'seerr-api.yml',
  'tailwind.config.js',
  'tsconfig.json',
];
const exclude = [
  '--exclude',
  '*.before-*',
  '--exclude',
  '*.bak',
  '--exclude',
  'backup-*',
  '--exclude',
  '.env*',
  '--exclude',
  '*.sqlite*',
  '--exclude',
  'node_modules',
];
const {bytes,requireSpace}=require('./storage.cjs');
requireSpace(path.dirname(live),3*1024**3);
const input = release + '/build-input.tar';
ssh('cmd /d /c "mkdir ' + job.replaceAll('/', '\\') + '"');
fs.mkdirSync(stage);
run(
  'tar.exe',
  [
    '-cf',
    input,
    ...exclude,
    ...inputs.filter((f) => f !== 'bin' && fs.existsSync(path.join(live,f))),
    'bin/prepare.mjs',
  ],
  live
);
run('tar.exe', ['-xf', input], stage);
for (const entry of JSON.parse(fs.readFileSync(release + '/manifest.json'))) {
  require('./release-input.cjs').apply(stage,entry,path.join(release,'source'));
}
// The builder only gets our sanitized source snapshot and reviewed payload.
fs.writeFileSync(stage + '/.npmrc', 'engine-strict=true\n');
if (inputs.filter(f=>f.startsWith('next.config.')&&fs.existsSync(path.join(stage,f))).length!==1) throw Error('Exactly one Next config required; explicitly delete the old config');
run('tar.exe', ['-cf', input, ...inputs.filter(f=>fs.existsSync(path.join(stage,f))), '.npmrc'], stage);
const inputHash = hash(input);
scp(input, host + ':' + job + '/input.tar');
scp(path.join(__dirname,'pc-build.cjs'),path.join(__dirname,'export-links.cjs'),path.join(__dirname,'storage.cjs'),path.join(__dirname,'runtime-policy.cjs'),host+':'+job+'/');
ssh(
  pcNode + ' ' +
    builder +
    '/jobs/' + id + '/pc-build.cjs ' +
    id +
    ' ' +
    inputHash
);
for (const name of ['receipt.json', 'runtime-links.json', 'compiled.tgz', 'pnpm.tgz'])
  scp(host + ':' + job + '/' + name, release + '/' + name);
const receipt = JSON.parse(fs.readFileSync(release + '/receipt.json'));
assert.equal(receipt.release, id);
assert.equal(receipt.node, process.version, 'Mini must use the builder Node version');
assert.equal(process.platform,'win32');
assert.equal(process.arch,'x64');
assert.equal(receipt.pnpmHash,hash(release+'/pnpm.tgz'));
assert.equal(receipt.inputHash, inputHash);
assert.equal(receipt.artifactHash, hash(release + '/compiled.tgz'));
assert.equal(receipt.linksHash, hash(release + '/runtime-links.json'));
// Budget dependency install plus store/temp overhead, expanded artifacts, two DB
// copies, and a 2 GiB reserve; reject before install and before maintenance.
const storage=requireSpace(path.dirname(live),2*receipt.dependencyBytes+receipt.artifactExpandedBytes+2*bytes(path.join(path.dirname(live),'data'))+2*1024**3);
fs.writeFileSync(release+'/storage.json',JSON.stringify(storage));
run('tar.exe', ['-xf', release + '/compiled.tgz'], stage);
assert.equal(
  fs.readFileSync(stage + '/.next/BUILD_ID', 'utf8').trim(),
  receipt.buildId
);
// Install in a stable, release-specific location. Never install into live modules.
// Junctions (including Next aliases) keep this path through switch and rollback.
const runtime = path.join(path.dirname(live),id+'-runtime');
fs.mkdirSync(runtime);
for (const file of ['package.json','pnpm-lock.yaml','.npmrc']) fs.copyFileSync(path.join(stage,file),path.join(runtime,file));
fs.mkdirSync(path.join(runtime,'bin'));
fs.copyFileSync(path.join(stage,'bin/prepare.mjs'),path.join(runtime,'bin/prepare.mjs'));
const installer=path.join(release,'installer'); fs.mkdirSync(installer);
run('tar.exe',['-xf',release+'/pnpm.tgz'],installer);
const pnpm=path.join(installer,'bin/pnpm.cjs');
assert.equal(cp.execFileSync(process.execPath,[pnpm,'--version'],{encoding:'utf8'}).trim(),'10.24.0');
Object.assign(process.env,{HUSKY:'0',CI:'true',CYPRESS_INSTALL_BINARY:'0',NEXT_TELEMETRY_DISABLED:'1'});
process.env.PATH=path.dirname(process.execPath)+';'+process.env.PATH;
run(process.execPath,[pnpm,'install','--frozen-lockfile','--reporter=append-only'],runtime);
fs.symlinkSync(path.join(runtime,'node_modules'),path.join(stage,'node_modules'),'junction');

run(
  process.execPath,
  [path.join(__dirname, 'restore-links.cjs'), stage],
  release
);
run(
  process.execPath,
  [path.join(__dirname, 'smoke-trial.cjs'), stage],
  release
);
cp.execFileSync(process.execPath,[path.join(__dirname,'migration-preflight.cjs'),stage,release,path.join(path.dirname(live),'data')],{cwd:release,stdio:'inherit',timeout:180000});
const launcher=JSON.parse(fs.readFileSync(release+'/launcher.json','utf8'));
cp.execFileSync(launcher.oldExe,[path.join(__dirname,'migration-preflight.cjs'),live,release,path.join(path.dirname(live),'data'),'--rollback'],{cwd:release,stdio:'inherit',timeout:180000});
fs.rmSync(path.join(release,'migration-fixture'),{recursive:true,force:true});
requireSpace(path.dirname(live),2*bytes(path.join(path.dirname(live),'data'))+2*1024**3);
fs.writeFileSync(
  release + '/mini-preflight.json',
  JSON.stringify({
    buildId: receipt.buildId,
    verified: true,
    nativeNode: process.version,
    migrations: true,
    rollbackCompatible: true,
    runtime,
    manifestHash: crypto.createHash('sha256').update(fs.readFileSync(release+'/manifest.json','utf8').replace(/\r\n/g,'\n')).digest('hex'),
    inputHash,
    artifactHash: receipt.artifactHash,
    links: JSON.parse(fs.readFileSync(release + '/runtime-links.json')).length,
  })
);
for (const file of [input, release + '/compiled.tgz']) fs.unlinkSync(file);
// Discard transport copies only after Mini has verified and exercised the output.
ssh(
  'cmd /d /c "del /q ' +
    job.replaceAll('/', '\\') +
    '\\input.tar ' +
    job.replaceAll('/', '\\') +
    '\\compiled.tgz"'
);
