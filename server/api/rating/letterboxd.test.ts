import axios from 'axios';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getLetterboxdRating, parseLetterboxdRating } from './letterboxd';

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

test('typed series parsing accepts Movie and TVSeries, not TVEpisode', () => {
  // An entry can exist without an aggregate score: the rating parser cannot
  // serve as the publishing-eligibility check for these titles.
  assert.equal(
    parseLetterboxdRating(html({ '@type': 'TVSeries', url: movie.url }), 'tv'),
    null
  );
  for (const type of ['Movie', 'TVSeries'])
    assert.equal(
      parseLetterboxdRating(html({ ...movie, '@type': type }), 'tv')?.score,
      3.91
    );
  assert.equal(
    parseLetterboxdRating(html({ ...movie, '@type': 'TVEpisode' }), 'tv'),
    null
  );
});

test('typed lookups isolate caches, coalesce requests and cache unavailable series', async (t) => {
  const calls: string[] = [];
  t.mock.method(axios, 'get', async (url: string) => {
    calls.push(url);
    if (url.includes('/900002/'))
      return { data: '<html>No matching title</html>' };
    if (url.includes('/900003/')) throw Error('Challenge or network failure');
    const tv = url.endsWith('/tv/');
    return {
      data: html({
        ...movie,
        url: `https://letterboxd.com/film/${tv ? 'series' : 'movie'}/`,
        aggregateRating: { bestRating: 5, ratingValue: tv ? 4.2 : 3.1 },
      }),
    };
  });
  const [film, series, repeat] = await Promise.all([
    getLetterboxdRating(900001),
    getLetterboxdRating(900001, 'tv'),
    getLetterboxdRating(900001, 'tv'),
  ]);
  assert.equal(film?.score, 3.1);
  assert.equal(series?.score, 4.2);
  assert.deepEqual(repeat, series);
  assert.deepEqual(calls, [
    'https://letterboxd.com/tmdb/900001/',
    'https://letterboxd.com/tmdb/900001/tv/',
  ]);
  await getLetterboxdRating(900001, 'tv');
  assert.equal(calls.length, 2);
  for (const id of [900002, 900003]) {
    assert.equal(await getLetterboxdRating(id, 'tv'), null);
    assert.equal(await getLetterboxdRating(id, 'tv'), null);
  }
  assert.equal(calls.length, 4);
  assert.equal(await getLetterboxdRating(-1, 'tv'), null);
  assert.equal(calls.length, 4);
});

test('uses mapped canonical series page when typed lookup is blocked; caches mapping and fetch', async (t) => {
  let mappingCalls = 0;
  const calls: string[] = [];
  const url = 'https://letterboxd.com/film/chernobyl/';
  t.mock.method(axios, 'get', async (value: string) => {
    calls.push(value);
    if (value.includes('/tmdb/')) throw Error('403');
    return {
      data:
        html({
          ...movie,
          url,
          aggregateRating: { bestRating: 5, ratingValue: 4.62 },
        }) + '<a href="https://www.themoviedb.org/tv/900010/">TMDB</a>',
    };
  });
  const mapping = async () => {
    mappingCalls++;
    return url;
  };
  assert.deepEqual(await getLetterboxdRating(900010, 'tv', mapping), {
    score: 4.62,
    url,
  });
  await getLetterboxdRating(900010, 'tv', mapping);
  assert.deepEqual(calls, [url]);
  assert.equal(mappingCalls, 1);
});
test('rejects mapped page for the wrong media identity and ignores unsafe mapped URLs', async (t) => {
  const calls: string[] = [];
  t.mock.method(axios, 'get', async (url: string) => {
    calls.push(url);
    if (url.includes('/tmdb/')) return { data: 'unavailable' };
    return {
      data:
        html(movie) +
        '<a href="https://www.themoviedb.org/movie/900011/">TMDB</a>',
    };
  });
  assert.equal(
    await getLetterboxdRating(900011, 'tv', async () => movie.url),
    null
  );
  assert.equal(
    await getLetterboxdRating(
      900012,
      'tv',
      async () => 'http://localhost/secrets'
    ),
    null
  );
  assert(!calls.some((c) => c.includes('localhost')));
});
