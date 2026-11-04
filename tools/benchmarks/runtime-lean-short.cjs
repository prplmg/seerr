const fs = require('fs'),
  path = require('path'),
  cp = require('child_process'),
  assert = require('node:assert/strict'),
  crypto = require('crypto');
const live = 'C:/ProgramData/Seerr/app',
  base = 'D:/SeerrBenchmarks/runtime-lean-100-20261104';
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
  const variant = process.argv[7];
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
  const { shortWatchPage } = load('dist/lib/discoveryShort');
  const tmdb = new (load('dist/api/themoviedb').default)();
  const items = JSON.parse(fs.readFileSync(base + '/items.json')).filter(
    (x) => ![590530, 828247].includes(x.tmdbId)
  );
  const pages = [],
    before = performance.now();
  let offset = 0;
  do {
    const started = performance.now();
    const page = await shortWatchPage(
      items,
      offset,
      90,
      async (item) =>
        (variant === 'lean'
          ? await tmdb.getListMovie(item.tmdbId)
          : await tmdb.getMovie({ movieId: item.tmdbId })
        ).runtime,
      (item, listRuntime) => ({ ...item, listRuntime })
    );
    pages.push({ ms: performance.now() - started, ...page });
    offset = page.next;
  } while (offset !== null);
  lag.disable();
  const result = {
    variant,
    elapsedMs: performance.now() - before,
    titles: items.length,
    pages,
    upstream: telemetry.filter((x) => !x.host.includes('127.0.0.1')),
  };
  fs.writeFileSync(process.argv[5], JSON.stringify(result));
  listener.close();
  await db.destroy();
  process.exit(0);
}
async function main() {
  const results = [];
  for (const variant of [
    'full',
    'lean',
    'lean',
    'full',
    'lean',
    'full',
    'full',
    'lean',
  ]) {
    fs.rmSync(base + '/work-data', { recursive: true, force: true });
    fs.cpSync(base + '/snapshot', base + '/work-data', { recursive: true });
    const output = base + '/short-' + results.length + '.json';
    const log = fs.openSync(base + '/short-' + results.length + '.log', 'w');
    await new Promise((resolve, reject) => {
      const p = cp.spawn(
        process.execPath,
        [__filename, 'worker', '2', 'runtime', output, 'idle', variant],
        { stdio: ['ignore', log, log] }
      );
      p.once('error', reject);
      p.once('close', (code) => {
        fs.closeSync(log);
        code === 0 ? resolve() : reject(Error('Short trial failed ' + code));
      });
    });
    const r = JSON.parse(fs.readFileSync(output));
    results.push(r);
    fs.writeFileSync(
      base + '/short-results.json',
      JSON.stringify({ results }, null, 2)
    );
    assert(!r.upstream.some((x) => x.status === 429 || x.status === 403));
    console.log(
      JSON.stringify({
        trial: results.length,
        variant,
        elapsedMs: r.elapsedMs,
        firstPageMs: r.pages[0].ms,
        titles: r.titles,
      })
    );
  }
}
(process.argv[2] === 'worker' ? worker() : main()).catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
