import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';
import * as stateFunctions from './letterboxdBrowserState';

function harness(overrides: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-browser-test-'));
  class User {}
  class LetterboxdAccount {}
  const account = { username: 'prplmg', enabled: true };
  const emails: unknown[] = [];
  let rejectEmail = false;
  const writes = {
    preparationFailures: [] as {id:string;userId:number;account:string;phase:string;state:'unknown'}[],
    intents: [] as {
      id: string;
      userId: number;
      account: string;
      state: string;
      desired?: unknown;
    }[],
  };
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, 'letterboxdBrowser.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }
  ).outputText;
  const api: any = {};
  new Function('require', 'exports', source)((name: string) => {
    if (name in overrides) return overrides[name];
    if (name === '@server/datasource')
      return {
        getRepository: (entity: unknown) => ({
          findOne: async () =>
            entity === User ? { email: 'admin@example.test' } : account,
        }),
      };
    if (name === '@server/entity/User') return { User };
    if (name === '@server/entity/MovieReview') return { LetterboxdAccount };
    if (name === '@server/lib/email')
      return class {
        async send(value: unknown) {
          if (rejectEmail) throw Error('SMTP unavailable');
          emails.push(value);
        }
      };
    if (name === '@server/lib/settings')
      return {
        getSettings: () => ({
          notifications: { agents: { email: { enabled: true } } },
        }),
      };
    if (name === '@server/logger') return {error:()=>{}};
    if (name === '@server/utils/appDataVolume')
      return { appDataPath: () => dir };
    if (name === './letterboxdBrowserState') return stateFunctions;
    if (name === './letterboxdExportPolicy')return {exportConflicts:async()=>[]};
    if (name === './letterboxdObservations')return {readObservations:()=>({requests:[]}),updateObservations:(fn: (s: {requests: never[]})=>unknown)=>fn({requests:[]}),maintainObservationHealth:()=>{}};
    if (name === './letterboxdWriteQueue')
      return { readWriteState: () => writes };
    return require(name);
  }, api);
  return {
    api,
    account,
    emails,
    writes,
    dir,
    failEmail: (value: boolean) => {
      rejectEmail = value;
    },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
const instance = '6e282ef9-86a2-4356-9387-16f99807e283';
it('late export validation cannot restage a completed job or turn success into failure', async () => {
  let validate!: () => void;
  const gate = new Promise<void>(r => { validate = r; });
  let staged = 0;
  const h = harness({
    './letterboxdExportSnapshot': { readExportSnapshot: () => gate },
    './letterboxdExportInbox': { stageExport: () => { staged++; } },
  });
  try {
    await h.api.bindLetterboxdBrowser(1, instance, true);
    const file = path.join(h.dir, 'letterboxd-browser.json');
    const state = h.api.readBrowserState();
    state.bindings[0].job = {id:'export',kind:'export',state:'running',created:1};
    fs.writeFileSync(file, JSON.stringify(state));
    const pending = h.api.browserExchange(instance, {id:'export',outcome:'succeeded',identity:'prplmg',complete:true,encoded:'archive',capturedAt:Date.now()}, true);
    await new Promise(r => setImmediate(r));
    const completed = h.api.readBrowserState();
    completed.bindings[0].job.state = 'succeeded';
    completed.bindings[0].lastCompletedJobId = 'export';
    fs.writeFileSync(file, JSON.stringify(completed));
    validate();
    assert.deepEqual(await pending, {action:'idle'});
    assert.equal(staged,0);
    assert.equal(h.api.readBrowserState().bindings[0].job.state,'succeeded');
  } finally { h.cleanup(); }
});
it('stale inbox callbacks cannot downgrade completed exports; running failures remain visible', async () => {
  let process!: (delivery: any) => Promise<void>;
  let fail!: (id: string, detail: string) => void;
  const h = harness({'./letterboxdExportInbox': {resumeExport: (_i: string,p: typeof process,f: typeof fail) => {process=p;fail=f;return true;}}});
  try {
    await h.api.bindLetterboxdBrowser(1,instance,true);
    const file=path.join(h.dir,'letterboxd-browser.json');
    const state=h.api.readBrowserState();
    state.bindings[0].job={id:'export',kind:'export',state:'running',created:1};
    fs.writeFileSync(file,JSON.stringify(state));
    await h.api.browserExchange(instance,undefined,true);
    const done=h.api.readBrowserState();
    done.bindings[0].job.state='succeeded';done.bindings[0].lastCompletedJobId='export';
    fs.writeFileSync(file,JSON.stringify(done));
    await process({id:'export',account:'prplmg',userId:1});
    fail('export','late failure');
    assert.equal(h.api.readBrowserState().bindings[0].issue,undefined);
    assert.equal(h.api.readBrowserState().bindings[0].job.state,'succeeded');
    done.bindings[0].job.state='running';delete done.bindings[0].lastCompletedJobId;
    fs.writeFileSync(file,JSON.stringify(done));
    fail('export','real failure');
    assert.equal(h.api.readBrowserState().bindings[0].job.state,'blocked');
    assert.equal(h.api.readBrowserState().bindings[0].job.reconciliationError,'real failure');
    done.bindings[0].job={id:'new-export',kind:'export',state:'running',created:2};
    fs.writeFileSync(file,JSON.stringify(done));
    fail('export','obsolete callback');
    assert.equal(h.api.readBrowserState().bindings[0].job.state,'running');
    assert.equal(h.api.readBrowserState().bindings[0].issue,undefined);
  } finally {h.cleanup();}
});
it('alerts admin for non-pilot failures before any write exists, retaining suppression and delivery retries',async()=>{
  const h=harness();
  try {
    h.account.username='evegrissel';
    await h.api.bindLetterboxdBrowser(7,instance,true);
    h.writes.preparationFailures.push({id:'preparation:7',userId:7,account:'evegrissel',phase:'review-admission',state:'unknown',firstFailedAt:Date.now()-1000000,attempts:3} as any);
    h.failEmail(true);await assert.rejects(h.api.monitorLetterboxdBrowsers());
    h.failEmail(false);await h.api.monitorLetterboxdBrowsers();await h.api.monitorLetterboxdBrowsers();
    assert.equal(h.emails.length,1);
    assert.match(JSON.stringify(h.emails),/evegrissel/);
    assert.match(JSON.stringify(h.emails),/background activity check has failed repeatedly/);
    assert.equal(h.writes.intents.length,0);
    h.writes.preparationFailures=[];
    await h.api.monitorLetterboxdBrowsers();
    assert.equal(h.api.readBrowserState().bindings[0].notifiedWriteIssue,undefined);
  } finally {h.cleanup();}
});
it('alerts once for write conflicts, retries failed delivery and never includes payloads', async () => {
  const h = harness();
  try {
    await h.api.bindLetterboxdBrowser(1, instance, true);
    h.writes.intents.push({
      id: 'job',
      userId: 1,
      account: 'prplmg',
      state: 'unknown',
      desired: { text: 'SECRET REVIEW' },
    });
    h.failEmail(true);
    await assert.rejects(h.api.monitorLetterboxdBrowsers());
    assert.equal(
      h.api.readBrowserState().bindings[0].lastWriteAlert,
      undefined
    );
    h.failEmail(false);
    await h.api.monitorLetterboxdBrowsers();
    await h.api.monitorLetterboxdBrowsers();
    assert.equal(h.emails.length, 1);
    assert.equal(JSON.stringify(h.emails).includes('SECRET REVIEW'), false);
    h.writes.intents[0].state = 'verified';
    await h.api.monitorLetterboxdBrowsers();
    assert.equal(
      h.api.readBrowserState().bindings[0].notifiedWriteIssue,
      undefined
    );
  } finally {
    h.cleanup();
  }
});
it('binds other linked accounts explicitly without inheriting the pilot identity', async () => {
  const h = harness();
  try {
    h.account.username = 'another';
    await h.api.bindLetterboxdBrowser(7, instance, true);
    const job = await h.api.browserExchange(instance, undefined);
    assert.equal(job.account, 'another');
    assert.equal(job.action, 'watchlist_scan');
    await assert.rejects(h.api.bindLetterboxdBrowser(8, instance, true));
  } finally {
    h.cleanup();
  }
});
it('stores only a scoped credential hash, rotates and revokes old credentials', () => {
  const h = harness();
  try {
    const a = h.api.rotateBrowserToken();
    assert.equal(h.api.browserTokenMatches(a), true);
    assert.equal(
      fs
        .readFileSync(path.join(h.dir, 'letterboxd-browser.json'), 'utf8')
        .includes(a),
      false
    );
    const b = h.api.rotateBrowserToken();
    assert.equal(h.api.browserTokenMatches(a), false);
    assert.equal(h.api.browserTokenMatches(b), true);
    assert.equal(h.api.browserTokenMatches(''), false);
  } finally {
    h.cleanup();
  }
});
it('deduplicates successful incident emails but retries failed email delivery', async () => {
  const h = harness();
  try {
    await h.api.bindLetterboxdBrowser(1, instance, true);
    const job = await h.api.browserExchange(instance, undefined);
    await h.api.browserExchange(instance, {
      id: job.id,
      outcome: 'blocked',
      challenge: true,
    });
    h.failEmail(true);
    await assert.rejects(h.api.monitorLetterboxdBrowsers());
    assert.equal(h.api.readBrowserState().bindings[0].notifiedIssue, undefined);
    h.failEmail(false);
    await h.api.monitorLetterboxdBrowsers();
    await h.api.monitorLetterboxdBrowsers();
    assert.equal(h.emails.length, 1);
    assert.equal(
      h.api.readBrowserState().bindings[0].notifiedIssue,
      'cloudflare'
    );
  } finally {
    h.cleanup();
  }
});
it('does not accept a result after the linked Letterboxd account changes', async () => {
  const h = harness();
  try {
    await h.api.bindLetterboxdBrowser(1, instance, true);
    const job = await h.api.browserExchange(instance, undefined);
    h.account.username = 'another-account';
    await assert.rejects(
      h.api.browserExchange(instance, {
        id: job.id,
        outcome: 'succeeded',
        identity: 'prplmg',
        complete: true,
        items: [],
      })
    );
    assert.equal(h.api.readBrowserState().bindings[0].snapshot, undefined);
  } finally {
    h.cleanup();
  }
});
it('retains bindings and jobs across module restart without issuing duplicate work', async () => {
  const h = harness();
  try {
    await h.api.bindLetterboxdBrowser(1, instance, true);
    const job = await h.api.browserExchange(instance, undefined);
    h.api.scheduleBrowserScans();
    assert.equal(h.api.readBrowserState().bindings[0].job.id, job.id);
    const report = {
      id: job.id,
      outcome: 'succeeded',
      identity: 'prplmg',
      complete: true,
      items: [{ slug: 'jaws', title: 'Jaws' }],
    };
    await h.api.browserExchange(instance, report);
    const saved = JSON.parse(
      fs.readFileSync(path.join(h.dir, 'letterboxd-browser.json'), 'utf8')
    );
    assert.equal(saved.bindings[0].snapshot.items[0].slug, 'jaws');
  } finally {
    h.cleanup();
  }
});
