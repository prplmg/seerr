/* eslint-disable @typescript-eslint/no-explicit-any -- Execute the isolated route with dependency stubs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

function harness(configured: boolean, userId = 1, username = 'prplmg') {
  const handlers = new Map<string, any>();
  const settings = { [userId]: { enabled: false, account: username } };
  class Account {}
  class Export {}
  const baseline = {account:username,value:JSON.stringify({capturedAt:Date.now(),snapshot:{account:username,complete:true},holds:[]})};
  const binding = {userId,username,enabled:true,lastSuccess:Date.now(),lastSeen:Date.now()};
  const router = {
    use: () => {},
    get: () => {},
    post: () => {},
    put: (name: string, handler: any) => handlers.set(name, handler),
  };
  const exports = {};
  const code = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, 'letterboxdBrowser.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText;
  new Function('require', 'exports', code)((name: string) => {
    if (name.endsWith('/letterboxdHistoryHealth')) return {readHistoryHealth:()=>({attempts:0,nextAttemptAt:0})};
    if (name.endsWith('/letterboxdSyncHealth')) return {summarizeWorkerHealth:()=>({runtime:'unknown'})};
    if (name === 'express') return { Router: () => router };
    if (name.endsWith('/permissions')) return { Permission: { ADMIN: 1 } };
    if (name.endsWith('/auth')) return { isAuthenticated: () => () => {} };
    if (name.endsWith('/datasource'))
      return {
        getRepository: (entity: unknown) => ({
          findOneBy: async () => entity === Export ? baseline : ({ enabled: true, username }),
        }),
      };
    if (name.endsWith('/MovieReview')) return { LetterboxdAccount: Account };
    if (name.endsWith('/LetterboxdExport'))return {LetterboxdExportBaseline:Export};
    if (name.endsWith('/letterboxdBrowser'))
      return {
        readBrowserState: () => ({
          bindings: [
            binding,
          ],
        }),
      };
    if (name.endsWith('/letterboxdPlaybackConfig'))
      return {
        readPlaybackConfig: () => {
          if (!configured) throw Error('missing');
        },
      };
    if (name.endsWith('/letterboxdWriteQueue'))
      return {
        updateWriteState: (fn: any) => fn({ settings }),
        setWriteEnabled: (
          _state: unknown,
          _id: number,
          _account: string,
          enabled: boolean
        ) => {
          assert.equal(_id,userId);
          assert.equal(_account,username);
          settings[userId].enabled = enabled;
        },
      };
    throw Error(name);
  }, exports);
  let status = 200;
  let body: any;
  const res: any = {
    status: (value: number) => {
      status = value;
      return res;
    },
    json: (value: unknown) => {
      body = value;
    },
    sendStatus: (value: number) => {
      status = value;
    },
  };
  return {
    settings,
    baseline,
    binding,
    call: async (enabled: boolean) => {
      await handlers.get('/writes')({ body: { userId, enabled } }, res);
      return { status, body };
    },
  };
}
test('missing playback configuration rejects enable visibly and leaves writes disabled', async () => {
  const h = harness(false);
  const response = await h.call(true);
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'playback-configuration-required');
  assert.equal(h.settings[1].enabled, false);
});
test('other mapped accounts can enable only with current complete identity-matched baseline', async () => {
  const h=harness(true,7,'evegrissel');
  assert.equal((await h.call(true)).status,200);
  assert.equal(h.settings[7].enabled,true);
  for (const patch of [
    {account:'other',complete:true},
    {account:'evegrissel',complete:false},
  ]) {
    const bad=harness(true,7,'evegrissel');
    bad.baseline.value=JSON.stringify({capturedAt:Date.now(),snapshot:patch,holds:[]});
    assert.equal((await bad.call(true)).status,409);
    assert.equal(bad.settings[7].enabled,false);
  }
  const stale=harness(true,7,'evegrissel');stale.binding.lastSeen=1;
  assert.equal((await stale.call(true)).status,409);
});
test('explicit configuration permits enable and missing configuration never prevents disable', async () => {
  const h = harness(true);
  assert.equal((await h.call(true)).status, 200);
  assert.equal(h.settings[1].enabled, true);
  const missing = harness(false);
  missing.settings[1].enabled = true;
  assert.equal((await missing.call(false)).status, 200);
  assert.equal(missing.settings[1].enabled, false);
});
