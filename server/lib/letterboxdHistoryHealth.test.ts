import assert from 'node:assert/strict';
import { it } from 'node:test';
import { historyNeedsAlert, historyResult } from './letterboxdHistoryHealth';
it('one shared incident backs off, reports safe causes, alerts once and resets on success', () => {
  let state = historyResult(
    { attempts: 0, nextAttemptAt: 0 },
    { code: 'ECONNABORTED', message: 'apikey=secret' },
    'history-fetch',
    1000
  );
  assert.equal(state.nextAttemptAt, 61000);
  assert(!JSON.stringify(state).includes('secret'));
  state = historyResult(state, new Error('private'), 'history-fetch', 301000);
  state = historyResult(
    state,
    { response: { status: 503 } },
    'history-fetch',
    901000
  );
  assert(historyNeedsAlert(state, 901000));
  assert(!historyNeedsAlert({ ...state, notified: true }, 901000));
  assert.equal(state.error?.status, 503);
  assert.equal(state.nextAttemptAt, 1141000);
  const ready = historyResult(state, undefined, 'history-fetch', 902000);
  assert.equal(ready.attempts, 0);
  assert(!ready.firstFailedAt);
  assert(!ready.notified);
});
