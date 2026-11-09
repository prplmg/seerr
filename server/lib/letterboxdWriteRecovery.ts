import type { ExportBaseline } from './letterboxdExportTransaction';
import { letterboxdEntryIdentity } from './letterboxdImport';
import {
  requestObservation,
  type ObservationState,
} from './letterboxdObservations';
import type { ReviewFields } from './letterboxdReconcile';
import type { SyncReceipt } from './letterboxdSyncReceipts';
import type { WriteState } from './letterboxdWriteQueue';

/** Persisted read-only recovery cadence; never enqueue or repeat a mutation. */
export function prepareWriteRecovery(
  writes: WriteState,
  observations: ObservationState,
  now = Date.now()
) {
  for (const job of writes.intents
    .filter(
      (i) =>
        writes.settings[i.userId]?.enabled === true &&
        writes.settings[i.userId]?.account === i.account &&
        i.state === 'unknown' &&
        i.kind === 'review' &&
        (!i.recovery || (i.recovery.status === 'unavailable' && (i.recovery.nextAttemptAt || 0) <= now))
    )
    .slice(0, 2)) {
    const attempts = (job.recovery?.attempts || (job.recovery ? 1 : 0)) + 1;
    const previous = observations.requests.find(r => r.id === job.recovery?.observationId);
    if (previous) previous.retired = {at:now,reason:'read-only write recovery retry'};
    const request = requestObservation(
      observations,
      {
        userId: job.userId,
        account: job.account,
        film: job.film,
        entryId: job.entryId,
      },
      now
    );
    // A baseline requested before dispatch cannot prove the result of the write.
    if (request.requestedAt < now) continue;
    job.recovery = {
      observationId: request.id,
      requestedAt: now,
      status: 'checking',
      attempts,
    };
  }
}

export function reconcileWriteRecovery(
  writes: WriteState,
  observations: ObservationState,
  saveReceipt: (r: SyncReceipt) => void,
  now = Date.now()
) {
  for (const job of writes.intents) {
    if (
      job.state !== 'unknown' ||
      job.kind !== 'review' ||
      job.recovery?.status !== 'checking'
    )
      continue;
    const request = observations.requests.find(
      (r) => r.id === job.recovery!.observationId
    );
    if (
      !request ||
      request.userId !== job.userId ||
      request.account !== job.account ||
      request.film !== job.film ||
      request.entryId !== job.entryId
    )
      continue;
    if (
      ['unknown', 'ambiguous'].includes(request.state) ||
      now - job.recovery.requestedAt > 10 * 60 * 1000
    ) {
      job.recovery.status = 'unavailable';
      job.recovery.nextAttemptAt = now + Math.min(6 * 60 * 60 * 1000, 15 * 60 * 1000 * 2 ** Math.min(5, (job.recovery.attempts || 1) - 1));
      continue;
    }
    const observed = request.observation;
    if (
      request.state !== 'verified' ||
      !observed ||
      observed.observedAt < job.recovery.requestedAt ||
      now - observed.observedAt > 5 * 60 * 1000
    )
      continue;
    const differences = ['rating', 'text', 'spoiler'].filter(
      (field) => observed[field as keyof ReviewFields] !== job.desired[field]
    );
    if (
      !observed.entryId ||
      (job.entryId && observed.entryId !== job.entryId) ||
      (job.createNew &&
        (!job.previousEntryId || observed.entryId === job.previousEntryId))
    )
      differences.push('entry');
    if (differences.length) {
      job.recovery.status = 'mismatch';
      job.recovery.differingFields = differences;
      continue;
    }
    if (!job.originEntityId) throw Error('Missing recovery origin');
    // Receipt must persist before committing the queue transition, as for writes.
    saveReceipt({
      userId: job.userId,
      account: job.account,
      originId: job.originEntityId,
      entryId: observed.entryId!,
      baseline: job.desired as ReviewFields,
      verifiedAt: observed.observedAt,
      echoObserved: false,
    });
    job.entryId = observed.entryId;
    job.verifiedAt = observed.observedAt;
    job.state = 'verified';
    job.recovery.status = 'verified';
  }
}

