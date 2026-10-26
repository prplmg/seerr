import { readLetterboxdArchive } from './letterboxdArchive';
import { letterboxdUrl, parseCsv, ratingValue } from './letterboxdImport';

const schemas = {
  'watched.csv': ['Name', 'Year', 'Letterboxd URI'],
  'ratings.csv': ['Name', 'Year', 'Letterboxd URI', 'Rating'],
  'diary.csv': ['Name', 'Year', 'Letterboxd URI', 'Watched Date'],
  'reviews.csv': ['Name', 'Year', 'Letterboxd URI', 'Review'],
} as const;

/** Only a complete, account-verified export may authorize absence comparisons.
 * Keep entry URLs distinct from film URLs; resolve short links before matching.
 * Deleted/orphaned rows never become active entries.
 */
export function parseExportSnapshot(
  files: ReadonlyMap<string, string>,
  account: string
) {
  if (!/^[a-z0-9_]{1,40}$/i.test(account))
    throw Error('Invalid export account');
  const profile = files.get('profile.csv');
  if (profile === undefined) throw Error('Missing export identity');
  const users = parseCsv(profile, ['Username']);
  if (
    users.length !== 1 ||
    users[0].Username.toLowerCase() !== account.toLowerCase()
  )
    throw Error('Wrong export account');
  const active: Record<string, Record<string, string>[]> = {};
  for (const [name, headers] of Object.entries(schemas)) {
    const csv = files.get(name);
    if (csv === undefined) throw Error(`Incomplete export: ${name}`);
    const rows = parseCsv(csv, [...headers]);
    const identities = new Set<string>();
    for (const row of rows) {
      const uri = letterboxdUrl(row['Letterboxd URI']);
      if (identities.has(uri))
        throw Error(`Duplicate export identity: ${name}`);
      identities.add(uri);
      if ('Rating' in row) ratingValue(row.Rating);
      const date = row['Watched Date'];
      if (
        date &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date)
      )
        throw Error('Invalid viewing date');
    }
    active[name] = rows;
  }
  const watched = new Set(
    active['watched.csv'].map((row) => letterboxdUrl(row['Letterboxd URI']))
  );
  for (const row of active['ratings.csv']) {
    if (
      ratingValue(row.Rating) === null ||
      !watched.has(letterboxdUrl(row['Letterboxd URI']))
    )
      throw Error('Inconsistent rated and watched collections');
  }
  // Deliberately omit profile PII and deleted/orphaned text from the snapshot.
  return { account: account.toLowerCase(), complete: true as const, active };
}
export async function readExportSnapshot(encoded: string, account: string) {
  return parseExportSnapshot(await readLetterboxdArchive(encoded), account);
}
