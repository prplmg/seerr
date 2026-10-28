import assert from 'node:assert/strict';
import { it } from 'node:test';
import { assertExportFresh } from './letterboxdExportPreflight';
it('rejects stale archives before resolving titles, while retaining transaction replay checks', () => {
  const old: any = { revision: 'old', capturedAt: 2000 };
  assert.throws(() => assertExportFresh('new', 1000, old, []), /Stale/);
  assert.throws(
    () =>
      assertExportFresh('new', 3000, old, [
        { updatedAt: new Date(4000).toISOString() },
      ]),
    /predates/
  );
  assert.doesNotThrow(() =>
    assertExportFresh('new', 5000, old, [
      { updatedAt: new Date(4000).toISOString() },
    ])
  );
  assert.doesNotThrow(() =>
    assertExportFresh('old', 2000, old, [
      { updatedAt: new Date(4000).toISOString() },
    ])
  );
});
