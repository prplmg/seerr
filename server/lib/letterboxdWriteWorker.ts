import {
  evidenceFromVerifiedWrite,
  readFilmEvidence,
  recordFilmEvidence,
} from './letterboxdFilmEvidence';
import {
  claimObservation,
  readObservations,
  reportObservation,
  updateObservations,
  type ObservationReport,
  type ObservationState,
} from './letterboxdObservations';
import type { ReviewFields } from './letterboxdReconcile';
import {
  boundPlaybackOrigin,
  readSyncReceipts,
  recordSyncReceipt,
  type SyncReceipt,
} from './letterboxdSyncReceipts';
import {
  claimWrite,
  finishWrite,
  readWriteState,
  updateWriteState,
  type WriteState,
} from './letterboxdWriteQueue';
import {
  prepareWriteRecovery,
  reconcileWriteRecovery,
} from './letterboxdWriteRecovery';
import { cancelUnpublishableReviewWrites } from './reviewPublishingPolicy';

const writeKinds = [
  'rating',
  'review',
  'watched',
  'diary',
  'diary-content',
] as const;
type SupportedKind = (typeof writeKinds)[number];
export function parseSupportedWriteKinds(value: unknown): SupportedKind[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > writeKinds.length ||
    new Set(value).size !== value.length ||
    value.some((kind) => !writeKinds.includes(kind))
  )
    throw Error('Invalid supported write kinds');
  return value;
}

export function parseSupportedObservations(value: unknown): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 1 ||
    value.some((v) => v !== 'review_observe')
  )
    throw Error('Invalid observation capabilities');
  return value;
}
type ObservationBinding = Parameters<typeof exchangeWriteState>[1];
export function exchangeObservationState(
  state: ObservationState,
  binding: ObservationBinding,
  report?: ObservationReport,
  supported: unknown = []
) {
  const capabilities = parseSupportedObservations(supported);
  if (
    !Number.isSafeInteger(binding.userId) ||
    binding.userId < 1 ||
    !/^[a-z0-9_]{1,40}$/i.test(binding.username)
  )
    throw Error('Invalid account binding');
  if (report) {
    if (report.userId !== binding.userId || report.account !== binding.username)
      throw Error('Observation identity mismatch');
    reportObservation(state, report);
    return { action: 'idle' };
  }
  if (
    !capabilities.length ||
    !binding.enabled ||
    binding.issue ||
    ['queued', 'running'].includes(binding.job?.state || '')
  )
    return { action: 'idle' };
  const job = claimObservation(state, {
    userId: binding.userId,
    account: binding.username,
  });
  return job
    ? {
        action: 'review_observe',
        instance: binding.instance,
        id: job.id,
        userId: job.userId,
        account: job.account,
        film: job.film,
        entryId: job.entryId,
        ...(job.createNew ? { createNew: true } : {}),
        claimToken: job.claimToken,
        claimedAt: job.claimedAt,
      }
    : { action: 'idle' };
}
export async function exchangeObservations(
  instance: string,
  report?: ObservationReport,
  supported: unknown = []
) {
  const { getRepository } = await import('@server/datasource');
  const { LetterboxdAccount } = await import('@server/entity/MovieReview');
  const { readBrowserState } = await import('./letterboxdBrowser');
  const binding = readBrowserState().bindings.find(
    (b) => b.instance === instance
  );
  if (!binding) throw Error('Unknown account binding');
  const linked = await getRepository(LetterboxdAccount).findOneBy({
    userId: binding.userId,
  });
  if (!linked?.enabled || linked.username !== binding.username)
    throw Error('Account changed');
  if (
    !report &&
    binding.enabled &&
    !binding.issue &&
    readWriteState().intents.some(
      (i) => i.state === 'unknown' && i.kind === 'review' && !i.recovery
    )
  ) {
    updateWriteState((writes) =>
      updateObservations((observations) =>
        prepareWriteRecovery(writes, observations)
      )
    );
  }
  const result = updateObservations((state) =>
    exchangeObservationState(state, binding, report, supported)
  );
  if (
    readWriteState().intents.some(
      (i) => i.state === 'unknown' && i.recovery?.status === 'checking'
    )
  )
    updateWriteState((writes) =>
      reconcileWriteRecovery(writes, readObservations(), recordSyncReceipt)
    );
  if (!report || report.status === 'verified')
    await continueScheduledPublications(binding);
  const writes = readWriteState();
  const recovered = report
    ? writes.intents
        .filter(
          (i) =>
            i.userId === binding.userId &&
            i.account === binding.username &&
            i.state === 'verified' &&
            i.recovery?.observationId === report.id &&
            i.recovery.status === 'verified'
        )
        .map((i) => ({ id: i.id, values: i.desired, entryId: i.entryId }))
    : [];
  // Reuse the verified acknowledgement projection after read-only recovery.
  // The intent is already verified, so this cannot dispatch or repeat a write.
  for (const recoveredWrite of recovered) {
    await exchangeWrites(instance, {
      ...recoveredWrite,
      outcome: 'verified',
      identity: binding.username,
    });
  }
  return {
    ...result,
    recovered,
    resumeWrites:
      recovered.length > 0 &&
      writes.settings[binding.userId]?.enabled === true &&
      !writes.intents.some(
        (i) =>
          i.userId === binding.userId &&
          ['unknown', 'conflict', 'dispatched'].includes(i.state)
      ),
  };
}

