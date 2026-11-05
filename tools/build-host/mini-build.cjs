// Run under the shared Mini deployment lock, before taking Caddy's lease.
const fs = require('node:fs'),
  path = require('node:path'),
  cp = require('node:child_process'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict');
const [live, stage, release] = process.argv.slice(2),
  id = path.basename(release).replace(/-release$/, '');
assert.match(id, /^catalogue-\d+-\d+$/);
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
const input = release + '/build-input.tar';
ssh('cmd /d /c "mkdir ' + job.replaceAll('/', '\\') + '"');
fs.mkdirSync(stage);
run(
  'tar.exe',
  [
    '-cf',
    input,
    ...exclude,
    ...inputs.filter((f) => f !== 'bin'),
    'bin/prepare.mjs',
  ],
  live
);
run('tar.exe', ['-xf', input], stage);
for (const entry of JSON.parse(fs.readFileSync(release + '/manifest.json'))) {
  const dest = path.join(stage, entry.file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(release, 'source', entry.file), dest);
}
// The builder only gets our sanitized source snapshot and reviewed payload.
fs.writeFileSync(stage + '/.npmrc', 'engine-strict=true\n');
run('tar.exe', ['-cf', input, ...inputs, '.npmrc'], stage);
const inputHash = hash(input);
scp(input, host + ':' + job + '/input.tar');
ssh(
  builder +
    '/node/node.exe ' +
    builder +
    '/tools/pc-build.cjs ' +
    id +
    ' ' +
    inputHash
);
for (const name of ['receipt.json', 'runtime-links.json', 'compiled.tgz'])
  scp(host + ':' + job + '/' + name, release + '/' + name);
const receipt = JSON.parse(fs.readFileSync(release + '/receipt.json'));
assert.equal(receipt.release, id);
assert.equal(receipt.inputHash, inputHash);
assert.equal(receipt.artifactHash, hash(release + '/compiled.tgz'));
assert.equal(receipt.linksHash, hash(release + '/runtime-links.json'));
run('tar.exe', ['-xf', release + '/compiled.tgz'], stage);
assert.equal(
  fs.readFileSync(stage + '/.next/BUILD_ID', 'utf8').trim(),
  receipt.buildId
);
fs.symlinkSync(
  path.join(live, 'node_modules'),
  path.join(stage, 'node_modules'),
  'junction'
);
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
fs.writeFileSync(
  release + '/mini-preflight.json',
  JSON.stringify({
    buildId: receipt.buildId,
    verified: true,
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
