import { letterboxdEntryIdentity } from './letterboxdImport';
import { isBoundDiaryPair, type SyncReceipt } from './letterboxdSyncReceipts';

type ReviewSourceInput = {
  id: string;
  userId: number;
  source: string;
  rating: number | null;
  text: string;
  spoiler: boolean;
};

// Pending consent/queue state is not proof of publication. A verified receipt
// must describe this exact local revision, with an unambiguous remote identity.
export function linkedReviewSource(
  review: ReviewSourceInput,
  receipts: readonly SyncReceipt[],
  deleted: (userId: number, entryId: string) => boolean
): { syncedToLetterboxd?: true; externalUrl?: string } {
  if (review.source !== 'local') return {};
  const matches = receipts.filter(
    (r) => r.userId === review.userId && r.originId === review.id
  );
  if (matches.length !== 1) return {};
  const r = matches[0];
  if (
    !r.verifiedAt ||
    !Number.isFinite(r.verifiedAt) ||
    !r.baseline ||
    r.baseline.rating !== review.rating ||
    r.baseline.text !== review.text ||
    r.baseline.spoiler !== review.spoiler
  )
    return {};
  try {
    if (
      letterboxdEntryIdentity(r.entryId) !== r.entryId ||
      new URL(r.entryId).pathname.split('/')[1] !== r.account ||
      receipts.some(
        (other) =>
          other.userId === r.userId &&
          other.entryId === r.entryId &&
          other.originId !== r.originId && !isBoundDiaryPair(other, r)
      ) ||
      deleted(review.userId, r.entryId)
    )
      return {};
  } catch {
    return {};
  }
  return { syncedToLetterboxd: true, externalUrl: r.entryId };
}
