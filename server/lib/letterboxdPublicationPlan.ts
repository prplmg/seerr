import { createHash } from 'crypto';
import type { ReviewFields } from './letterboxdReconcile';
import { reconcileLetterboxdReview } from './letterboxdReconcile';
import type { WriteIntent, WriteState } from './letterboxdWriteQueue';
type LocalReview = ReviewFields & {
  id: string;
  updatedAt: string;
  source: 'local' | 'letterboxd';
  syncToLetterboxd?: boolean;
};
type PublicationReview = ReviewFields & {
  id: string; updatedAt: string;
  userId: number; externalEntryId?: string | null;
  watchedDate?: string | null; viewingEventId?: string | null;
};
const settledKey = (r: PublicationReview, account: string) => JSON.stringify([r.userId, account, r.id]);
const revisionKey = (r: PublicationReview) => createHash('sha256').update(JSON.stringify([
  r.updatedAt, r.rating, r.text, r.spoiler, r.externalEntryId ?? null,
  r.watchedDate ?? null, r.viewingEventId ?? null,
])).digest('hex');
export function recordCurrentPublication(state: WriteState, r: PublicationReview, account: string) {
  (state.settledReviews ??= {})[settledKey(r, account)] = revisionKey(r);
}
export function publicationIsSettled(state: WriteState, r: PublicationReview, account: string) {
  if (state.settledReviews?.[settledKey(r, account)] === revisionKey(r)) return true;
  return state.intents.some(i => i.userId === r.userId && i.account === account &&
    i.originEntityId === r.id && ['rating', 'review', 'diary'].includes(i.kind) && i.state === 'verified' && i.created >= Date.parse(r.updatedAt) &&
    i.desired.rating === r.rating &&
    (i.kind === 'rating' ? !r.text && !r.watchedDate :
      i.desired.text === r.text && i.desired.spoiler === r.spoiler) &&
    (!r.externalEntryId || i.entryId === r.externalEntryId) &&
    (!r.watchedDate || i.kind !== 'diary' || i.desired.watchedDate === r.watchedDate));
}
// A local text/rating edit does not invalidate a scoped remote observation.
// Any intervening verified write to the film does, including another entry.
export function publicationObservationAfter(state: WriteState, userId: number, account: string, film: string, receiptAt = 0) {
  return Math.max(state.settings[userId]?.enabledSince ?? 0, receiptAt,
    ...state.intents.filter(i => i.userId === userId && i.account === account && i.film === film && i.state === 'verified')
      .map(i => i.verifiedAt || i.created));
}
const fields = (r: ReviewFields): ReviewFields => ({
  rating: r.rating,
  text: r.text,
  spoiler: r.spoiler,
});
export function publicationKind(
  expected: ReviewFields,
  desired: ReviewFields
): 'review' | 'rating' {
  return expected.text !== desired.text ||
    expected.spoiler !== desired.spoiler ||
    !!expected.text ||
    !!desired.text
    ? 'review'
    : 'rating';
}
export function samePublicationRevision(a: LocalReview, b: LocalReview | null) {
  return (
    !!b &&
    a.id === b.id &&
    a.source === b.source &&
    a.syncToLetterboxd === b.syncToLetterboxd &&
    a.updatedAt === b.updatedAt &&
    JSON.stringify(fields(a)) === JSON.stringify(fields(b))
  );
}
export function verifiedRatingBaseline(
  intents: WriteIntent[],
  userId: number,
  account: string,
  originEntityId: string
): ReviewFields | null {
  const verified = intents
    .filter(
      (i) =>
        i.userId === userId &&
        i.account === account &&
        i.originEntityId === originEntityId &&
        i.kind === 'rating' &&
        i.state === 'verified'
    )
    .sort((a, b) => b.created - a.created)[0];
  if (!verified) return null;
  const rating = verified.desired.rating;
  if (
    rating !== null &&
    (typeof rating !== 'number' ||
      rating < 0.5 ||
      rating > 5 ||
      !Number.isInteger(rating * 2))
  )
    return null;
  return { rating: rating as number | null, text: '', spoiler: false };
}
export function latestVerifiedPublicationAt(intents: WriteIntent[], userId: number, originId: string) {
  return Math.max(0, ...intents.filter(i => i.userId === userId && i.originEntityId === originId && i.state === 'verified').map(i => i.verifiedAt || i.created));
}
export function publicationAlreadyRecorded(
  intents: WriteIntent[],
  userId: number,
  originId: string
) {
  // Even cancelled/uncertain revisions are never silently recreated by a scan.
  return intents.some((i) => i.userId === userId && i.originId === originId);
}
export function planReviewPublication(
  local: LocalReview,
  enabledSince: number,
  base: ReviewFields | null,
  remote: ReviewFields | null,
  options: { inboundOnly?: boolean } = {}
) {
  if (local.source !== 'local')
    return { state: 'ignored' as const, reason: 'imported' };
  if (local.syncToLetterboxd !== true)
    return { state: 'ignored' as const, reason: 'opted-out' };
  const updated = Date.parse(local.updatedAt);
  if (
    !Number.isFinite(updated) ||
    (updated < enabledSince && !options.inboundOnly)
  )
    return { state: 'ignored' as const, reason: 'historical' };
  // A complete remote read must explicitly establish absence. null does not
  // mean an empty review: it can mean a failed read or deletion.
  const result = reconcileLetterboxdReview(base, local, remote);
  if (result.state !== 'ready') return result;
  if (!result.outgoing)
    return { state: 'current' as const, merged: result.merged };
  if (options.inboundOnly)
    return { state: 'ignored' as const, reason: 'inbound-only-local-changes' };
  const revision = createHash('sha256')
    .update(JSON.stringify([local.id, local.updatedAt, result.merged]))
    .digest('hex');
  return {
    state: 'publish' as const,
    originId: `review:${revision}`,
    originEntityId: local.id,
    kind: publicationKind(remote!, result.merged),
    expected: fields(remote!),
    desired: result.merged,
  };
}
