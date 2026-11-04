const fs = require('fs'),
  path = require('path'),
  cp = require('child_process'),
  assert = require('node:assert/strict'),
  crypto = require('crypto');
const live = 'C:/ProgramData/Seerr/app',
  base = 'D:/SeerrBenchmarks/list-concurrency-20261104';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (p) =>
  crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const routes = [
  '/discover/movies?page=1',
  '/discovery-lists/feed?section=recommendations&offset=0',
  '/movie/329865',
  '/tv/87108',
];
async function worker() {
  const limit = Number(process.argv[3]),
    field = process.argv[4],
    idle = process.argv[6] === 'idle';
  assert([2, 4].includes(limit));
  process.chdir(base + '/app');
  process.env.NODE_ENV = 'production';
  process.env.CONFIG_DIRECTORY = base + '/work-data';
  const telemetry = [];
  for (const name of ['http', 'https']) {
    const mod = require('node:' + name),
      original = mod.request;
    mod.request = function (...args) {
      const options =
        args.find((x) => x && typeof x === 'object' && !(x instanceof URL)) ||
        {};
      const method = String(options.method || 'GET').toUpperCase();
      if (!['GET', 'HEAD'].includes(method))
        throw Error('Blocked outbound mutation');
      const started = performance.now();
      const req = original.apply(this, args);
      req.once('response', (res) => {
        let bytes = 0;
        res.on('data', (chunk) => (bytes += chunk.length));
        res.once('end', () =>
          telemetry.push({
            host: String(options.hostname || options.host || ''),
            status: res.statusCode,
            ms: performance.now() - started,
            bytes,
          })
        );
      });
      return req;
    };
  }
  const originalFetch = global.fetch;
  global.fetch = (input, options = {}) => {
    if (
      !['GET', 'HEAD'].includes(
        String(options.method || input?.method || 'GET').toUpperCase()
      )
    )
      throw Error('Blocked fetch mutation');
    return originalFetch(input, options);
  };
  const load = (n) => require(base + '/app/' + n);
  const db = load('dist/datasource').default;
  db.setOptions({ synchronize: false, migrationsRun: false, enableWAL: false });
  await db.initialize();
  await db.query('PRAGMA query_only=ON');
  const settings = load('dist/lib/settings').getSettings();
  await settings.load();
  load('dist/utils/restartFlag').default.initializeSettings(settings);
  load('dist/i18n').initI18n();
  const express = load('node_modules/express'),
    app = express();
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return res.sendStatus(405);
    req.headers['x-api-key'] = settings.main.apiKey;
    req.headers['x-api-user'] = '1';
    req.session = { userId: 1 };
    next();
  });
  app.use(
    load('node_modules/express-openapi-validator').middleware({
      apiSpec: base + '/app/seerr-api.yml',
      validateRequests: true,
    })
  );
  app.use('/api/v1', load('dist/routes').default);
  const listener = await new Promise((r) => {
    const l = app.listen(0, '127.0.0.1', () => r(l));
  });
  const url = 'http://127.0.0.1:' + listener.address().port + '/api/v1';
  const request = async (route) => {
    const s = performance.now();
    const r = await fetch(url + route, { signal: AbortSignal.timeout(45000) });
    await r.arrayBuffer();
    return { route, status: r.status, ms: performance.now() - s };
  };
  const warmup = [];
  if (!idle) for (const route of routes) warmup.push(await request(route));
  assert(
    warmup.every((x) => x.status === 200),
    'Route warmup failure: ' + JSON.stringify(warmup)
  );
  const baseline = [];
  if (!idle)
    for (let i = 0; i < 3; i++)
      for (const route of routes) baseline.push(await request(route));
  const { monitorEventLoopDelay } = require('node:perf_hooks');
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  const sorter = load('dist/lib/listSort');
  const items = JSON.parse(fs.readFileSync(base + '/items.json'));
  const beforeCpu = process.cpuUsage(),
    before = performance.now();
  let peakRss = process.memoryUsage().rss,
    finished = false;
  const samples = [];
  const traffic = (async () => {
    while (!idle && !finished) {
      for (const route of routes) {
        if (finished) break;
        samples.push(await request(route));
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
        await sleep(100);
      }
    }
  })();
  const first = sorter.sortedList(
    items,
    field === 'rating' ? 'rating-desc' : 'runtime-asc'
  );
  assert(first.updating, 'Expected cold list cache');
  while (
    sorter.listSortReadiness(
      items,
      field === 'rating' ? 'rating-desc' : 'runtime-asc'
    ).state !== 'ready'
  ) {
    assert(performance.now() - before < 150000, 'Metadata deadline exceeded');
    await sleep(20);
  }
  const elapsed = performance.now() - before;
  finished = true;
  await traffic;
  const cpu = process.cpuUsage(beforeCpu);
  lag.disable();
  const final = sorter.sortedList(
    items,
    field === 'rating' ? 'rating-desc' : 'runtime-asc'
  );
  const values = final.items.map((x) => ({
    id: x.tmdbId,
    value: x[field === 'rating' ? 'listRating' : 'listRuntime'],
  }));
  const warmStart = performance.now();
  for (let i = 0; i < 100; i++)
    sorter.sortedList(
      items,
      field === 'rating' ? 'rating-desc' : 'runtime-asc'
    );
  const warmSortMs = (performance.now() - warmStart) / 100;
  const result = {
    limit,
    field,
    browsing: !idle,
    titles: items.length,
    elapsedMs: elapsed,
    successful: values.filter((x) => x.value !== null).length,
    values,
    cpuMs: (cpu.user + cpu.system) / 1000,
    peakRssBytes: peakRss,
    eventLoopP95Ms: lag.percentile(95) / 1e6,
    warmSortMs,
    warmup,
    baseline,
    samples,
    upstream: telemetry.filter((x) => !x.host.includes('127.0.0.1')),
  };
  fs.writeFileSync(process.argv[5], JSON.stringify(result));
  listener.close();
  await db.destroy();
  process.exit(0);
}
async function main() {
  const idle = process.argv[2] === 'resume-idle',
    resume = idle || process.argv[2] === 'resume';
  if (!resume) {
    assert(!fs.existsSync(base), 'Benchmark workspace already exists');
    fs.mkdirSync(base + '/app', { recursive: true });
  }
  const build = fs.readFileSync(live + '/.next/BUILD_ID', 'utf8').trim();
  assert.equal(build, 'moKy4UU8ntkn_SPxP3ica');
  const originalHash = hash(live + '/dist/lib/listSort.js');
  if (!resume) {
    fs.cpSync(live + '/dist', base + '/app/dist', { recursive: true });
    fs.copyFileSync(live + '/seerr-api.yml', base + '/app/seerr-api.yml');
    fs.symlinkSync(
      live + '/node_modules',
      base + '/app/node_modules',
      'junction'
    );
    fs.mkdirSync(base + '/snapshot/db', { recursive: true });
    for (const name of fs.readdirSync('C:/ProgramData/Seerr/data'))
      if (name.endsWith('.json') && !/before|old|inbox|backup/.test(name))
        fs.copyFileSync(
          'C:/ProgramData/Seerr/data/' + name,
          base + '/snapshot/' + name
        );
    const {
      openSqlite,
    } = require('C:/ProgramData/Seerr/NativeTwoWayChecks.cjs');
    const db = await openSqlite(
      require(live + '/node_modules/sqlite3'),
      'C:/ProgramData/Seerr/data/db/db.sqlite3',
      true
    );
    try {
      await db.backup(base + '/snapshot/db/db.sqlite3');
    } finally {
      await db.close();
    }
    const metadata = JSON.parse(
      fs.readFileSync(base + '/snapshot/list-sort-metadata.json')
    );
    const items = Object.entries(metadata)
      .filter(([k, v]) => /^rating:movie:\d+$/.test(k) && v.value !== null)
      .map(([k]) => ({ type: 'movie', tmdbId: Number(k.split(':')[2]) }))
      .filter((x) => x.tmdbId !== 329865)
      .slice(0, 12);
    assert(items.length >= 8, 'Too few known rated titles');
    fs.writeFileSync(base + '/items.json', JSON.stringify(items));
  }
  const source = fs.readFileSync(live + '/dist/lib/listSort.js', 'utf8');
  assert(source.includes('active < 2 && queue.length'));
  const results = resume
    ? JSON.parse(fs.readFileSync(base + '/results.json')).results
    : [];
  for (const field of ['rating', 'runtime'])
    for (const limit of resume && !idle ? [4, 2, 2, 4] : [2, 4, 4, 2]) {
      fs.rmSync(base + '/work-data', { recursive: true, force: true });
      fs.cpSync(base + '/snapshot', base + '/work-data', { recursive: true });
      fs.rmSync(base + '/work-data/list-sort-metadata.json', { force: true });
      fs.writeFileSync(
        base + '/app/dist/lib/listSort.js',
        source.replace(
          'active < 2 && queue.length',
          'active < ' + limit + ' && queue.length'
        )
      );
      const output = base + '/trial-' + results.length + '.json',
        log = fs.openSync(base + '/trial-' + results.length + '.log', 'w');
      await new Promise((resolve, reject) => {
        const p = cp.spawn(
          process.execPath,
          [
            __filename,
            'worker',
            String(limit),
            field,
            output,
            idle ? 'idle' : 'browsing',
          ],
          { stdio: ['ignore', log, log] }
        );
        p.once('error', reject);
        p.once('close', (code) => {
          fs.closeSync(log);
          code === 0
            ? resolve()
            : reject(Error('Trial failed ' + results.length + ' exit ' + code));
        });
      });
      const r = JSON.parse(fs.readFileSync(output));
      results.push(r);
      console.log(
        JSON.stringify({
          trial: results.length,
          field,
          limit,
          browsing: !idle,
          elapsedMs: r.elapsedMs,
          successful: r.successful,
          titles: r.titles,
        })
      );
    }
  assert.equal(hash(live + '/dist/lib/listSort.js'), originalHash);
  assert.equal(fs.readFileSync(live + '/.next/BUILD_ID', 'utf8').trim(), build);
  fs.writeFileSync(
    base + '/results.json',
    JSON.stringify(
      {
        build,
        sourceHash: originalHash,
        order: resume ? [2, 4, 4, 2, 4, 2, 2, 4] : [2, 4, 4, 2],
        routes,
        results,
        productionSourceUnchanged: true,
      },
      null,
      2
    )
  );
  console.log('BENCHMARK_COMPLETE ' + base + '/results.json');
}
(process.argv[2] === 'worker' ? worker() : main()).catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
