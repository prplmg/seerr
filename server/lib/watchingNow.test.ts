import { mergeWatchingNow, type PartySnapshot } from '@server/lib/watchingNow';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const users = new Map(
  [1, 2].map((id) => [id, { id, name: `user${id}`, avatar: '/avatar.png' }])
);
const media = [{ tmdbId: 10, mediaType: 'movie', ratingKey: '42' }];
const party: PartySnapshot = {
  id: 'party',
  tmdbId: 10,
  mediaType: 'movie',
  ratingKey: 'youtube:abcdefghijk',
  userIds: [1],
  position: 30,
  duration: 90,
  paused: false,
  canReturn: true,
  external: {
    provider: 'youtube',
    videoId: 'abcdefghijk',
    title: 'Example',
    url: 'https://untrusted.invalid',
    thumbnail: 'https://untrusted.invalid',
  },
};
const mapped = new Map([
  ['plex1', 1],
  ['plex2', 2],
]);
describe('external watching activity', () => {
  it('uses session attribution without merging it into party membership', () => {
    const result = mergeWatchingNow(
      [
        {
          user_id: 'plex1',
          rating_key: '42',
          media_type: 'movie',
          state: 'playing',
          viewerIds: [2],
          attribution: {
            id: 'session',
            names: ['user2'],
            canClaim: true,
            isMe: true,
            joined: false,
          },
        },
      ],
      [party],
      media,
      users,
      mapped,
      [],
      2
    );
    assert.deepEqual(
      result[0].viewers.map((p) => p.id),
      [2]
    );
    assert.deepEqual(
      result[0].parties[0].members.map((p) => p.id),
      [1]
    );
    assert.equal(result[0].parties[0].mine, false);
    assert.equal(result[0].sessions?.[0].id, 'session');
  });
  it('keeps a session available for correction when its default person opts out', () => {
    const result = mergeWatchingNow(
      [
        {
          user_id: 'plex1',
          rating_key: '42',
          media_type: 'movie',
          state: 'playing',
          viewerIds: [],
          attribution: {
            id: 'session',
            names: [],
            canClaim: true,
            isMe: false,
            joined: false,
          },
        },
      ],
      [],
      media,
      users,
      mapped,
      [],
      1
    );
    assert.deepEqual(result[0].viewers, []);
    assert.equal(result[0].sessions?.length, 1);
  });
  it('keeps the main movie and canonicalizes each party source', () => {
    const result = mergeWatchingNow([], [party], media, users, mapped, [], 1);
    assert.equal(result.length, 1);
    assert.equal(
      result[0].parties[0].external?.url,
      'https://www.youtube.com/watch?v=abcdefghijk'
    );
    assert.equal(
      result[0].parties[0].external?.thumbnail,
      'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg'
    );
    assert.equal(result[0].parties[0].canReturn, true);
  });
  it('suppresses the paused return tab but retains someone else watching the movie', () => {
    const result = mergeWatchingNow(
      [
        {
          user_id: 'plex1',
          rating_key: '42',
          media_type: 'movie',
          state: 'paused',
        },
        {
          user_id: 'plex2',
          rating_key: '42',
          media_type: 'movie',
          state: 'playing',
        },
      ],
      [party],
      media,
      users,
      mapped,
      [],
      1
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].parties[0].external?.provider, 'youtube');
    assert.deepEqual(
      result[0].viewers.map((p) => p.id),
      [2]
    );
    assert.equal(result[0].parties.length, 1);
  });
  it('honors hidden viewers and rejects invalid external identities', () => {
    assert.equal(
      mergeWatchingNow([], [party], media, users, mapped, [1], 2).length,
      0
    );
    assert.equal(
      mergeWatchingNow(
        [],
        [{ ...party, external: { ...party.external!, videoId: '../bad' } }],
        media,
        users,
        mapped,
        [],
        1
      ).length,
      0
    );
  });
});
