import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  earlyViewing,
  playbackClaimed,
  reviewSessionId,
  selectEarlyViewing,
} from './earlyReviewViewing';
import {
  collectPlaybackEvents,
  type PlaybackStore,
} from './letterboxdPlaybackEvents';
const now = Date.UTC(2026, 10, 4, 1),
  source = 'plex-instance';
const row = {
  user_id: '4',
  rating_key: '565',
  machine_id: 'tv',
  started: now / 1000 - 7200,
  media_type: 'movie',
  state: 'playing',
  duration: 7200000,
  view_offset: 6600000,
};
const candidate = () =>
  earlyViewing(row, source, 4, 565, 'America/Merida', now)!;
test('exact ten minute boundary, real position, identity and active movie required', () => {
  assert.ok(candidate());
  for (const patch of [
    { view_offset: 6599999 },
    { view_offset: 0 },
    { view_offset: 7200001 },
    { duration: 0 },
    { view_offset: NaN },
    { state: 'paused' },
    { media_type: 'episode' },
    { machine_id: '' },
    { started: undefined },
  ])
    assert.equal(
      earlyViewing({ ...row, ...patch }, source, 4, 565, 'America/Merida', now),
      undefined
    );
  assert.equal(candidate().date, '2026-11-03');
});
test('stale, future, unrelated or ambiguous playback never becomes an association', () => {
  const c = candidate();
  assert.equal(selectEarlyViewing([c], 4, 565, now)?.id, c.id);
  for (const [u, m] of [
    [1, 565],
    [4, 99],
  ])
    assert.equal(selectEarlyViewing([c], u, m, now), undefined);
  assert.equal(selectEarlyViewing([c], 4, 565, now + 65001), undefined);
  assert.equal(selectEarlyViewing([c], 4, 565, now - 1), undefined);
  assert.equal(
    selectEarlyViewing([c, { ...c, id: 'another' }], 4, 565, now),
    undefined
  );
});
test('incoming watched event retains exact session identity and is claimed by its early review', () => {
  const store: PlaybackStore = { version: 1, events: [] };
  collectPlaybackEvents(
    store,
    [
      {
        ...row,
        type: 'movie',
        row_id: 123,
        reference_id: 100,
        stopped: now / 1000,
        watched_status: 1,
        viewers: [4],
        tmdbId: 565,
      },
    ],
    {
      enabled: true,
      userId: 4,
      account: 'test',
      enabledSince: 1,
      timezone: 'America/Merida',
      sourceId: source,
      now,
    }
  );
  assert.equal(store.events.length, 1);
  const event = JSON.parse(JSON.stringify(store.events[0])); // restart persistence
  assert.equal(event.sessionId, candidate().id);
  assert.ok(playbackClaimed(event, new Set([candidate().id])));
  assert.equal(
    playbackClaimed(
      {
        ...event,
        sessionId: reviewSessionId(
          { ...row, started: row.started + 10 },
          source,
          4
        ),
      },
      new Set([candidate().id])
    ),
    false
  );
  assert.notEqual(reviewSessionId(row, source, 7), candidate().id);
  assert.notEqual(reviewSessionId(row, 'different-server', 4), candidate().id);
});
test('active suggestion alone never fabricates a completed playback', () => {
  const store: PlaybackStore = { version: 1, events: [] };
  collectPlaybackEvents(
    store,
    [
      {
        ...row,
        type: 'movie',
        stopped: 0,
        watched_status: 0,
        viewers: [4],
        tmdbId: 565,
      },
    ],
    {
      enabled: true,
      userId: 4,
      account: 'test',
      enabledSince: 1,
      timezone: 'America/Merida',
      sourceId: source,
      now,
    }
  );
  assert.equal(store.events.length, 0);
});
