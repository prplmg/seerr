import {
  attributedViewers,
  changeAttribution,
  historyViewers,
  sessionIdentity,
} from '@server/lib/viewingAttribution';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const row = {
  user_id: 'plex',
  rating_key: '42',
  machine_id: 'client',
  started: 100,
  watched_status: 1,
};
describe('session-specific viewing attribution', () => {
  it('replaces the default person without adding the shared account automatically', () => {
    const entry = changeAttribution(undefined, 'claim', 2, 1, false);
    assert.deepEqual(attributedViewers(1, entry), [2]);
    assert.deepEqual(
      historyViewers(row, 1, { [sessionIdentity(row)!]: entry }),
      [2]
    );
    assert.deepEqual(
      historyViewers({ ...row, started: 101 }, 1, {
        [sessionIdentity(row)!]: entry,
      }),
      [1]
    );
  });
  it('adds a co-viewer without replacing anyone and does not count incomplete playback', () => {
    const entry = changeAttribution(undefined, 'join', 3, 1, false);
    assert.deepEqual(attributedViewers(1, entry), [1, 3]);
    assert.deepEqual(
      historyViewers({ ...row, watched_status: 0.5 }, 1, {
        [sessionIdentity(row)!]: entry,
      }),
      []
    );
    assert.deepEqual(
      historyViewers(row, 1, { [sessionIdentity(row)!]: entry }),
      [1, 3]
    );
  });
  it('does not credit someone who left before completion', () => {
    let entry = changeAttribution(undefined, 'join', 3, 1, false);
    entry = changeAttribution(entry, 'leave', 3, 1, false);
    assert.deepEqual(
      historyViewers(row, 1, { [sessionIdentity(row)!]: entry }),
      [1]
    );
  });
  it('retains completed credit when a co-viewer leaves', () => {
    let entry = changeAttribution(undefined, 'join', 3, 1, false);
    entry = changeAttribution(entry, 'leave', 3, 1, true);
    assert.deepEqual(attributedViewers(1, entry), [1]);
    assert.deepEqual(
      historyViewers(row, 1, { [sessionIdentity(row)!]: entry }),
      [1, 3]
    );
  });
  it('not me corrects mistaken credit without affecting the other explicit viewers', () => {
    let entry = changeAttribution(undefined, 'join', 3, 1, true);
    entry = changeAttribution(entry, 'unclaim', 1, 1, true);
    assert.deepEqual(attributedViewers(1, entry), [3]);
    assert.deepEqual(
      historyViewers(row, 1, { [sessionIdentity(row)!]: entry }),
      [3]
    );
  });
  it('does not let unclaiming an absent viewer remove the default person', () => {
    assert.deepEqual(
      attributedViewers(
        1,
        changeAttribution(undefined, 'unclaim', 2, 1, false)
      ),
      [1]
    );
  });
  it('rejects incomplete identities and separates clients and episodes', () => {
    assert.equal(sessionIdentity({ ...row, started: undefined }), undefined);
    assert.notEqual(
      sessionIdentity(row),
      sessionIdentity({ ...row, machine_id: 'other' })
    );
    assert.notEqual(
      sessionIdentity(row),
      sessionIdentity({ ...row, rating_key: '43' })
    );
  });
});