/** Daily exports are bounded evidence, not a permanent verification oracle. */
export const DIARY_RECOVERY_EXPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type DiaryRecoveryExport = {
  // Optional delivery IDs selected by the receipt-only exchange branch.
  reconcileIds?: readonly string[];
  // ExportBaseline has no user ID: caller must bind the DB row to this scope.
  userId: number;
  account: string;
  baseline: ExportBaseline & {
    mappings?: Record<string, { externalUrl: string }>;
  };
};

function canonicalDiaryEntry(value: string): string | null {
  try {
    const entry = letterboxdEntryIdentity(value);
    return entry === value ? entry : null;
  } catch {
    return null;
  }
}

/** Pure evidence selection. No reads, network, queue mutation or write retries.
 * Use the committed DB export, including its persisted short-link mappings.
 * A watched-summary row is never a dated diary entry.
 * This proves an entry appeared after the baseline, not who authored it.
 * The committed account-bound export is trusted provenance; an arbitrary
 * uploaded archive with a new download timestamp must not be passed here.
 */
export function planDiaryWriteRecovery(
  writes: WriteState,
  observations: ObservationState,
  evidence: DiaryRecoveryExport,
  now = Date.now()
): { intentId: string; observationId: string; receipt: SyncReceipt }[] {
  const { userId, account, baseline } = evidence;
  const setting = writes.settings[userId];
  const snapshot = baseline.snapshot;
  if (
    !setting?.enabled ||
    setting.account !== account ||
    snapshot.account !== account ||
    snapshot.complete !== true ||
    !baseline.revision ||
    !Number.isFinite(now) ||
    !Number.isFinite(baseline.capturedAt) ||
    baseline.capturedAt <= 0 ||
    baseline.capturedAt > now ||
    now - baseline.capturedAt > DIARY_RECOVERY_EXPORT_MAX_AGE_MS ||
    ['watched.csv', 'ratings.csv', 'diary.csv', 'reviews.csv'].some(
      (name) => !Array.isArray(snapshot.active[name])
    )
  )
    return [];

  const resolve = (row: Record<string, string>) => {
    const uri = row['Letterboxd URI'];
    const direct = canonicalDiaryEntry(uri);
    if (direct) return direct;
    // Never let a mapping rewrite an explicit canonical account/film identity.
    if (!/^https:\/\/boxd\.it\/[a-zA-Z0-9]+\/?$/.test(uri)) return null;
    return canonicalDiaryEntry(baseline.mappings?.[uri]?.externalUrl || '');
  };
  const diary = snapshot.active['diary.csv'].map((row) => ({
    row,
    id: resolve(row),
  }));
  const reviews = snapshot.active['reviews.csv'].map((row) => ({ row, id: resolve(row) }));
  // An unresolved row could be a second candidate; fail closed on the inventory.
  if (
    diary.some(
      ({ id }) => !id || new URL(id).pathname.split('/')[1] !== account
    ) ||
    reviews.some(
      ({ id }) => !id || new URL(id).pathname.split('/')[1] !== account
    ) ||
    new Set(reviews.map(({ id }) => id)).size !== reviews.length ||
    new Set(diary.map(({ id }) => id)).size !== diary.length
  )
    return [];

  const plans: ReturnType<typeof planDiaryWriteRecovery> = [];
  for (const job of writes.intents) {
    if (
      job.userId !== userId ||
      job.account !== account ||
      job.kind !== 'diary' ||
      job.state !== 'unknown' ||
      job.entryId ||
      job.createNew ||
      !job.originEntityId ||
      Object.keys(job.desired).sort().join(',') !== 'rewatch,watchedDate' ||
      Object.keys(job.expected).sort().join(',') !== 'rewatch,watchedDate' ||
      job.expected.watchedDate !== null ||
      typeof job.expected.rewatch !== 'boolean' ||
      typeof job.desired.rewatch !== 'boolean' ||
      typeof job.desired.watchedDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(job.desired.watchedDate) ||
      !Number.isFinite(Date.parse(job.desired.watchedDate)) ||
      new Date(job.desired.watchedDate).toISOString().slice(0, 10) !==
        job.desired.watchedDate ||
      !Number.isFinite(job.created) ||
      baseline.capturedAt <= job.created
    )
      continue;
    const matches = diary.filter(
      ({ id, row }) =>
        new URL(id!).pathname.split('/')[3] === job.film &&
        row['Watched Date'] === job.desired.watchedDate
    );
    if (matches.length !== 1) continue;
    const { row, id } = matches[0];
    const rewatch =
      row.Rewatch === 'Yes' ? true : row.Rewatch === '' ? false : null;
    if (rewatch !== job.desired.rewatch) continue;
    // Reviews decorate diary entries; they do not constitute another viewing.
    // Link only the diary fields, never adopt or overwrite review/rating content.
    const entryReviews = reviews.filter((review) => review.id === id);
    if (
      entryReviews.some(({ row: review }) =>
        review['Watched Date'] !== row['Watched Date'] ||
        review.Rewatch !== row.Rewatch
      ) ||
      reviews.some(({ id: reviewId, row: review }) =>
        reviewId !== id && new URL(reviewId!).pathname.split('/')[3] === job.film &&
        review['Watched Date'] === job.desired.watchedDate
      ) ||
      (row.Review !== undefined && row.Review !== '' && entryReviews.length !== 1)
    ) continue;
    // Use the last pre-write read, not an older convenient baseline. Later
    // recovery failures do not erase the original authenticated inventory.
    const before = observations.requests
      .filter(
        (r) =>
          r.userId === userId &&
          r.account === account &&
          r.film === job.film &&
          !r.entryId &&
          r.requestedAt <= job.created &&
          (!r.observation || r.observation.observedAt <= job.created)
      )
      .sort((a, b) => b.requestedAt - a.requestedAt)[0];
    const observed = before?.observation;
    if (
      before?.state !== 'verified' ||
      !observed ||
      !Number.isFinite(observed.observedAt) ||
      observed.observedAt < before.requestedAt ||
      job.created - observed.observedAt > 5 * 60 * 1000 ||
      observed.diaryEntriesComplete !== true ||
      !Array.isArray(observed.diaryEntryIds) ||
      observed.diaryEntryIds.some(
        (entry) =>
          !canonicalDiaryEntry(entry) ||
          new URL(entry).pathname.split('/')[1] !== account ||
          new URL(entry).pathname.split('/')[3] !== job.film
      ) ||
      new Set(observed.diaryEntryIds).size !== observed.diaryEntryIds.length ||
      observed.diaryEntryIds.includes(id!)
    )
      continue;
    plans.push({
      intentId: job.id,
      observationId: before.id,
      receipt: {
        userId,
        account,
        originId: job.originEntityId,
        entryId: id!,
        diaryBaseline: { watchedDate: job.desired.watchedDate, rewatch },
        verifiedAt: baseline.capturedAt,
        echoObserved: true,
      },
    });
  }
  // One remote entry cannot settle two local writes, even before receipts exist.
  return plans
    .filter(
      (plan) =>
        (!evidence.reconcileIds ||
          evidence.reconcileIds.includes(plan.intentId)) &&
        plans.filter((other) => other.receipt.entryId === plan.receipt.entryId)
          .length === 1
    )
    .slice(0, 2);
}

/** Call inside the synchronous queue update under the user's review lock.
 * saveReceipt must durably persist (and enforce receipt identity conflicts)
 * synchronously; a persistence error leaves this intent untouched.
 */
export function reconcileDiaryWriteRecovery(
  writes: WriteState,
  observations: ObservationState,
  evidence: DiaryRecoveryExport,
  saveReceipt: (receipt: SyncReceipt) => void,
  now = Date.now()
): string[] {
  const plans = planDiaryWriteRecovery(writes, observations, evidence, now);
  for (const plan of plans) {
    const job = writes.intents.find((i) => i.id === plan.intentId)!;
    saveReceipt(plan.receipt);
    job.entryId = plan.receipt.entryId;
    job.verifiedAt = plan.receipt.verifiedAt;
    job.state = 'verified';
    job.recovery = {
      observationId: plan.observationId,
      requestedAt: now,
      status: 'verified',
    };
  }
  return plans.map((plan) => plan.intentId);
}
