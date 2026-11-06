const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  ts = require('typescript');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'list-cache-'));
const file = path.join(dir, 'discovery-lists.json');
fs.writeFileSync(file, 'one');
function load(file, mocks) {
  const exports = {};
  new Function(
    'require',
    'exports',
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText
  )((id) => (id in mocks ? mocks[id] : require(id)), exports);
  return exports;
}
const shared = load('server/lib/discoverySharedCache.ts', {});
let reads = 0,
  dbReads = 0,
  computes = 0;
const api = load('server/lib/mediaDiscoveryListsData.ts', {
  '@server/constants/media': { MediaStatus: { BLOCKLISTED: 5 } },
  '@server/utils/appDataVolume': { appDataPath: () => dir },
  './discoverySharedCache': shared,
  './discoveryDatabaseCache': {
    discoveryMedia: async () => {
      dbReads++;
      return [];
    },
  },
  './discoveryLists': {
    readListStore: () => {
      reads++;
      return { value: fs.readFileSync(file, 'utf8') };
    },
  },
  './mediaDiscoveryLists': {
    mediaDiscoveryLists: (s, u, f) => {
      computes++;
      return [{ id: s.value, user: u, media: f.tmdbId }];
    },
  },
});
(async () => {
  try {
    const f = { type: 'movie', tmdbId: 843 };
    const a = await Promise.all(
      Array.from({ length: 8 }, () => api.mediaDiscoveryListsData(1, f))
    );
    assert.equal(reads, 1);
    assert.equal(dbReads, 1);
    assert.equal(computes, 1);
    assert.deepEqual(a[0], a[7]);
    await api.mediaDiscoveryListsData(2, f);
    assert.equal(reads, 1);
    assert.equal(computes, 2);
    await api.mediaDiscoveryListsData(1, { type: 'tv', tmdbId: 843 });
    assert.equal(computes, 3);
    fs.writeFileSync(file + '.next', 'replacement');
    fs.renameSync(file + '.next', file);
    assert.equal(
      (await api.mediaDiscoveryListsData(1, f))[0].id,
      'replacement'
    );
    assert.equal(reads, 2);
    shared.invalidateDiscoveryCache();
    await api.mediaDiscoveryListsData(1, f);
    assert.equal(reads, 3);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 16000;
      await api.mediaDiscoveryListsData(1, f);
      assert.equal(reads, 4);
    } finally {
      Date.now = realNow;
    }
    console.log(
      'PASS: coalesced reads, viewer/type separation, atomic-file replacement and database revision invalidation and TTL expiry'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
