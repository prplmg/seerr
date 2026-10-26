import { createHash } from 'crypto';
import type { ExportSnapshot } from './letterboxdExportTransaction';
import {
  importKey,
  letterboxdEntryIdentity,
  letterboxdUrl,
  plainReview,
  ratingValue,
  type ImportedReview,
} from './letterboxdImport';

export type ExportRecord = ImportedReview & {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
};
export type ExportResolver = (
  entry: ImportedReview,
  account: string
) => Promise<ExportRecord>;

/** Resolve every active identity before permitting any destructive comparison.
 * Diary and review CSVs can describe the SAME entry; merge only by canonical ID,
 * never by film/date. Historical entry ratings are not current film ratings.
 */
export async function resolveExportRecords(
  snapshot: ExportSnapshot,
  resolve: ExportResolver
) {
  const records = new Map<string, ExportRecord>();
  const ratings = new Map(
    snapshot.active['ratings.csv'].map((r) => [
      letterboxdUrl(r['Letterboxd URI']),
      ratingValue(r.Rating),
    ])
  );
  for (const name of ['watched.csv', 'diary.csv', 'reviews.csv']) {
    for (const row of snapshot.active[name]) {
      const summary = name === 'watched.csv';
      const externalUrl = letterboxdUrl(
        row['Letterboxd URI'],
        snapshot.account
      );
      const watchedDate = summary ? null : row['Watched Date'] || null;
      // Date is publication/addition metadata, never a viewing date.
      const publishedAt =
        row.Date && Number.isFinite(Date.parse(row.Date))
          ? new Date(row.Date).toISOString()
          : '1970-01-01T00:00:00.000Z';
      const entry = await resolve(
        {
          key: importKey(externalUrl, watchedDate),
          title: row.Name,
          year: row.Year,
          externalUrl,
          watchedDate,
          publishedAt,
          watched: true,
          entryKind: summary ? 'summary' : 'diary',
          rating: summary
            ? (ratings.get(externalUrl) ?? null)
            : ratingValue(row.Rating),
          text: name === 'reviews.csv' ? plainReview(row.Review) : '',
          // CSVs omit spoiler flags. Do not invent a spoiler label: retain known
          // RSS/write flags in the resolver; otherwise display normally by policy.
          spoiler: false,
        },
        snapshot.account
      );
      if (
        !Number.isSafeInteger(entry.tmdbId) ||
        entry.tmdbId < 1 ||
        !['movie', 'tv'].includes(entry.mediaType)
      )
        throw Error('Unresolved export film');
      const canonical = summary
        ? `${entry.mediaType}:${entry.tmdbId}:summary`
        : letterboxdEntryIdentity(entry.externalUrl);
      if (
        !canonical ||
        (!summary &&
          new URL(canonical).pathname.split('/')[1] !== snapshot.account)
      )
        throw Error('Unresolved export entry identity');
      const old = records.get(canonical);
      if (
        old &&
        (summary ||
          old.tmdbId !== entry.tmdbId ||
          old.watchedDate !== entry.watchedDate ||
          old.rating !== entry.rating)
      )
        throw Error('Conflicting export identity');
      records.set(canonical, old ? { ...old, ...entry } : entry);
    }
  }
  const watchedFilms = new Set(
    [...records.values()]
      .filter((r) => r.entryKind === 'summary')
      .map((r) => `${r.mediaType}:${r.tmdbId}`)
  );
  return [...records.values()].map((r) => ({
    ...r,
    watched: watchedFilms.has(`${r.mediaType}:${r.tmdbId}`),
  }));
}

export function exportRecordId(userId: number, record: ExportRecord) {
  return record.entryKind === 'summary'
    ? `letterboxd:${userId}:${record.mediaType}:${record.tmdbId}:summary`
    : `letterboxd:${userId}:${createHash('sha256').update(letterboxdEntryIdentity(record.externalUrl)!).digest('hex').slice(0, 32)}`;
}
