import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  parseWorkerHealth,
  summarizeWorkerHealth,
} from './letterboxdSyncHealth';
it('distinguishes missing, stale, paused and ready runtime state without changing settings', () => {
  const now = 1000000;
  const report = {
    paused: true,
    pauseReason: 'read-check',
    supportedWriteKinds: ['rating', 'review'],
    errors: [
      { stage: 'lists', at: now - 100, type: 'HTTPError', httpStatus: 409 },
    ],
  };
  const health = parseWorkerHealth(report, now)!;
  const intents = [{ state: 'queued', kind: 'watched', created: now - 5000 }];
  assert.equal(
    summarizeWorkerHealth(undefined, intents, now).runtime,
    'unknown'
  );
  assert.equal(summarizeWorkerHealth(health, intents, now).runtime, 'paused');
  assert.equal(
    summarizeWorkerHealth(health, intents, now).unsupportedQueued,
    1
  );
  assert.equal(
    summarizeWorkerHealth(health, intents, now).recentErrors.length,
    1
  );
  assert.equal(
    summarizeWorkerHealth({ ...health, paused: false }, intents, now).runtime,
    'ready'
  );
  assert.equal(
    summarizeWorkerHealth(health, intents, now + 600001).runtime,
    'stale'
  );
  assert.equal(
    summarizeWorkerHealth(health, intents, now + 600001).unsupportedQueued,
    null
  );
  assert.equal(report.paused, true);
  assert.equal(
    parseWorkerHealth(
      {
        ...report,
        errors: [{ stage: 'lists', at: now + 120000, type: 'HTTPError' }],
      },
      now
    )!.errors[0].at,
    now
  );
});
it('rejects malformed health and exposes no arbitrary error payload', () => {
  assert.equal(parseWorkerHealth(undefined), undefined);
  for (const value of [
    null,
    {},
    { paused: 'yes' },
    {
      paused: true,
      pauseReason: 'manual',
      supportedWriteKinds: [],
      errors: [{ stage: 'lists', at: Date.now(), type: 'private message' }],
    },
  ])
    assert.throws(() => parseWorkerHealth(value));
  const v = parseWorkerHealth({
    paused: false,
    pauseReason: 'none',
    supportedWriteKinds: [],
    errors: [],
    secret: 'not exposed',
  })!;
  assert(!('secret' in v));
});
