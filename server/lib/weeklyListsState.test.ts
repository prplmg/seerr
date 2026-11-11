import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';
import type * as State from './weeklyListsState';
it('manual grants reject malformed, expired, future and overlong leases', () => {
  const api = {} as typeof State;
  let content = '{}';
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, 'weeklyListsState.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }
  ).outputText;
  new Function('require', 'exports', source)((name: string) => {
    if (name === 'fs') return { readFileSync: () => content };
    if (name === 'path') return path;
    if (name === 'crypto') return {};
    if (name === '@server/utils/appDataVolume')
      return { appDataPath: () => '/fixture' };
    throw Error(name);
  }, api);
  for (const grant of [
    {},
    { startedAt: 1000, until: 2000 },
    { startedAt: 3001, until: 4000 },
    { startedAt: 1000, until: 7201001 },
  ]) {
    content = JSON.stringify(grant);
    assert.equal(api.weeklyManualUntil(3000), 0);
  }
  content = 'broken';
  assert.equal(api.weeklyManualUntil(3000), 0);
  content = JSON.stringify({ startedAt: 1000, until: 5000 });
  assert.equal(api.weeklyManualUntil(3000), 5000);
});
