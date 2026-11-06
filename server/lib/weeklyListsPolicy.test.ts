import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  discoveryListUrl,
  validateDiscoverySnapshot,
  weeklyClock,
  weeklyDiscoveryPages,
  weeklyWindow,
} from './weeklyListsPolicy';
it('uses Merida morning window across DST seasons', () => {
  for (const day of ['2026-11-10', '2027-06-08']) {
    assert.equal(weeklyClock(Date.parse(day + 'T13:20:00Z')).day, 'Tue');
    assert.equal(weeklyWindow(Date.parse(day + 'T13:19:59Z')), false);
    assert.equal(weeklyWindow(Date.parse(day + 'T13:20:00Z')), true);
    assert.equal(weeklyWindow(Date.parse(day + 'T14:39:59Z')), true);
    assert.equal(weeklyWindow(Date.parse(day + 'T14:40:00Z')), false);
  }
});
it('requires complete anonymous evidence for eight discovery pages', () => {
  assert.equal(new Set(weeklyDiscoveryPages).size, 8);
  const url = weeklyDiscoveryPages[0];
  const value = {
    url,
    anonymous: true,
    complete: true,
    candidates: [
      {
        url: 'https://letterboxd.com/a/list/filmlist:123/',
        title: 'List',
        total: 560,
      },
    ],
  };
  assert.equal(validateDiscoverySnapshot(value, url)[0].total, 560);
  assert.throws(() =>
    validateDiscoverySnapshot({ ...value, complete: false }, url)
  );
  assert.throws(() =>
    validateDiscoverySnapshot({ ...value, candidates: [] }, url)
  );
  assert.throws(() =>
    validateDiscoverySnapshot({ ...value, url: 'https://example.com/' }, url)
  );
  assert.throws(() =>
    validateDiscoverySnapshot(
      { ...value, candidates: [{ ...value.candidates[0], total: '560' }] },
      url
    )
  );
  assert.equal(
    discoveryListUrl(
      'https://letterboxd.com/o_zero/list/short-films-on-youtube/'
    ),
    undefined
  );
  assert.equal(
    discoveryListUrl('https://letterboxd.com.evil/a/list/x/'),
    undefined
  );
});