async function continueScheduledPublications(binding: ObservationBinding) {
  if (
    !binding.enabled ||
    binding.issue ||
    ['queued', 'running'].includes(binding.job?.state || '')
  )
    return;
  const { continueLetterboxdPublications, prepareLetterboxdPublications } =
    await import('./letterboxdPublicationContinuation');
  await continueLetterboxdPublications();
  await prepareLetterboxdPublications();
  const {
    continueLetterboxdPlaybackPublications,
    prepareLetterboxdPlaybackPublications,
  } = await import('./letterboxdPlaybackContinuation');
  await continueLetterboxdPlaybackPublications();
  await prepareLetterboxdPlaybackPublications();
}

// Receipt persistence precedes the queue commit. If either write fails, replay
// records the same identity again; no remote action is dispatched twice.
export function exchangeWriteState(
  state: WriteState,
  binding: {
    instance: string;
    userId: number;
    username: string;
    enabled: boolean;
    issue?: unknown;
    job?: { state: string };
  },
  report: Parameters<typeof finishWrite>[3] | undefined,
  saveReceipt: (receipt: SyncReceipt) => void = recordSyncReceipt,
  supported: unknown = [],
  durableDelivery = false
) {
  const kinds = parseSupportedWriteKinds(supported);
  if (
    !Number.isSafeInteger(binding.userId) ||
    binding.userId < 1 ||
    !/^[a-z0-9_]{1,40}$/i.test(binding.username)
  )
    throw Error('Invalid account binding');
  if (report) {
    const changed = finishWrite(
      state,
      binding.userId,
      binding.username,
      report
    );
    const job = state.intents.find((i) => i.id === report.id)!;
    if (
      changed &&
      report.outcome === 'verified' &&
      ['review', 'diary'].includes(job.kind)
    ) {
      if (!job.originEntityId) throw Error('Missing local entry identity');
      saveReceipt({
        userId: job.userId,
        account: job.account,
        originId: job.originEntityId,
        entryId: job.entryId!,
        ...(job.kind === 'review'
          ? { baseline: job.desired as ReviewFields }
          : {
              diaryBaseline: {
                watchedDate: job.desired.watchedDate as string,
                rewatch: job.desired.rewatch as boolean,
              },
              ...('rating' in job.desired
                ? {
                    baseline: {
                      rating: job.desired.rating as number | null,
                      text: job.desired.text as string,
                      spoiler: job.desired.spoiler as boolean,
                    },
                  }
                : {}),
            }),
        verifiedAt: Date.now(),
        echoObserved: false,
      });
    }
    return { action: 'idle' };
  }
  if (
    !binding.enabled ||
    binding.issue ||
    ['queued', 'running'].includes(binding.job?.state || '')
  )
    return { action: 'idle' };
  const job = claimWrite(
    state,
    binding.userId,
    binding.username,
    kinds,
    durableDelivery
  );
  if (job && ['review', 'diary'].includes(job.kind) && !job.originEntityId)
    throw Error('Missing local entry identity');
  return job
    ? { action: 'media_write', instance: binding.instance, ...job }
    : { action: 'idle' };
}
export async function exchangeWrites(
  instance: string,
  report?: Parameters<typeof finishWrite>[3],
  supported: unknown = [],
  durableDelivery = false
) {
  const { getRepository } = await import('@server/datasource');
  const { LetterboxdAccount, MovieReview } =
    await import('@server/entity/MovieReview');
  const { withReviewLock } = await import('./reviews');
  const { readBrowserState } = await import('./letterboxdBrowser');
  const binding = readBrowserState().bindings.find(
    (b) => b.instance === instance
  );
  if (!binding) throw Error('Unknown account binding');
  const result = await withReviewLock(binding.userId, async () => {
    const linked = await getRepository(LetterboxdAccount).findOneBy({
      userId: binding.userId,
    });
    if (!linked?.enabled || linked.username !== binding.username)
      throw Error('Account changed');
    const reviews = new Map<string, InstanceType<typeof MovieReview>>();
    if (!report)
      for (const intent of readWriteState().intents) {
        if (
          intent.userId !== binding.userId ||
          intent.state !== 'queued' ||
          !(
            ['rating', 'review'].includes(intent.kind) ||
            (intent.kind === 'diary' &&
              intent.originEntityId?.startsWith('local:'))
          ) ||
          !intent.originEntityId
        )
          continue;
        const review = await getRepository(MovieReview).findOneBy({
          id: intent.originEntityId,
          userId: binding.userId,
        });
        const { exportPublicationHeld } =
          await import('./letterboxdExportPolicy');
        if (review && !(await exportPublicationHeld(binding.userId, review.id)))
          reviews.set(review.id, review);
      }
    let boundDiaryOriginId: string | undefined;
    if (report?.outcome === 'verified') {
      const intent = readWriteState().intents.find((i) => i.id === report.id);
      if (intent?.kind === 'review' && intent.originEntityId) {
        const local = await getRepository(MovieReview).findOneBy({
          id: intent.originEntityId,
          userId: binding.userId,
        });
        boundDiaryOriginId = boundPlaybackOrigin(
          readSyncReceipts(),
          binding.userId,
          binding.username,
          intent.entryId,
          local
        );
      }
    }
    const exchange = updateWriteState((state) => {
      if (!report)
        cancelUnpublishableReviewWrites(state, binding.userId, reviews);
      return exchangeWriteState(
        state,
        binding,
        report,
        (receipt) =>
          recordSyncReceipt({
            ...receipt,
            ...(boundDiaryOriginId ? { boundDiaryOriginId } : {}),
          }),
        supported,
        durableDelivery
      );
    });
    // Replayed acknowledgements also repair a crash between queue persistence
    // and the catalogue projection. No additional browser mutation is involved.
    if (report?.outcome === 'verified') {
      const intent = readWriteState().intents.find(
        (i) => i.id === report.id && i.state === 'verified'
      );
      let evidence =
        intent?.verifiedAt &&
        evidenceFromVerifiedWrite(
          intent,
          intent.verifiedAt,
          readFilmEvidence().find(
            (e) =>
              e.userId === intent.userId &&
              e.account === intent.account &&
              e.film === intent.film
          )
        );
      if (evidence && intent?.originEntityId) {
        const { LetterboxdExportBaseline } =
          await import('@server/entity/LetterboxdExport');
        const snapshot = await getRepository(
          LetterboxdExportBaseline
        ).findOneBy({ userId: binding.userId });
        if (
          snapshot &&
          JSON.parse(snapshot.value).capturedAt >= evidence.observedAt
        )
          return exchange;
        let local: { tmdbId: number; mediaType: 'movie' | 'tv' } | null =
          await getRepository(MovieReview).findOneBy({
            id: intent.originEntityId,
            userId: binding.userId,
          });
        if (!local && ['watched', 'diary'].includes(intent.kind)) {
          const fs = await import('fs'),
            path = await import('path');
          const { appDataPath } = await import('@server/utils/appDataVolume');
          for (const filename of [
            'letterboxd-playback-events.json',
            'letterboxd-party-playback-events.json',
          ]) {
            try {
              const store = JSON.parse(
                fs.readFileSync(path.join(appDataPath(), filename), 'utf8')
              );
              if (store.version !== 1 || !Array.isArray(store.events))
                throw Error('Invalid playback evidence store');
              const event = store.events.find(
                (e: {
                  id: string;
                  userId: number;
                  account: string;
                  tmdbId: number;
                }) =>
                  e.id === intent.originEntityId &&
                  e.userId === binding.userId &&
                  e.account === binding.username
              );
              if (
                event &&
                Number.isSafeInteger(event.tmdbId) &&
                event.tmdbId > 0
              )
                local = { tmdbId: event.tmdbId, mediaType: 'movie' };
            } catch (error) {
              if (error.code !== 'ENOENT') throw error;
            }
          }
        }
        if (local) {
          const repo = getRepository(MovieReview);
          const id = `letterboxd:${binding.userId}:${local.mediaType}:${local.tmdbId}:summary`;
          const old = await repo.findOneBy({ id });
          if (old && Date.parse(old.updatedAt) > evidence.observedAt)
            return exchange;
          evidence = evidenceFromVerifiedWrite(
            intent,
            intent.verifiedAt!,
            old ? { watched: old.watched, rating: old.rating } : undefined
          )!;
          await repo.save(
            repo.create({
              ...old,
              id,
              userId: binding.userId,
              tmdbId: local.tmdbId,
              mediaType: local.mediaType,
              source: 'letterboxd',
              entryKind: 'summary',
              watched: evidence.watched,
              rating: evidence.rating,
              text: '',
              spoiler: false,
              watchedDate: null,
              publishedAt:
                old?.publishedAt || new Date(evidence.observedAt).toISOString(),
              updatedAt: new Date(evidence.observedAt).toISOString(),
              externalUrl: `https://letterboxd.com/film/${intent.film}/`,
            })
          );
          recordFilmEvidence(evidence);
        }
      }
    }
    return exchange;
  });
  // Continuation acquires the same review lock; run only after the receipt and
  // write-state transaction has committed and released it. Polls also recover
  // a process crash between that commit and continuation.
  if (report?.outcome === 'verified') {
    const verified = readWriteState().intents.find(
      (i) => i.id === report.id && i.state === 'verified'
    );
    if (verified?.verifiedAt) {
      const { refreshReviewsAfterPublication } = await import('./reviews');
      refreshReviewsAfterPublication(binding.userId, verified.verifiedAt);
    }
  }
  if (!report || report.outcome === 'verified')
    await continueScheduledPublications(binding);
  return result;
}
