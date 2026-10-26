import { MovieReview } from '@server/entity/MovieReview';
import type { EntityManager } from 'typeorm';
import { exportRecordId, type ExportRecord } from './letterboxdExportRecords';
import { letterboxdEntryIdentity } from './letterboxdImport';

/** Called only inside the baseline/audit transaction, after full validation.
 * Local and server playback records are never deleted by remote absence.
 */
export async function applyExportRecords(
  manager: EntityManager,
  userId: number,
  records: ExportRecord[],
  capturedAt: number
) {
  const repo = manager.getRepository(MovieReview);
  const existing = await repo.findBy({ userId, source: 'letterboxd' });
  const retained = new Set<string>();
  for (const record of records) {
    const identity =
      record.entryKind === 'diary'
        ? letterboxdEntryIdentity(record.externalUrl)
        : null;
    const matches = existing.filter((r) =>
      identity
        ? (r.externalEntryId ||
            (r.externalUrl && letterboxdEntryIdentity(r.externalUrl))) ===
          identity
        : r.entryKind === 'summary' &&
          r.tmdbId === record.tmdbId &&
          r.mediaType === record.mediaType
    );
    if (matches.length > 1) throw Error('Ambiguous existing export identity');
    const old = matches[0];
    const id = old?.id || exportRecordId(userId, record);
    retained.add(id);
    // An export captured before an RSS/write update must not undo newer evidence.
    if (old && Date.parse(old.updatedAt) > capturedAt)
      throw Error('Export predates imported changes');
    await repo.save(
      repo.create({
        ...old,
        id,
        userId,
        source: 'letterboxd',
        tmdbId: record.tmdbId,
        mediaType: record.mediaType,
        entryKind: record.entryKind,
        rating: record.rating,
        text: record.text,
        spoiler: record.spoiler,
        watched: record.watched,
        publishedAt: record.publishedAt,
        updatedAt: new Date(capturedAt).toISOString(),
        externalUrl: record.externalUrl,
        externalEntryId: identity,
        watchedDate: record.watchedDate,
      })
    );
  }
  for (const old of existing) {
    if (retained.has(old.id)) continue;
    if (Date.parse(old.updatedAt) > capturedAt)
      throw Error('Export predates imported changes');
    await repo.delete({ id: old.id, userId, source: 'letterboxd' });
  }
}
