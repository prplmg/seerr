import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';
import * as policy from './weeklyListsPolicy';
import type { WeeklyState } from './weeklyListsState';
/* eslint-disable @typescript-eslint/no-explicit-any */
function harness() {
  let now = Date.parse('2026-11-10T13:20:00Z'),
    grants = 0;
  const state: WeeklyState = { pages: {}, queue: [], seen: {}, retired: [] };
  const lists: any = { lists: [], saved: {}, liked: {} };
  const jobs: any[] = [];
  const api: any = {};
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, 'weeklyLists.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  ).outputText;
  new Function('require', 'exports', source)((name: string) => {
    if (name === './discoveryPopularLists') return { popularListUrls: [] };
    if (name === './weeklyListsPolicy') return policy;
    if (name === './weeklyListsState')
      return {
        readWeeklyLists: () => structuredClone(state),
        updateWeeklyLists: (f: any) => f(state),
        permitWeeklyLists: (t: number) => {
          grants = t;
        },
      };
    if (name === './discoveryLists')
      return {
        readListStore: () => structuredClone(lists),
        updateListStore: (f: any) => f(lists),
      };
    if (name === '@server/logger') return { info: () => {} };
    if (name === './discoveryBrowser')
      return {
        queueWeeklyBrowserList: (url: string, discovery: boolean) => {
          const id = String(jobs.length);
          jobs.push({ id, url, discovery, state: 'queued' });
          return id;
        },
        weeklyBrowserResult: (id: string) => jobs[Number(id)],
      };
    throw Error(name);
  }, api);
  return {
    state,
    lists,
    jobs,
    grant: () => grants,
    advance: (ms: number) => {
      now += ms;
    },
    tick: (busy = false) => api.runWeeklyLists(async () => busy, now),
  };
}
it('failed discovery does not retire anything; completed census applies 560 cap and protects saved/owned/liked lists', async () => {
  const h = harness(),
    old = Date.parse('2026-10-01T13:20:00Z');
  const url = (n: string) => `https://letterboxd.com/a/list/${n}/`;
  for (const id of ['old', 'saved', 'owned', 'liked']) {
    h.lists.lists.push({
      id,
      url: url(id),
      automatic: true,
      ownerId: id === 'owned' ? 1 : undefined,
    });
    h.state.seen[url(id)] = old;
  }
  h.lists.saved = { 1: ['saved'] };
  h.lists.liked = { 2: [url('liked')] };
  await h.tick(true);
  assert.equal(h.jobs.length, 0);
  assert.equal(h.grant(), 0);
  await h.tick();
  assert.equal(h.jobs.length, 1);
  h.jobs[0].state = 'blocked';
  await h.tick();
  await h.tick();
  assert.equal(h.lists.lists.length, 4);
  assert.equal(h.jobs.length, 1);
  h.advance(86400000);
  await h.tick();
  assert.equal(h.jobs.length, 2);
  for (let i = 0; i < 8; i++) {
    const job = h.jobs.at(-1);
    job.state = 'succeeded';
    job.rows = [
      { url: url('yes'), title: '560', total: 560 },
      { url: url('no'), title: '561', total: 561 },
    ];
    await h.tick();
  }
  assert.deepEqual(
    h.state.queue.map((q) => q.url),
    [url('yes')]
  );
  assert.deepEqual(
    h.lists.lists.map((l: any) => l.id),
    ['saved', 'owned', 'liked']
  );
  assert.equal(h.jobs.at(-1).url, url('yes'));
  h.advance(80 * 60000);
  await h.tick();
  assert.equal(h.grant(), 0);
});
it('an idle non-Tuesday does not initiate a weekly census', async () => {
  const h = harness();
  h.advance(86400000);
  await h.tick();
  assert.equal(h.jobs.length, 0);
});
