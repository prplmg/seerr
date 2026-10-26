import type { parseExportSnapshot } from './letterboxdExportSnapshot';

type Snapshot = ReturnType<typeof parseExportSnapshot>;
type Row = Record<string, string>;
const collections = [
  'watched.csv',
  'ratings.csv',
  'diary.csv',
  'reviews.csv',
] as const;

/** Pure plan: applying it must share a transaction with saving the new baseline.
 * No cross-collection deletion: losing a rating never removes a watched row.
 * Exact exported identities are retained, including distinct repeat entries.
 */
export function diffLetterboxdExports(previous: Snapshot, next: Snapshot) {
  if (!previous.complete || !next.complete || previous.account !== next.account)
    throw Error('Cannot reconcile incomplete or different-account snapshots');
  const result: Record<
    string,
    { added: Row[]; changed: { before: Row; after: Row }[]; removed: Row[] }
  > = {};
  for (const collection of collections) {
    if (!previous.active[collection] || !next.active[collection])
      throw Error('Missing collection');
    const index = (rows: Row[]) => {
      const map = new Map<string, Row>();
      for (const row of rows) {
        const id = row['Letterboxd URI'];
        if (!id || map.has(id)) throw Error('Ambiguous export identity');
        map.set(id, row);
      }
      return map;
    };
    const before = index(previous.active[collection]),
      after = index(next.active[collection]);
    // A large collapse needs administrative review of the archive as a whole,
    // not hundreds of browser checks or automatic mass deletion.
    if (before.size >= 20 && after.size < before.size / 2)
      throw Error(`Suspicious collection collapse: ${collection}`);
    const equal = (a: Row, b: Row) =>
      JSON.stringify(Object.entries(a).sort()) ===
      JSON.stringify(Object.entries(b).sort());
    result[collection] = {
      added: [...after].filter(([id]) => !before.has(id)).map(([, row]) => row),
      changed: [...after]
        .filter(([id, row]) => before.has(id) && !equal(before.get(id)!, row))
        .map(([id, row]) => ({ before: before.get(id)!, after: row })),
      removed: [...before]
        .filter(([id]) => !after.has(id))
        .map(([, row]) => row),
    };
  }
  return result;
}
