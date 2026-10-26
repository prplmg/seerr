import {
  requestObservation,
  type ObservationState,
} from './letterboxdObservations';
import type { ReviewFields } from './letterboxdReconcile';
import type { SyncReceipt } from './letterboxdSyncReceipts';
import type { WriteState } from './letterboxdWriteQueue';

/** One bounded read-only recovery per uncertain review. Never enqueue a write. */
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
        !i.recovery
    )
    .slice(0, 2)) {
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
    if (!observed.entryId || (job.entryId && observed.entryId !== job.entryId) ||
        (job.createNew && (!job.previousEntryId || observed.entryId===job.previousEntryId)))
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
