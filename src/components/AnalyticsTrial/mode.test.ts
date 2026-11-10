import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyticsOverrideKey, readAnalyticsMode } from './mode';

test('everyone defaults to replay; legacy random assignment is ignored', () => {
  const values = new Map([
    [
      'analytics-trial:42:normal-startup-v1',
      JSON.stringify({ variant: 'off' }),
    ],
  ]);
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: { getItem: (key: string) => values.get(key) ?? null },
  });
  assert.equal(readAnalyticsMode(42, false), 'replay');
  assert.equal(readAnalyticsMode(42, true), 'replay');
  for (const mode of ['off', 'events', 'replay']) {
    values.set(analyticsOverrideKey(42), mode);
    assert.equal(readAnalyticsMode(42, true), mode);
    assert.equal(readAnalyticsMode(42, false), 'replay');
    assert.equal(readAnalyticsMode(7, true), 'replay');
  }
  values.set(analyticsOverrideKey(42), 'invalid');
  assert.equal(readAnalyticsMode(42, true), 'replay');
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get: () => {
      throw Error('unavailable');
    },
  });
  assert.equal(readAnalyticsMode(42, true), 'replay');
  Reflect.deleteProperty(globalThis, 'sessionStorage');
});
