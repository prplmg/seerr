import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import type { CompletedPlaybackEvent as PlaybackEvent } from './letterboxdPartyPlaybackEvents';
import {
  planPendingPlaybackPublications,
  type PlaybackObservation,
} from './letterboxdPlaybackPublishing';
import type { SyncReceipt } from './letterboxdSyncReceipts';
import * as queue from './letterboxdWriteQueue';

function harness(userId = 1, accountName = 'prplmg') {
  const events: PlaybackEvent[] = [1, 2, 3].map((n) => ({
    id: `tautulli:${String(n).repeat(64)}`,
    source: 'tautulli',
    userId,
    account: accountName,
    tmdbId: n,
    occurredAt: Date.parse('2026-10-18T12:00:00Z'),
    watchedDate: '2026-10-18',
    timezone: 'UTC',
    rowId: String(n),
    referenceId: String(n),
  }));
  const now = Date.parse('2026-10-18T13:00:00Z');
  const state = queue.emptyWriteState();
  state.settings[userId] = { enabled: true, account: accountName, enabledSince: 1 };
  const receipts: SyncReceipt[] = [];
  const configuration = {
    sourceId: 'server',
    timezone: 'UTC',
    linked: true,
    allowed: true,
  };
  const files = new Map<string, string>();
  const calls: string[] = [];
  let ready = false;
  let readyFirst = false;
  let afterObserve = () => {};
  const provider = async (
    event: PlaybackEvent
  ): Promise<PlaybackObservation | null> => {
    calls.push(event.id);
    afterObserve();
    return ready || (readyFirst && event.tmdbId === 1)
      ? {
          eventId: event.id,
          userId,
          account: accountName,
          film: `film-${event.tmdbId}`,
          tmdbId: event.tmdbId,
          observedAt: now,
          watched: false,
          eventMatch: 'absent',
          verified: true,
        }
      : null;
  };
  const deps: Record<string, unknown> = {
    '@server/utils/appDataVolume': { appDataPath: () => '/mock' },
    crypto: { randomUUID: () => 'temp' },
    path,
    fs: {
      readFileSync: (file: string) => {
        if (file.endsWith('social.json'))
          return JSON.stringify({ letterboxdPlayback: configuration });
        if (!files.has(file)) throw Object.assign(Error(), { code: 'ENOENT' });
        return files.get(file);
      },
      writeFileSync: (file: string, value: string) => files.set(file, value),
      renameSync: (from: string, to: string) => {
        files.set(to, files.get(from)!);
        files.delete(from);
      },
      existsSync: (file: string) => files.has(file),
      unlinkSync: (file: string) => files.delete(file),
    },
    './letterboxdPlaybackObservations': {
      observeLetterboxdPlaybackEvent: provider,
    },
    './letterboxdPlaybackPublishing': {
      prepareLetterboxdPlaybackPublications: async (observe: typeof provider, _userId?: number, lastAttempt?: Record<string,number>) =>
        planPendingPlaybackPublications({
          userId,
          lastAttempt,
          events: () => events,
          config: async () => ({ ...configuration }),
          state: () => state,
          receipts: () => receipts,
          observe,
          now: () => now,
          update: (fn) => fn(state),
        }),
    },
    './letterboxdSyncReceipts': { readSyncReceipts: () => receipts },
    './letterboxdWriteQueue': { ...queue, readWriteState: () => state, updateWriteState: (fn: (s: typeof state)=>unknown) => fn(state) },
  };
  const load = () => {
    const exports = {} as {
      prepareLetterboxdPlaybackPublications: () => Promise<unknown>;
      continueLetterboxdPlaybackPublications: () => Promise<void>;
    };
    vm.runInNewContext(
      ts.transpileModule(
        fs.readFileSync(
          path.join(__dirname, 'letterboxdPlaybackContinuation.ts'),
          'utf8'
        ),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
          },
        }
      ).outputText,
      {
        exports,
        require: (name: string) => {
          if (!(name in deps)) throw Error(name);
          return deps[name];
        },
      }
    );
    return exports;
  };
  return {
    ...load(),
    load,
    events,
    files,
    state,
    receipts,
    configuration,
    calls,
    ready: () => {
      ready = true;
    },
    readyFirst: () => {
      readyFirst = true;
    },
    afterObserve: (fn: () => void) => {
      afterObserve = fn;
    },
  };
}
it('non-pilot playback survives restart without sharing the pilot batch or creating duplicate diaries',async()=>{
  const h=harness(7,'evegrissel');
  await h.prepareLetterboxdPlaybackPublications();
  assert.ok(h.files.has('/mock/letterboxd-playback-continuation-7.json'));
  assert.equal(h.files.has('/mock/letterboxd-playback-continuation.json'),false);
  h.ready();
  await h.load().continueLetterboxdPlaybackPublications();
  assert.ok(h.state.intents.length>0);
  assert.ok(h.state.intents.every(i=>i.userId===7&&i.account==='evegrissel'));
  const count=h.state.intents.length;
  await h.load().continueLetterboxdPlaybackPublications();
  assert.equal(h.state.intents.length,count);
});

