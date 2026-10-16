import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLetterboxdRating } from './letterboxd';

const movie = {
  '@type': 'Movie',
  url: 'https://letterboxd.com/film/jaws/',
  aggregateRating: { bestRating: 5, ratingValue: 3.91 },
};
const html = (data: unknown) =>
  `<script type="application/ld+json">/* <![CDATA[ */${JSON.stringify(data)}/* ]]> */</script>`;

test('reads the public Letterboxd CDATA-wrapped rating', () => {
  assert.deepEqual(parseLetterboxdRating(html(movie)), {
    score: 3.91,
    url: movie.url,
  });
  assert.deepEqual(parseLetterboxdRating(html({ '@graph': [movie] })), {
    score: 3.91,
    url: movie.url,
  });
});
test('rejects missing, invalid, unrelated and unsafe ratings', () => {
  for (const data of [
    {},
    { ...movie, '@type': 'TVSeries' },
    { ...movie, url: 'https://example.com/film/jaws/' },
    { ...movie, aggregateRating: { bestRating: 10, ratingValue: 9 } },
    { ...movie, aggregateRating: { bestRating: 5, ratingValue: 6 } },
  ]) {
    assert.equal(parseLetterboxdRating(html(data)), null);
  }
  assert.equal(parseLetterboxdRating('<html>Unavailable</html>'), null);
  assert.equal(
    parseLetterboxdRating(
      '<script type="application/ld+json">invalid</script>'
    ),
    null
  );
});
