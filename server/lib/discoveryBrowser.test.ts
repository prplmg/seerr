import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';
import { safeListUrl } from './discoveryListImport';
/* eslint-disable @typescript-eslint/no-explicit-any */
const requireRuntime = createRequire(__filename),
  url = 'https://letterboxd.com/alice/list/test/';
const snapshot = {
  anonymous: true,
  complete: true,
  total: 1,
  url,
  title: 'List',
  description: '',
  items: [
    {
      url: 'https://letterboxd.com/film/jaws/',
      title: 'Jaws',
      year: '1975',
      note: '',
    },
  ],
};
function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'list-browser-'));
  const tasks: (() => void)[] = [];
  let applied = 0,
    failures = 0;
  const saves: number[] = [];
  const load = () => {
    const api: any = {};
    const source = ts.transpileModule(
      fs.readFileSync(path.join(__dirname, 'discoveryBrowser.ts'), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      }
    ).outputText;
    new Function('require', 'exports', 'setImmediate', source)(
      (name: string) => {
        if (name === '@server/logger') return { warn: () => {} };
        if (name === '@server/utils/appDataVolume')
          return { appDataPath: () => dir };
        if (name === './letterboxdBrowser')
          return {
            readBrowserState: () => ({
              bindings: [
                { instance: 'one', enabled: true, username: 'alice' },
                { instance: 'two', enabled: true, username: 'bob' },
                { instance: 'three', enabled: true, username: 'carol' },
              ],
            }),
          };
        if (name === './discoveryListImport')
          return {
            safeListUrl,
            importPublicList: async () => 'direct-list',
            applyPublicList: async () => {
              applied++;
              if (failures-- > 0) throw Error('Temporary lookup timeout');
              return 'saved-list';
            },
          };
        if (name === './discoveryLists')
          return {
            updateListStore: (f: any) => f({}),
            setListSaved: (_: any, user: number) => saves.push(user),
          };
        return requireRuntime(name);
      },
      api,
      (fn: () => void) => tasks.push(fn)
    );
    return api;
  };
  return {
    load,
    saves,
    tasks,
    applied: () => applied,
    fail: (count: number) => {
      failures = count;
    },
    dir,
    close: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
it('durable anonymous list job resumes after restart, deduplicates deliveries and saves only subscribers', async () => {
  const h = harness();
  try {
    let api = h.load();
    const id = api.queueBrowserList(url, 1);
    assert.equal(api.queueBrowserList(url, 2), id);
    assert.equal(api.browserListStatus(id, 3), undefined);
    assert.equal(api.pendingBrowserList('one').pending, true);
    assert.equal(api.pendingBrowserList('two').pending, true);
    const job = api.exchangeBrowserLists('one', undefined, true);
    assert.equal(job.id, id);
    assert.throws(() =>
      api.exchangeBrowserLists('two', {
        id,
        token: job.token,
        outcome: 'succeeded',
        snapshot,
      })
    );
    api = h.load();
    api.exchangeBrowserLists('one', {
      id,
      token: job.token,
      outcome: 'succeeded',
      snapshot,
    });
    api.exchangeBrowserLists('one', {
      id,
      token: job.token,
      outcome: 'succeeded',
      snapshot,
    });
    for (const fn of h.tasks) fn();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.applied(), 1);
    assert.deepEqual(h.saves, [1, 2]);
    assert.equal(api.browserListStatus(id, 1).state, 'succeeded');
  } finally {
    h.close();
  }
});
it('requires signed-out complete identity-matched snapshots and rejects duplicates or unsafe URLs', () => {
  const h = harness();
  try {
    const api = h.load();
    api.validateBrowserList({
      ...snapshot,
      items: [
        {
          ...snapshot.items[0],
          url: 'https://letterboxd.com/film/film:649162/',
        },
      ],
    });
    for (const suffix of ['film:0', 'film:abc', 'film:42/other'])
      assert.throws(() =>
        api.validateBrowserList({
          ...snapshot,
          items: [
            {
              ...snapshot.items[0],
              url: `https://letterboxd.com/film/${suffix}/`,
            },
          ],
        })
      );
    for (const bad of [
      { ...snapshot, anonymous: false },
      { ...snapshot, total: 2 },
      { ...snapshot, items: [snapshot.items[0], snapshot.items[0]], total: 2 },
      { ...snapshot, url: 'https://localhost/' },
    ])
      assert.throws(() => api.validateBrowserList(bad));
    const id = api.queueBrowserList(url, 1),
      job = api.exchangeBrowserLists('one', undefined, true);
    assert.throws(() =>
      api.exchangeBrowserLists('one', {
        id,
        token: job.token,
        outcome: 'succeeded',
        snapshot: {
          ...snapshot,
          url: 'https://letterboxd.com/alice/list/other/',
        },
      })
    );
    api.exchangeBrowserLists('one', {
      id,
      token: job.token,
      outcome: 'blocked',
      error: 'incognito-access-required',
    });
    assert.match(api.browserListStatus(id, 1).error, /InPrivate/);
    assert.notEqual(api.queueBrowserList(url, 1), id);
  } finally {
    h.close();
  }
});
it('requires permission, spreads work across eligible profiles and caps concurrent scans', () => {
  const h = harness();
  try {
    const api = h.load();
    for (const suffix of ['one', 'two', 'three'])
      api.queueBrowserList(`https://letterboxd.com/alice/list/${suffix}/`, 1);
    assert.equal(api.exchangeBrowserLists('one').action, 'idle');
    assert.equal(
      api.exchangeBrowserLists('one', undefined, false).action,
      'idle'
    );
    const first = api.exchangeBrowserLists('one', undefined, true);
    const second = api.exchangeBrowserLists('two', undefined, true);
    assert.notEqual(first.id, second.id);
    assert.equal(
      api.exchangeBrowserLists('three', undefined, true).action,
      'idle'
    );
    assert.equal(api.exchangeBrowserLists('one', undefined, true).id, first.id);
    assert.equal(
      api.exchangeBrowserLists(
        'one',
        { id: first.id, token: first.token, outcome: 'blocked' },
        false
      ).action,
      'idle'
    );
    assert.equal(
      api.exchangeBrowserLists('three', undefined, true).action,
      'list_scan'
    );
  } finally {
    h.close();
  }
});
it('unclaimed jobs time out visibly rather than remain queued forever', () => {
  const h = harness();
  try {
    const api = h.load(),
      id = api.queueBrowserList(url, 1),
      file = path.join(h.dir, 'discovery-browser.json');
    const jobs = JSON.parse(fs.readFileSync(file, 'utf8'));
    jobs[0].created = 0;
    fs.writeFileSync(file, JSON.stringify(jobs));
    assert.equal(api.browserListStatus(id, 1).state, 'blocked');
  } finally {
    h.close();
  }
});

