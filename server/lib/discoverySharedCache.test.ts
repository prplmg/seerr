import assert from 'node:assert/strict';
import { it } from 'node:test';
import { DiscoveryChanged, stableDiscoveryRead } from './discoverySharedCache';

it('rebuilds Releases after its source file changes during a read', async () => {
  let reads = 0;
  const result = await stableDiscoveryRead(async () => {
    reads++;
    if (reads === 1)
      throw new DiscoveryChanged('Release interests changed; retry discovery');
    return { movies: ['fresh'], episodes: [] };
  });
  assert.equal(reads, 2);
  assert.deepEqual(result, { movies: ['fresh'], episodes: [] });
});
it('bounds retries if release data keeps changing', async () => {
  let reads = 0;
  await assert.rejects(
    stableDiscoveryRead(async () => {
      reads++;
      throw new DiscoveryChanged('Release interests changed; retry discovery');
    }),
    /Release interests changed/
  );
  assert.equal(reads, 4);
});
it('does not hide or retry unrelated release-store errors', async () => {
  let reads = 0;
  await assert.rejects(
    stableDiscoveryRead(async () => {
      reads++;
      throw Error('Invalid release store');
    }),
    /Invalid release store/
  );
  assert.equal(reads, 1);
});
