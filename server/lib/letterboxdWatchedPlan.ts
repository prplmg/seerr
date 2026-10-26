import { createHash } from 'crypto';
import type { SyncReceipt } from './letterboxdSyncReceipts';
import type { WriteIntent } from './letterboxdWriteQueue';

export type WatchedPublicationInput = {
  event: {
    id: string;
    source: 'local' | 'letterboxd';
    userId: number;
    account: string;
    tmdbId: number;
    film: string;
    occurredAt: number;
    // Resolved in the viewer's timezone upstream, never derived from scan time.
    watchedDate: string | null;
    rewatch: boolean;
  };
  enabledSince: number | null;
  mode?: 'watched' | 'diary';
  receipts: readonly Pick<
    SyncReceipt,
    'userId' | 'account' | 'originId' | 'entryId'
  >[];
  // All states, including unknown/cancelled, not merely pending jobs.
  recordedIntents: readonly Pick<
    WriteIntent,
    'userId' | 'account' | 'originId'
  >[];
  baseline: {
    verified: boolean;
    userId: number;
    account: string;
    tmdbId: number;
    film: string;
    observedAt: number;
    watched: boolean;
    // An event-level reconciliation result, NOT a same-film/date heuristic.
    eventMatch: 'absent' | 'linked' | 'ambiguous';
  } | null;
};

export type WatchedPublicationPlan =
  | { state: 'ignored' | 'recorded' | 'current' | 'held'; reason: string }
  | {
      state: 'publish';
      intent: Omit<WriteIntent, 'id' | 'created' | 'state'>;
    };

/** Pure planning only. The caller must serialize dispatch and recheck baseline. */
export function planWatchedPublication(
  input: WatchedPublicationInput
): WatchedPublicationPlan {
  const { event, enabledSince, baseline } = input;
  const account = event.account.toLowerCase();
  if (event.source !== 'local')
    return { state: 'ignored', reason: 'imported-event' };
  if (enabledSince === null) return { state: 'ignored', reason: 'disabled' };
  if (
    !event.id ||
    event.id.length > 250 ||
    !Number.isSafeInteger(event.userId) ||
    event.userId < 1 ||
    !Number.isSafeInteger(event.tmdbId) ||
    event.tmdbId < 1 ||
    !/^[a-z0-9_]{1,40}$/.test(account) ||
    !/^[a-z0-9-]{1,200}$/.test(event.film) ||
    !Number.isFinite(enabledSince) ||
    enabledSince < 0 ||
    !Number.isFinite(event.occurredAt) ||
    event.occurredAt < 0 ||
    typeof event.rewatch !== 'boolean'
  )
    return { state: 'held', reason: 'invalid-event' };
  if (event.occurredAt < enabledSince)
    return { state: 'ignored', reason: 'historical-event' };
  const date = event.watchedDate;
  if (date === null) return { state: 'ignored', reason: 'undated-event' };
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    return { state: 'held', reason: 'invalid-date' };

  // One identity per actual playback event, independent of scans or mode changes.
  const originId =
    'playback:' +
    createHash('sha256')
      .update(JSON.stringify([event.userId, event.id]))
      .digest('hex');
  const related = [
    ...input.receipts.filter(
      (row) => row.userId === event.userId && row.originId === event.id
    ),
    ...input.recordedIntents.filter(
      (row) => row.userId === event.userId && row.originId === originId
    ),
  ];
  if (related.some((row) => row.account.toLowerCase() !== account))
    return { state: 'held', reason: 'account-changed' };
  if (related.length)
    return { state: 'recorded', reason: 'event-already-recorded' };
  if (
    !baseline ||
    !baseline.verified ||
    baseline.userId !== event.userId ||
    baseline.account.toLowerCase() !== account ||
    baseline.tmdbId !== event.tmdbId ||
    baseline.film !== event.film ||
    !Number.isFinite(baseline.observedAt) ||
    baseline.observedAt < event.occurredAt ||
    typeof baseline.watched !== 'boolean'
  )
    return { state: 'held', reason: 'needs-verified-baseline' };
  if (baseline.eventMatch === 'ambiguous')
    return { state: 'held', reason: 'ambiguous-event' };
  if (baseline.eventMatch === 'linked')
    return { state: 'current', reason: 'remote-event-linked' };
  if (baseline.eventMatch !== 'absent')
    return { state: 'held', reason: 'needs-event-reconciliation' };
  const kind = input.mode ?? 'diary';
  if (kind === 'watched' && baseline.watched)
    return { state: 'current', reason: 'already-watched' };
  return {
    state: 'publish',
    intent: {
      userId: event.userId,
      account,
      originId,
      originEntityId: event.id,
      kind,
      film: event.film,
      expected:
        kind === 'diary'
          ? { watchedDate: null, rewatch: false }
          : { watched: false },
      desired:
        kind === 'diary'
          ? { watchedDate: date, rewatch: event.rewatch || baseline.watched }
          : { watched: true },
    },
  };
}
