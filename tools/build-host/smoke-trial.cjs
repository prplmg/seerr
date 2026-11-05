const fs = require('node:fs'),
  path = require('node:path'),
  http = require('node:http'),
  assert = require('node:assert/strict'),
  { createRequire } = require('node:module');
const appDir = path.resolve(process.argv[2]),
  appRequire = createRequire(path.join(appDir, 'package.json'));
process.chdir(appDir);
process.env.NODE_ENV = 'production';
process.env.HOST = '127.0.0.1';
process.env.NEXT_TELEMETRY_DISABLED = '1';
(async () => {
  const id = fs.readFileSync('.next/BUILD_ID', 'utf8').trim();
  appRequire('reflect-metadata');
  const sqlite = appRequire('sqlite3');
  const db = await new Promise((res, rej) => {
    const d = new sqlite.Database(':memory:', (e) => (e ? rej(e) : res(d)));
  });
  const entities = appRequire('./dist/entity/ReviewInteraction.js');
  assert.ok(entities.ReviewComment && entities.RecentReaction);
  const migration = appRequire(
    './dist/migration/sqlite/1793900000000-RecentReactions.js'
  );
  assert.equal(typeof migration.RecentReactions1793900000000, 'function');
  const listParser = appRequire('./dist/lib/discoveryListPage.js');
  assert.equal(typeof listParser.parsePublicListPage, 'function');
  const emoji = appRequire('./dist/lib/reviewInteractions.js');
  assert.equal(emoji.canonicalReaction('👍'), '👍');
  await new Promise((res, rej) =>
    db.get('select sqlite_version() as v', (e, r) => (e ? rej(e) : res(r.v)))
  );
  await new Promise((res, rej) => db.close((e) => (e ? rej(e) : res())));
  const app = appRequire('next')({
    dev: false,
    dir: appDir,
    hostname: '127.0.0.1',
  });
  const handler = app.getRequestHandler();
  const srv = http.createServer((req, res) => {
    if (req.url === '/api/v1/settings/public') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(
        JSON.stringify({
          initialized: true,
          applicationTitle: 'Catalogue trial',
          locale: 'en',
          localLogin: true,
        })
      );
    }
    if (req.url.startsWith('/api/')) {
      res.writeHead(401);
      return res.end('{}');
    }
    handler(req, res);
  });
  await new Promise((res, rej) => {
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', res);
  });
  process.env.PORT = String(srv.address().port);
  try {
    await app.prepare();
    const base = 'http://127.0.0.1:' + process.env.PORT;
    const response = await fetch(base + '/login', {
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    });
    const body = await response.text();
    assert.equal(
      response.status,
      200,
      'Login page HTTP status ' + response.status
    );
    const embedded = body.match(
      /<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s
    );
    assert.ok(embedded, 'Rendered page has Next data');
    assert.equal(JSON.parse(embedded[1]).buildId, id);
    const assets = [
      ...body.matchAll(/<script[^>]* src="(\/_next\/static\/[^"]+)"/g),
    ].slice(0, 3);
    assert.ok(assets.length);
    for (const a of assets) {
      const r = await fetch(base + a[1]);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /javascript/);
      assert.ok((await r.arrayBuffer()).byteLength);
    }
    console.log(
      JSON.stringify({
        buildId: id,
        login: 200,
        jsChunks: assets.length,
        compiledServerAndSQLite: true,
        bind: 'loopback',
        settings: 'fixture',
      })
    );
  } finally {
    srv.closeAllConnections();
    await new Promise((res) => srv.close(res));
    await app.close();
  }
})()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
