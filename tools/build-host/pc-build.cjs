// Windows-native builder. This host receives application source only.
const fs = require('node:fs'),
  path = require('node:path'),
  cp = require('node:child_process'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict');
const home = 'D:/CatalogueBuilder',
  work = home + '/work',
  id = process.argv[2],
  inputHash = process.argv[3];
assert.match(id, /^catalogue-\d+-\d+$/);
assert.match(inputHash, /^[0-9a-f]{64}$/);
const job = home + '/jobs/' + id,
  input = job + '/input.tar',
  out = job + '/compiled.tgz';
const hash = (f) =>
  crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function run(cmd, args) {
  cp.execFileSync(cmd, args, { cwd: work, stdio: 'inherit' });
}
assert.equal(hash(input), inputHash, 'Input digest mismatch');
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(home + '/active.lock');
try {
  for (const name of fs.readdirSync(work))
    if (name !== 'node_modules')
      fs.rmSync(path.join(work, name), {
        recursive: true,
        force: true,
        maxRetries: 3,
      });
  run('tar.exe', ['-xf', input]);
  const pkg = JSON.parse(fs.readFileSync(work + '/package.json'));
  const next=String(pkg.dependencies?.next).match(/^(\d+)\.(\d+)\.(\d+)$/);
  assert.ok(next && (+next[1]>16 || (+next[1]===16 && (+next[2]>4 || (+next[2]===4 && +next[3]>=2)))), 'Pin Next >=16.4.2');
  assert.equal(pkg.packageManager, 'pnpm@10.24.0');
  require('./runtime-policy.cjs').checkNode(process.execPath);
  assert.equal(process.version, 'v22.23.5');
  assert.equal(process.arch, 'x64');
  assert.equal(process.platform, 'win32');
  process.env.PATH = home + '/pinned;' + path.dirname(process.execPath) + ';' + process.env.PATH;
  Object.assign(process.env, {
    HUSKY: '0',
    CI: 'true',
    CYPRESS_INSTALL_BINARY: '0',
    NEXT_TELEMETRY_DISABLED: '1',
    npm_config_cache: home + '/npm-cache',
  });
  const pnpm = home + '/pinned/node_modules/pnpm/bin/pnpm.cjs';
  assert.equal(
    cp
      .execFileSync(process.execPath, [pnpm, '--version'], {
        cwd: work,
        encoding: 'utf8',
      })
      .trim(),
    '10.24.0'
  );
  const start = Date.now();
  run(process.execPath, [
    pnpm,
    'install',
    '--frozen-lockfile',
    '--store-dir',
    home + '/pnpm-store',
    '--reporter=append-only',
  ]);
  const installed = Date.now();
  run(process.execPath, [pnpm, 'build']);
  const built = Date.now();
  run(process.execPath, [path.join(__dirname,'export-links.cjs')]);
  fs.copyFileSync(home + '/runtime-links.json', job + '/runtime-links.json');
  run('tar.exe', [
    '-czf',
    out,
    '--exclude',
    '.next/node_modules',
    '--exclude',
    '.next/cache',
    '--exclude',
    '.next/trace*',
    '.next',
    'dist',
  ]);
  run('tar.exe',['-czf',job+'/pnpm.tgz','-C',fs.realpathSync(home+'/pinned/node_modules/pnpm'),'.']);
  const receipt = {
    pnpmHash: hash(job+'/pnpm.tgz'),
    dependencyBytes: require('./storage.cjs').bytes(work+'/node_modules'),
    artifactExpandedBytes: require('./storage.cjs').bytes(work+'/.next')+require('./storage.cjs').bytes(work+'/dist'),
    builder: require('node:os').hostname(),
    release: id,
    inputHash,
    artifactHash: hash(out),
    linksHash: hash(job + '/runtime-links.json'),
    buildId: fs.readFileSync(work + '/.next/BUILD_ID', 'utf8').trim(),
    bytes: fs.statSync(out).size,
    node: process.version,
    pnpm: '10.24.0',
    installSeconds: (installed - start) / 1000,
    buildSeconds: (built - installed) / 1000,
  };
  fs.writeFileSync(job + '/receipt.json', JSON.stringify(receipt));
  console.log(receipt);
} finally {
  fs.rmdirSync(home + '/active.lock');
}