it('playback continuation persists only scheduled event IDs and never observes later events', async () => {
  const h = harness();
  await h.prepareLetterboxdPlaybackPublications();
  assert.equal(h.state.intents.length, 0);
  h.calls.length = 0;
  h.events.push({
    ...h.events[0],
    id: `tautulli:${'4'.repeat(64)}`,
    tmdbId: 4,
  });
  h.ready();
  await h.load().continueLetterboxdPlaybackPublications();
  assert.equal(h.state.intents.length, 2);
  assert.deepEqual(
    h.calls,
    h.events.slice(0, 2).map((e) => e.id)
  );
  await h.continueLetterboxdPlaybackPublications();
  assert.equal(h.state.intents.length, 2);
});
it('playback directly queued work consumes the same scheduled batch budget', async () => {
  const h = harness();
  h.readyFirst();
  await h.prepareLetterboxdPlaybackPublications();
  assert.equal(h.state.intents.length, 1);
  h.ready();
  await h.continueLetterboxdPlaybackPublications();
  assert.equal(h.state.intents.length, 2);
  assert.equal(h.state.intents[1].originEntityId, h.events[1].id);
});
it('playback rejects changed event snapshots, opt-outs, remappings and enable cycles', async () => {
  for (const change of [
    (h: ReturnType<typeof harness>) => {
      h.events.forEach((e) => {
        e.tmdbId += 10;
      });
    },
    (h: ReturnType<typeof harness>) => {
      h.configuration.allowed = false;
    },
    (h: ReturnType<typeof harness>) => {
      h.configuration.linked = false;
    },
    (h: ReturnType<typeof harness>) => {
      h.configuration.sourceId = 'other';
    },
    (h: ReturnType<typeof harness>) => {
      h.state.settings[1].enabledSince = 2;
    },
    (h: ReturnType<typeof harness>) => {
      h.afterObserve(() => {
        h.configuration.sourceId = 'other';
      });
    },
  ]) {
    const h = harness();
    await h.prepareLetterboxdPlaybackPublications();
    h.ready();
    change(h);
    await h.continueLetterboxdPlaybackPublications();
    assert.equal(h.state.intents.length, 0);
  }
});
it('receipt and uncertain intent replay never recreate a playback event', async () => {
  const h = harness();
  await h.prepareLetterboxdPlaybackPublications();
  h.ready();
  h.receipts.push({
    userId: 1,
    account: 'prplmg',
    originId: h.events[0].id,
    entryId: 'https://letterboxd.com/prplmg/film/film-1/',
  });
  await h.continueLetterboxdPlaybackPublications();
  assert.equal(h.state.intents.length, 1);
  h.state.intents[0].state = 'unknown';
  await h.continueLetterboxdPlaybackPublications();
  assert.equal(h.state.intents.length, 1);
});

it('a stalled legacy batch leaves a slot for a later watch without falsely completing the old event', async () => {
 const h=harness();
 await h.prepareLetterboxdPlaybackPublications();
 const file='/mock/letterboxd-playback-continuation.json';
 const old=JSON.parse(h.files.get(file)!);delete old.admittedAt;
 h.files.set(file,JSON.stringify(old));h.calls.length=0;
 await h.load().prepareLetterboxdPlaybackPublications();
 assert.deepEqual(h.calls,[h.events[2].id]);
 const batch=JSON.parse(h.files.get(file)!);
 assert.deepEqual(batch.events.map((e:PlaybackEvent)=>e.id),[h.events[2].id]);
 assert.equal(h.events.length,3);assert.equal(h.receipts.length,0);
 assert.equal(h.state.intents.length,0);
 h.ready();await h.load().continueLetterboxdPlaybackPublications();
 assert.equal(h.state.intents.length,1);
 assert.equal(h.state.intents[0].originEntityId,h.events[2].id);
});

it('expires a current stalled lease after restart and respects its persisted cooldown',async()=>{
 const h=harness();await h.prepareLetterboxdPlaybackPublications();
 const file='/mock/letterboxd-playback-continuation.json';
 const batch=JSON.parse(h.files.get(file)!);batch.admittedAt=Date.now()-16*60*1000;
 h.files.set(file,JSON.stringify(batch));h.calls.length=0;
 await h.load().prepareLetterboxdPlaybackPublications();
 assert.deepEqual(h.calls,[h.events[2].id]);h.calls.length=0;
 await h.load().prepareLetterboxdPlaybackPublications();
 assert.deepEqual(h.calls,[]);
 assert.equal(h.state.intents.length,0);
});
it('fills one free slot without observing a third unadmitted event',async()=>{
 const h=harness();await h.prepareLetterboxdPlaybackPublications();
 const file='/mock/letterboxd-playback-continuation.json';
 const batch=JSON.parse(h.files.get(file)!);batch.events=batch.events.slice(0,1);
 h.files.set(file,JSON.stringify(batch));h.calls.length=0;
 await h.load().prepareLetterboxdPlaybackPublications();
 assert.deepEqual(h.calls,[h.events[2].id]);
 assert.equal(JSON.parse(h.files.get(file)!).events.length,2);
});

it('admits all six stalled events before revisiting older attempts across restarts', async () => {
 const h=harness();
 for(let n=4;n<=6;n++) h.events.push({...h.events[0],id:`tautulli:${String(n).repeat(64)}`,tmdbId:n});
 const file='/mock/letterboxd-playback-continuation.json';
 for(let round=0;round<3;round++) {
   if(round) {const b=JSON.parse(h.files.get(file)!);b.admittedAt=Date.now()-16*60*1000;b.deferredUntil={};h.files.set(file,JSON.stringify(b));}
   await h.load().prepareLetterboxdPlaybackPublications();
 }
 assert.deepEqual(h.calls,h.events.map(e=>e.id));
 assert.equal(h.state.intents.length,0);
});
