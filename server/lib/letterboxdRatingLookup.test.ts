import assert from 'node:assert/strict';
import { it } from 'node:test';
import { canonicalLetterboxdFilm } from './letterboxdRatingLookup';
it('derives only a public film URL from an imported Letterboxd entry', () => {
  for (const url of [
    'https://letterboxd.com/film/chernobyl/',
    'https://letterboxd.com/member/film/chernobyl/',
    'https://letterboxd.com/member/film/chernobyl/2/',
  ])
    assert.equal(
      canonicalLetterboxdFilm(url),
      'https://letterboxd.com/film/chernobyl/'
    );
  for (const url of [
    'https://example.com/film/chernobyl/',
    'https://letterboxd.com@evil.test/film/chernobyl/',
    'https://name:secret@letterboxd.com/film/chernobyl/',
    'http://letterboxd.com/film/chernobyl/',
    'https://letterboxd.com/member/list/chernobyl/',
    'invalid',
  ])
    assert.equal(canonicalLetterboxdFilm(url), null);
});
