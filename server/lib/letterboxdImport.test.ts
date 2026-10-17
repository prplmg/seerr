import {
  csvReviews,
  importKey,
  letterboxdUrl,
  parseCsv,
  plainReview,
  ratingValue,
  rssReviews,
} from '@server/lib/letterboxdImport';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('Letterboxd import parsing', () => {
  const csv =
    'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Watched Date\r\n2026-10-01,"A film, with commas",1975,https://letterboxd.com/alice/film/jaws/,4.5,No,"First line\nSecond ""quoted"" line",2026-09-30\r\n';
  it('handles quoted commas, newlines, BOM and escaped quotes', () => {
    const rows = parseCsv('\uFEFF' + csv);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].Review, 'First line\nSecond "quoted" line');
    const [entry] = csvReviews(csv, 'alice');
    assert.equal(entry.rating, 4.5);
    assert.equal(entry.watchedDate, '2026-09-30');
    assert.equal(entry.publishedAt, '2026-10-01T00:00:00.000Z');
  });
  it('rejects malformed input, account mismatches and unsafe URLs', () => {
    assert.throws(() => parseCsv(csv + '"bad'));
    assert.throws(() => csvReviews(csv, 'bob'));
    for (const url of [
      'http://letterboxd.com/film/jaws/',
      'https://letterboxd.com.evil/film/jaws/',
      'https://user@letterboxd.com/film/jaws/',
      'https://localhost/film/jaws/',
    ])
      assert.throws(() => letterboxdUrl(url));
  });
  it('accepts only half-star ratings or an absent rating', () => {
    assert.equal(ratingValue(''), null);
    assert.equal(ratingValue(0.5), 0.5);
    for (const rating of [-1, 0, 3.2, 6, 'bad'])
      assert.throws(() => ratingValue(rating));
  });
  it('accepts export short links without trusting arbitrary redirect destinations', () => {
    assert.equal(
      letterboxdUrl('https://boxd.it/d1yWHj', 'prplmg'),
      'https://boxd.it/d1yWHj'
    );
    assert.throws(() => letterboxdUrl('https://boxd.it.evil/d1yWHj'));
    assert.throws(() => letterboxdUrl('https://boxd.it/anything/else'));
    assert.throws(() =>
      letterboxdUrl('https://letterboxd.com/other/film/jaws/', 'prplmg')
    );
  });
  it('renders imported HTML as plain text and strips scripts', () => {
    assert.equal(
      plainReview(
        '<p>Hello &amp; welcome</p><script>alert(1)</script><p>&lt;img onerror=x&gt;</p>'
      ),
      'Hello & welcome\n<img onerror=x>'
    );
  });
  it('parses RSS ratings, spoilers, movie IDs and original publication dates', async () => {
    const xml =
      '<rss xmlns:letterboxd="x" xmlns:tmdb="y"><channel><item><title>Jaws</title><link>https://letterboxd.com/alice/film/jaws/</link><pubDate>Thu, 01 Oct 2026 00:00:00 GMT</pubDate><letterboxd:filmTitle>Jaws</letterboxd:filmTitle><letterboxd:filmYear>1975</letterboxd:filmYear><letterboxd:watchedDate>2026-09-30</letterboxd:watchedDate><letterboxd:memberRating>4.5</letterboxd:memberRating><tmdb:movieId>578</tmdb:movieId><description><![CDATA[<p><img src="poster"></p><p>Contains spoilers</p><p>Great!</p>]]></description></item></channel></rss>';
    const [entry] = await rssReviews(xml, 'alice');
    assert.equal(entry.tmdbId, 578);
    assert.equal(entry.spoiler, true);
    assert.equal(entry.key, csvReviews(csv, 'alice')[0].key);
    assert.ok(!entry.text.includes('poster'));
    await assert.rejects(rssReviews('<!DOCTYPE x>' + xml, 'alice'));
  });
  it('keeps rewatches distinct and identities stable', () => {
    assert.equal(
      importKey('url', '2026-10-01'),
      importKey('url', '2026-10-01')
    );
    assert.notEqual(
      importKey('url', '2026-10-01'),
      importKey('url', '2026-10-02')
    );
  });
  it('preserves review prose beginning with Watched and accepts unrated RSS entries', async () => {
    const [entry] = await rssReviews(
      '<rss xmlns:letterboxd="x"><channel><item><link>https://letterboxd.com/alice/film/jaws/</link><pubDate>Thu, 01 Oct 2026 00:00:00 GMT</pubDate><letterboxd:filmTitle>Jaws</letterboxd:filmTitle><letterboxd:memberRating>0</letterboxd:memberRating><description><![CDATA[<p>Watched this with friends. Loved it!</p>]]></description></item></channel></rss>',
      'alice'
    );
    assert.equal(entry.text, 'Watched this with friends. Loved it!');
    assert.equal(entry.rating, null);
  });
});