it('distinguishes a retired job from a wrong token or account', () => {
  const h = harness();
  try {
    const api = h.load();
    assert.throws(
      () =>
        api.exchangeBrowserLists(
          'one',
          {
            id: '96d630fc-4488-45a9-ac56-13d0621ceb81',
            token: 'old',
            outcome: 'succeeded',
          },
          true
        ),
      (e: any) => e.code === 'list-job-retired'
    );
    api.queueBrowserList(url, 1);
    const job = api.exchangeBrowserLists('one', undefined, true);
    assert.throws(
      () =>
        api.exchangeBrowserLists(
          'one',
          { id: job.id, token: 'wrong', outcome: 'succeeded' },
          true
        ),
      (e: any) => e.message === 'Wrong list delivery' && !e.code
    );
  } finally {
    h.close();
  }
});

it('direct import replies as a durable job, survives restart and deduplicates subscribers', async () => {
  const h = harness();
  try {
    let api = h.load();
    const id = api.queueBrowserList(url, 1, true);
    assert.equal(api.queueBrowserList(url, 2, true), id);
    assert.equal(api.browserListStatus(id, 1).state, 'fetching');
    assert.deepEqual(h.saves, []);
    h.tasks.length = 0;
    api = h.load();
    api.browserListStatus(id, 1);
    for (const task of h.tasks.splice(0)) task();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(api.browserListStatus(id, 1).state, 'succeeded');
    assert.deepEqual(h.saves, [1, 2]);
  } finally {
    h.close();
  }
});
it('metadata retry preserves verified snapshot and stops after three failures', async () => {
  const h = harness();
  try {
    const api = h.load(),
      id = api.queueBrowserList(url, 1);
    const job = api.exchangeBrowserLists('one', undefined, true);
    h.fail(3);
    api.exchangeBrowserLists(
      'one',
      { id, token: job.token, outcome: 'succeeded', snapshot },
      true
    );
    for (let attempt = 1; attempt <= 3; attempt++) {
      for (const task of h.tasks.splice(0)) task();
      await new Promise((r) => setTimeout(r, 10));
      const filename = path.join(h.dir, 'discovery-browser.json');
      const rows = JSON.parse(fs.readFileSync(filename, 'utf8'));
      assert.ok(rows[0].snapshot);
      assert.equal(rows[0].attempts, attempt);
      assert.equal(rows[0].state, attempt < 3 ? 'received' : 'blocked');
      rows[0].retryAt = 0;
      fs.writeFileSync(filename, JSON.stringify(rows));
      api.browserListStatus(id, 1);
    }
    assert.deepEqual(h.saves, []);
  } finally {
    h.close();
  }
});
