import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';
it('retries transient processing only, persists budgets, and retains validation failures with real diagnostics', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-retry-'));
  const logs: any[] = [];
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, 'letterboxdExportInbox.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }
  ).outputText;
  const load = () => {
    const api: any = {};
    new Function('require', 'exports', 'setTimeout', source)(
      (name: string) =>
        name === '@server/logger'
          ? {
              warn: (...args: any[]) => logs.push(args),
              error: (...args: any[]) => logs.push(args),
            }
          : name === '@server/utils/appDataVolume'
            ? { appDataPath: () => dir }
            : require(name),
      api,
      (fn: () => void) => setImmediate(fn)
    );
    return api;
  };
  const instance = '12345678-1234-1234-1234-123456789abc';
  const delivery = {
    id: 'job',
    userId: 1,
    account: 'test',
    capturedAt: 1,
    encoded: 'private',
  };
  const flush = async () => {
    for (let i = 0; i < 15; i++) await new Promise((r) => setImmediate(r));
  };
  try {
    const api = load();
    assert.equal(
      api.exportFailure({ code: 'SQLITE_BUSY', message: 'locked' }).transient,
      true
    );
    assert.equal(api.exportFailure({code:'ECONNABORTED',message:'timeout of 10000ms exceeded'}).transient,true);
    assert.equal(
      api.exportFailure({ response: { status: 503 }, message: 'unavailable' })
        .transient,
      true
    );
    assert.equal(
      api.exportFailure(new Error('Identity mismatch')).transient,
      false
    );
    assert(
      !api
        .exportFailure(new Error('token=secret https://private.example/a'))
        .message.includes('secret')
    );
    api.stageExport(instance, delivery);
    let calls = 0;
    api.resumeExport(
      instance,
      async () => {
        if (++calls < 3)
          throw Object.assign(new Error('locked'), { code: 'SQLITE_BUSY' });
      },
      () => assert.fail()
    );
    await flush();
    assert.equal(calls, 3);
    assert.equal(fs.readdirSync(dir).length, 0);
    api.stageExport(instance, delivery);
    let detail = '';
    api.resumeExport(
      instance,
      async () => {
        throw new Error('Identity mismatch');
      },
      (_id: string, message: string) => (detail = message)
    );
    await flush();
    assert.equal(detail, 'Identity mismatch');
    const file = path.join(dir, `letterboxd-export-inbox-${instance}.json`);
    assert(fs.existsSync(file));
    fs.writeFileSync(file + '.retry', '3');
    calls = 0;
    load().resumeExport(
      instance,
      async () => {
        calls++;
        throw Object.assign(new Error('locked'), { code: 'EBUSY' });
      },
      () => {}
    );
    await flush();
    assert.equal(calls, 1);
    load().resumeExport(
      instance,
      async () => {
        calls++;
      },
      () => {}
    );
    await flush();
    assert.equal(calls, 1);
    assert(logs.some((args) => args[1]?.message === 'Identity mismatch'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
it('durably acknowledges exports, coalesces polls and resumes after process restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-inbox-'));
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, 'letterboxdExportInbox.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }
  ).outputText;
  const load = () => {
    const api: any = {};
    new Function('require', 'exports', source)(
      (name: string) =>
        name === '@server/logger'
          ? { warn() {}, error() {} }
          : name === '@server/utils/appDataVolume'
            ? { appDataPath: () => dir }
            : require(name),
      api
    );
    return api;
  };
  const instance = '12345678-1234-1234-1234-123456789abc';
  const delivery = {
    id: 'job',
    userId: 1,
    account: 'prplmg',
    capturedAt: 1,
    encoded: 'private',
  };
  try {
    load().stageExport(instance, delivery);
    const restarted = load();
    let calls = 0,
      finish: () => void = () => {};
    const done = new Promise<void>((r) => (finish = r));
    const process = async () => {
      calls++;
      await done;
    };
    assert.equal(
      restarted.resumeExport(instance, process, () => assert.fail()),
      true
    );
    restarted.resumeExport(instance, process, () => assert.fail());
    restarted.stageExport(instance, delivery);
    assert.throws(() =>
      restarted.stageExport(instance, { ...delivery, id: 'other' })
    );
    await Promise.resolve();
    assert.equal(calls, 1);
    finish();
    await new Promise((r) => setImmediate(r));
    assert.equal(
      restarted.resumeExport(instance, process, () => assert.fail()),
      false
    );
    assert.equal(fs.readdirSync(dir).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
