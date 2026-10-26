import type { WriteState } from './letterboxdWriteQueue';
import { publicationIsSettled } from './letterboxdPublicationPlan';

export function reviewSyncInProgress(
  review: { id: string; userId: number; source: string; mediaType: string; syncToLetterboxd?: boolean; updatedAt: string; rating: number | null; text: string; spoiler: boolean; watchedDate?: string | null; externalEntryId?: string | null; viewingEventId?: string | null },
  state: WriteState,
  viewerId: number | undefined,
  now = Date.now()
): boolean {
  const setting = state.settings[review.userId];
  if (viewerId !== review.userId || review.source !== 'local' ||
      review.mediaType !== 'movie' || !review.syncToLetterboxd ||
      !setting?.enabled) return false;
  if (publicationIsSettled(state, review, setting.account)) return false;
  const intent = state.intents.filter(i =>
    i.userId === review.userId && i.account === setting.account &&
    i.originEntityId === review.id &&
    i.desired.rating === review.rating &&
    (i.kind === 'rating' ? !review.text :
      i.desired.text === review.text && i.desired.spoiler === review.spoiler)
  ).sort((a,b) => b.created - a.created)[0];
  if (intent) return intent.state === 'queued' || intent.state === 'dispatched';
  // Persisted opted-in revisions are the outbox, including time spent waiting
  // for a browser baseline. Refreshing must not erase pending work after debounce.
  // An older uncertain write for this entry still needs admin reconciliation.
  if (state.intents.some(i => i.userId === review.userId &&
      i.account === setting.account && i.originEntityId === review.id &&
      ['unknown', 'conflict'].includes(i.state))) return false;
  const updated = Date.parse(review.updatedAt);
  return Number.isFinite(updated) && updated <= now &&
    Number.isFinite(setting.enabledSince) && updated >= setting.enabledSince!;
}

export function reviewPublishingEnabled(
  userId: number,
  mediaType: string,
  account: { enabled: boolean; username: string } | null,
  setting: { enabled: boolean; account: string } | undefined
): boolean {
  return (
    Number.isSafeInteger(userId) && userId > 0 &&
    mediaType === 'movie' &&
    account?.enabled === true &&
    setting?.enabled === true &&
    setting.account === account.username
  );
}
export function reviewPublishingPreference(
  input: unknown,
  old: { syncToLetterboxd?: boolean } | null,
  eligible: boolean
): boolean {
  if (input !== undefined && typeof input !== 'boolean')
    throw Error('syncToLetterboxd must be a boolean');
  if (input === true && !eligible)
    throw Error('Letterboxd publishing is not enabled');
  return input === undefined ? old?.syncToLetterboxd === true : input;
}
export function cancelQueuedReviewWrites(
  state: WriteState,
  userId: number,
  reviewId: string,
  preserveDiary = false
) {
  for (const intent of state.intents) {
    if (
      intent.userId === userId &&
      intent.originEntityId === reviewId &&
      ['rating', 'review', 'diary'].includes(intent.kind) &&
      !(preserveDiary && intent.kind === 'diary') &&
      intent.state === 'queued'
    )
      intent.state = 'cancelled';
  }
}
export function cancelUnpublishableReviewWrites(
  state: WriteState,
  userId: number,
  reviews: Map<
    string,
    {
      userId: number;
      source: string;
      mediaType: string;
      syncToLetterboxd: boolean;
    }
  >
) {
  for (const intent of state.intents) {
    if (
      intent.userId !== userId ||
      intent.state !== 'queued' ||
      !(['rating', 'review'].includes(intent.kind) || (intent.kind==='diary'&&intent.originEntityId?.startsWith('local:')))
    )
      continue;
    const review = intent.originEntityId
      ? reviews.get(intent.originEntityId)
      : undefined;
    if (
      !review ||
      review.userId !== userId ||
      review.source !== 'local' ||
      review.mediaType !== 'movie' ||
      review.syncToLetterboxd !== true
    )
      intent.state = 'cancelled';
  }
}
