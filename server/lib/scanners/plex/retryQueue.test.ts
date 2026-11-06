import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import {
  PlexRetryQueue,
  RETRY_CAPACITY,
  RETRY_LIMIT,
  plexRetryKey,
} from './retryQueue';
const library = {
  id: '1',
  name: 'Movies',
  enabled: true,
  type: 'movie' as const,
};
const entry = { server: 'server', libraryId: '1', ratingKey: '10' };
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plex-retry-'));
  const file = path.join(dir, 'queue.json');
  return {
    file,
    queue: new PlexRetryQueue(file),
    close: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
it('persists backoff, one refresh per incident, capped repair state and successful removal across restarts', () => {
  const f = fixture();
  try {
    f.queue.fail(entry, 0, true);
    let q = new PlexRetryQueue(f.file);
    assert.equal(q.due('server', [library], 299999).length, 0);
    assert.equal(q.due('server', [library], 300000).length, 1);
    assert(q.claimRefresh(entry));
    q = new PlexRetryQueue(f.file);
    assert.equal(q.claimRefresh(entry), false);
    for (let i = 0; i < 40; i++) q.fail(entry, 1000, true);
    const [due] = q.due('server', [library], 1000 + 86400000);
    assert.equal(due.nextAttempt, 1000 + 86400000);
    assert.equal(due.attempts, 32);
    assert.equal(due.repairNeeded, true);
    assert.equal(due.refreshAttempted, true);
    q.clear(entry);
    assert.equal(new PlexRetryQueue(f.file).has(entry), false);
    q.fail(entry, 0, true);
    assert(q.claimRefresh(entry), 'new incident permits one new refresh');
  } finally {
    f.close();
  }
});
it('bounds due work and pauses disabled, removed and different-server entries without dropping them', () => {
  const f = fixture();
  try {
    for (let i = 0; i < RETRY_LIMIT + 5; i++)
      f.queue.fail({ ...entry, ratingKey: String(i) }, 0);
    assert.equal(f.queue.due('server', [library], 300000).length, RETRY_LIMIT);
    assert.equal(
      f.queue.due('server', [{ ...library, enabled: false }], 300000).length,
      0
    );
    assert.equal(f.queue.due('server', [], 300000).length, 0);
    assert.equal(f.queue.due('different', [library], 300000).length, 0);
    assert.equal(f.queue.summary().pending, RETRY_LIMIT + 5);
    const [due] = f.queue.due('server', [library], 300000);
    assert(f.queue.claim(due, 300000));
    assert.equal(new PlexRetryQueue(f.file).claim(due, 300000), false);
    assert(
      !f.queue
        .due('server', [library], 300000)
        .some((e) => e.ratingKey === due.ratingKey)
    );
  } finally {
    f.close();
  }
});
it('capacity and corrupt state fail explicitly without evicting incidents; show keys coalesce', () => {
  const f = fixture();
  try {
    const entries = Array.from({ length: RETRY_CAPACITY }, (_, i) => ({
      ...entry,
      ratingKey: String(i),
      attempts: 1,
      nextAttempt: 0,
    }));
    fs.writeFileSync(f.file, JSON.stringify({ version: 1, entries }));
    assert.throws(() => f.queue.fail({ ...entry, ratingKey: 'new' }), /full/);
    assert.equal(f.queue.summary().pending, RETRY_CAPACITY);
    fs.writeFileSync(f.file, 'corrupt');
    assert.throws(() => f.queue.has(entry));
    assert.equal(fs.readFileSync(f.file, 'utf8'), 'corrupt');
    assert.equal(
      plexRetryKey({
        ratingKey: 'episode',
        parentRatingKey: 'season',
        grandparentRatingKey: 'show',
      }),
      'show'
    );
    assert.equal(
      plexRetryKey({ ratingKey: 'season', parentRatingKey: 'show' }),
      'show'
    );
  } finally {
    f.close();
  }
});
