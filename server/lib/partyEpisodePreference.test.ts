import { preferredPartyEpisode } from '@server/lib/partyEpisodePreference';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
const episodes = [
  { key: '1', season: 1, episode: 1 },
  { key: '21', season: 1, episode: 21 },
  { key: '22', season: 1, episode: 22 },
];
describe('shared profile episode preference', () => {
  it('prefers current playback and refuses ambiguous sessions', () => {
    assert.equal(preferredPartyEpisode(episodes, [{ rating_key: '21' }]), '21');
    assert.equal(
      preferredPartyEpisode(episodes, [
        { rating_key: '21' },
        { rating_key: '22' },
      ]),
      undefined
    );
  });
  it('resumes incomplete history, advances completed history and never guesses the pilot', () => {
    assert.equal(
      preferredPartyEpisode(episodes, [], {
        rating_key: '21',
        percent_complete: 30,
      }),
      '21'
    );
    assert.equal(
      preferredPartyEpisode(episodes, [], {
        rating_key: '21',
        percent_complete: 100,
      }),
      '22'
    );
    assert.equal(preferredPartyEpisode(episodes, []), undefined);
    assert.equal(
      preferredPartyEpisode(episodes, [], {
        rating_key: '999',
        percent_complete: 10,
      }),
      undefined
    );
  });
});
