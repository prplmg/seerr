import { getRepository } from '@server/datasource';
import { LetterboxdExportBaseline } from '@server/entity/LetterboxdExport';
import type { ResolvedBaseline } from './letterboxdExportReconciliation';
import type { ImportedReview } from './letterboxdImport';
import { readSyncReceipts } from './letterboxdSyncReceipts';

export async function exportConflicts() {
  return (await getRepository(LetterboxdExportBaseline).find()).flatMap(
    (row) => {
      const baseline = JSON.parse(row.value) as ResolvedBaseline;
      return (baseline.holds || []).map((hold) => ({
        id: `export:${row.userId}:${hold.originId}:${hold.reason}`,
        userId: row.userId,
        account: row.account,
        state: 'conflict',
      }));
    }
  );
}

export async function currentSyncReceipts() {
  const baselines = await getRepository(LetterboxdExportBaseline).find();
  return readSyncReceipts().filter((receipt) => {
    const row = baselines.find(
      (b) => b.userId === receipt.userId && b.account === receipt.account
    );
    if (!row) return true;
    const baseline = JSON.parse(row.value) as ResolvedBaseline;
    return (
      !baseline.records ||
      baseline.capturedAt < (receipt.verifiedAt || 0) ||
      baseline.records.some((r) => r.externalUrl === receipt.entryId)
    );
  });
}

export async function exportPublicationHeld(userId: number, originId: string) {
  const row = await getRepository(LetterboxdExportBaseline).findOneBy({
    userId,
  });
  if (!row) return false;
  return (
    (JSON.parse(row.value) as ResolvedBaseline).holds?.some(
      (h) => h.originId === originId
    ) || false
  );
}

export async function exportReviewBaseline(
  userId: number,
  originId: string,
  tmdbId: number,
  entryId?: string,
  verifiedAt = 0
) {
  const row = await getRepository(LetterboxdExportBaseline).findOneBy({
    userId,
  });
  if (!row) return undefined;
  const baseline = JSON.parse(row.value) as ResolvedBaseline;
  if (verifiedAt > baseline.capturedAt) return undefined;
  if (!baseline.records || baseline.holds?.some((h) => h.originId === originId))
    return undefined;
  const receipt = readSyncReceipts().find(
    (r) => r.userId === userId && r.originId === originId
  );
  if (receipt?.verifiedAt && receipt.verifiedAt > baseline.capturedAt)
    return undefined;
  const record = baseline.records.find((r) =>
    entryId
      ? r.externalUrl === entryId
      : r.entryKind === 'summary' &&
        r.tmdbId === tmdbId &&
        r.mediaType === 'movie'
  );
  return record
    ? { rating: record.rating, text: record.text, spoiler: record.spoiler }
    : entryId
      ? undefined
      : { rating: null, text: '', spoiler: false };
}

export async function exportAllowsImport(
  userId: number,
  entry: ImportedReview,
  tmdbId: number
) {
  const row = await getRepository(LetterboxdExportBaseline).findOneBy({
    userId,
  });
  if (!row) return true;
  const baseline = JSON.parse(row.value) as ResolvedBaseline;
  if (!baseline.records || Date.parse(entry.publishedAt) > baseline.capturedAt)
    return true;
  const authoritative = baseline.records.find((r) =>
    entry.entryKind === 'summary'
      ? r.entryKind === 'summary' &&
        r.tmdbId === tmdbId &&
        r.mediaType === (entry.mediaType || 'movie')
      : r.entryKind === 'diary' && r.externalUrl === entry.externalUrl
  );
  if (!authoritative) return false;
  // RSS publication timestamps do not advance on every edit. An older item may
  // enrich spoiler metadata, but cannot resurrect values removed by the ZIP.
  const spoiler =
    entry.text === authoritative.text ? entry.spoiler : authoritative.spoiler;
  Object.assign(entry, {
    rating: authoritative.rating,
    text: authoritative.text,
    watchedDate: authoritative.watchedDate,
    watched: authoritative.watched,
    spoiler,
  });
  return true;
}
