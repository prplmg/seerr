import { getLetterboxdRating } from '@server/api/rating/letterboxd';
import { getRepository } from '@server/datasource';
import { LetterboxdAccount, MovieReview } from '@server/entity/MovieReview';
import { appDataPath } from '@server/utils/appDataVolume';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { letterboxdEntryIdentity } from './letterboxdImport';
import { findObservation, readObservations } from './letterboxdObservations';
import {
  latestVerifiedPublicationAt,
  planReviewPublication,
  publicationAlreadyRecorded,
  samePublicationRevision,
  verifiedRatingBaseline,
  publicationIsSettled,
  recordCurrentPublication,
  publicationObservationAfter,
} from './letterboxdPublicationPlan';
import { prepareLetterboxdPublications as prepare } from './letterboxdPublishing';
import type { ReviewFields } from './letterboxdReconcile';
import { readSyncReceipts, recordSyncReceipt } from './letterboxdSyncReceipts';
import { matchWatchlistFilm } from './letterboxdWatchlistMatch';
import {
  enqueueWrite,
  readWriteState,
  setPreparationFailure,
  updateWriteState,
} from './letterboxdWriteQueue';
import { reviewDiaryIntent } from './reviewDiaryPublication';
import { newUnboundReview } from './reviewPublicationTarget';
import { withReviewLock } from './reviews';
import { prepareManualWatched } from './manualWatched';

type Ticket = {
  local: MovieReview;
  enabledSince: number;
  observationId: string;
};
type Batch = { version: 1; tickets: Ticket[]; cursor?: string };
const filename = (userId: number) =>
  path.join(
    appDataPath(),
    userId === 1
      ? 'letterboxd-publication-continuation.json'
      : `letterboxd-publication-continuation-${userId}.json`
  );
function readBatch(userId: number): Batch {
  try {
    const value = JSON.parse(
      fs.readFileSync(filename(userId), 'utf8')
    ) as Batch;
    if (
      value.version !== 1 ||
      !Array.isArray(value.tickets) ||
      (value.cursor !== undefined && typeof value.cursor !== 'string') ||
      value.tickets.length > 2
    )
      throw Error('Invalid publication continuation');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, tickets: [] };
    throw error;
  }
}
function saveBatch(userId: number, batch: Batch) {
  const file = filename(userId);
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(batch), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
const fields = (r: ReviewFields): ReviewFields => ({
  rating: r.rating,
  text: r.text,
  spoiler: r.spoiler,
});
const equal = (a: ReviewFields, b: ReviewFields) =>
  JSON.stringify(fields(a)) === JSON.stringify(fields(b));
const sameScheduledReview = (a: MovieReview, b: MovieReview | null) =>
  samePublicationRevision(a, b) &&
  a.userId === b?.userId &&
  a.tmdbId === b?.tmdbId &&
  a.mediaType === b?.mediaType;
let running = false;

/** Explicit saves are the durable outbox; no debounce is needed. */
async function prepareForUser(userId: number) {
  if (running) return { queued: 0, issues: [], pending: true };
  running = true;
  try {
    // Do not replace an in-flight observation ticket with a new broad scan.
    if (readBatch(userId).tickets.length)
      return { queued: 0, issues: [], pending: true };
    // Snapshot before scanning: edits/new reviews during or after a scheduled run
    // cannot hitch a ride on its asynchronous observation results.
    const setting = { ...readWriteState().settings[userId] };
    const accountName = setting.account;
    const allCandidates =
      setting.enabled && accountName
        ? await getRepository(MovieReview).findBy({
            userId,
            source: 'local',
            mediaType: 'movie',
            syncToLetterboxd: true,
          })
        : [];
    const receipts = readSyncReceipts();
    const eligible = allCandidates
      .filter(
        (r) =>
          !r.id.startsWith('watched:') &&
          Date.parse(r.updatedAt) <= Date.now() &&
          !publicationIsSettled(readWriteState(), r, accountName) &&
          (Date.parse(r.updatedAt) >= (setting.enabledSince ?? Infinity) ||
            receipts.some(
              (receipt) =>
                receipt.userId === userId &&
                receipt.account === accountName &&
                receipt.originId === r.id &&
                receipt.baseline
            ))
      )
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const previousCursor = readBatch(userId).cursor;
    const start = previousCursor
      ? eligible.findIndex((r) => r.id > previousCursor)
      : 0;
    const offset = start < 0 ? 0 : start;
    const candidates = [
      ...eligible.slice(offset),
      ...eligible.slice(0, offset),
    ].slice(0, 2);
    const cursor = candidates.at(-1)?.id ?? previousCursor;
    // Persist progress before work, including held/current candidates and restarts.
    saveBatch(userId, { version: 1, tickets: [], cursor });
    const report = await prepare(candidates.map((r) => r.id));
    const tickets: Ticket[] = [];
    for (const issue of report.issues) {
      if (tickets.length >= Math.max(0, 2 - report.queued)) break;
      if (
        issue.userId !== userId ||
        issue.reason !== 'needs-baseline' ||
        !setting.enabledSince
      )
        continue;
      const local = candidates.find((r) => r.id === issue.originEntityId);
      if (!local) continue;
      const receipt = readSyncReceipts().find(
        (r) => r.userId === userId && r.originId === local.id
      );
      const imported = await getRepository(MovieReview).findBy({
        userId,
        tmdbId: local.tmdbId,
        mediaType: 'movie',
        source: 'letterboxd',
      });
      const entries = imported.filter(
        (r) => r.externalUrl && letterboxdEntryIdentity(r.externalUrl)
      );
      const creating = newUnboundReview(local, receipt);
      if (
        (!receipt &&
          !local.externalEntryId &&
          !creating &&
          entries.length > 1) ||
        (receipt && receipt.account !== accountName)
      )
        continue;
      const entryId =
        receipt?.entryId ||
        local.externalEntryId ||
        (!creating && entries[0]?.externalUrl
          ? letterboxdEntryIdentity(entries[0].externalUrl)
          : undefined) ||
        undefined;
      const url = entryId || (await getLetterboxdRating(local.tmdbId))?.url;
      const film = url
        ? new URL(url).pathname.split('/')[entryId ? 3 : 2]
        : undefined;
      const request = readObservations()
        .requests.filter(
          (r) =>
            r.userId === userId &&
            r.account === accountName &&
            r.film === film &&
            r.entryId === entryId &&
            !!r.createNew === creating
        )
        .sort((a, b) => b.requestedAt - a.requestedAt)[0];
      if (!request) continue;
      const fresh = await getRepository(MovieReview).findOneBy({
        id: local.id,
        userId,
      });
      if (sameScheduledReview(local, fresh))
        tickets.push({
          local,
          enabledSince: setting.enabledSince,
          observationId: request.id,
        });
    }
    saveBatch(userId, { version: 1, tickets, cursor });
    if (report.queued + tickets.length < 2)
      report.queued += (await prepareManualWatched(userId, allCandidates, 2 - report.queued - tickets.length)) || 0;
    return { ...report, pending: eligible.length > 0 };
  } finally {
    running = false;
  }
}

/** Called after durable reports AND on polls, so a lost response/restart is safe. */
async function continueForUser(userId: number) {
  if (running) return;
  running = true;
  try {
    await withReviewLock(userId, async () => {
      const batch = readBatch(userId);
      for (const ticket of [...batch.tickets]) {
        const retire = () => {
          batch.tickets = batch.tickets.filter((t) => t !== ticket);
          saveBatch(userId, batch);
        };
        const state = readWriteState();
        const setting = state.settings[userId];
        const accountName = setting?.account;
        const local = await getRepository(MovieReview).findOneBy({
          id: ticket.local.id,
          userId,
        });
        const { exportPublicationHeld, exportReviewBaseline } =
          await import('./letterboxdExportPolicy');
        if (local && (await exportPublicationHeld(userId, local.id))) {
          retire();
          continue;
        }
        const account = await getRepository(LetterboxdAccount).findOneBy({
          userId,
        });
        if (
          !setting?.enabled ||
          setting.enabledSince !== ticket.enabledSince ||
          !account?.enabled ||
          account.username !== accountName ||
          local?.mediaType !== 'movie' ||
          local.source !== 'local' ||
          local.syncToLetterboxd !== true
        ) {
          retire();
          continue;
        }
        // Refresh content only. Changing a viewing/entry target requires a new
        // admission; an in-flight creation never turns into an invented edit.
        if (ticket.local.externalEntryId !== local.externalEntryId ||
            ticket.local.watchedDate !== local.watchedDate ||
            ticket.local.viewingEventId !== local.viewingEventId ||
            ticket.local.tmdbId !== local.tmdbId ||
            !!ticket.local.text.trim() !== !!local.text.trim()) {
          retire(); continue;
        }
        ticket.local = { ...local };
        saveBatch(userId, batch);
        if (
          state.intents.some(
            (i) =>
              i.userId === userId &&
              i.originEntityId === local.id &&
              ['queued', 'dispatched', 'unknown', 'conflict'].includes(i.state)
          )
        )
          continue;
        const request = readObservations().requests.find(
          (r) => r.id === ticket.observationId
        );
        if (
          !request ||
          request.userId !== userId ||
          request.account !== accountName
        ) {
          retire();
          continue;
        }
        const receipt = readSyncReceipts().find(
          (r) => r.userId === userId && r.originId === local.id
        );
        if (
          receipt &&
          (receipt.account !== accountName ||
            request.entryId !== receipt.entryId)
        ) {
          retire();
          continue;
        }
        const observation = findObservation(
          readObservations(),
          request,
          publicationObservationAfter(state, userId, accountName, request.film, receipt?.verifiedAt)
        );
        if (!observation) {
          if (Date.now() - request.requestedAt > 5 * 60 * 1000) retire();
          continue;
        }
        const match = await matchWatchlistFilm(request.film);
        if (match?.tmdbId !== local.tmdbId || match.mediaType !== 'movie') {
          retire();
          continue;
        }
        const imported = await getRepository(MovieReview).findBy({
          userId,
          tmdbId: local.tmdbId,
          mediaType: 'movie',
          source: 'letterboxd',
        });
        const entries = imported.filter(
          (r) => r.externalUrl && letterboxdEntryIdentity(r.externalUrl)
        );
        const creating = newUnboundReview(local, receipt);
        if (
          !receipt &&
          !local.externalEntryId &&
          !creating &&
          entries.length > 1
        ) {
          retire();
          continue;
        }
        if (
          !receipt &&
          !creating &&
          (local.externalEntryId ||
            (entries[0]?.externalUrl
              ? letterboxdEntryIdentity(entries[0].externalUrl)
              : undefined)) !== request.entryId
        ) {
          retire();
          continue;
        }
        const remote = entries.find(
          (r) =>
            letterboxdEntryIdentity(r.externalUrl!) ===
            (receipt?.entryId || request.entryId)
        );
        const summaries = imported.filter((r) => r.entryKind === 'summary');
        if (!remote && summaries.length > 1) {
          retire();
          continue;
        }
        let base =
          receipt?.baseline ??
          verifiedRatingBaseline(
            state.intents,
            userId,
            accountName,
            local.id
          ) ??
          (remote
            ? fields(remote)
            : !receipt && summaries[0]
              ? fields(summaries[0])
              : null);
        base =
          (await exportReviewBaseline(
            userId,
            local.id,
            local.tmdbId,
            receipt?.entryId || request.entryId,
            latestVerifiedPublicationAt(state.intents, userId, local.id)
          )) ?? base;
        const actual = creating
          ? { rating: observation.rating, text: '', spoiler: false }
          : fields(observation);
        if (local.watchedDate && !local.externalEntryId && !receipt) {
          try {
            const diary = reviewDiaryIntent(local, receipt, observation);
            if (diary)
              updateWriteState((s) =>
                enqueueWrite(
                  s,
                  {
                    ...diary,
                    userId,
                    account: accountName,
                    film: request.film,
                  },
                  'local',
                  Date.now()
                )
              );
          } finally {
            retire();
          }
          continue;
        }
        if (creating) base = actual;
        if (receipt?.diaryBaseline && !receipt.baseline) base = actual;
        if (!base) {
          const empty =
            observation.rating === null &&
            !observation.text &&
            !observation.spoiler &&
            !observation.entryId;
          if (!empty && !equal(local, observation)) {
            retire();
            continue;
          }
          base = fields(observation);
        }
        const plan = planReviewPublication(
          local,
          ticket.enabledSince,
          base,
          actual,
          {
            inboundOnly:
              !!receipt?.baseline &&
              Date.parse(local.updatedAt) < ticket.enabledSince,
          }
        );
        // Recheck after every asynchronous lookup, including the five-minute TTL.
        const fresh = await getRepository(MovieReview).findOneBy({
          id: local.id,
          userId,
        });
        const linked = await getRepository(LetterboxdAccount).findOneBy({
          userId,
        });
        const latest = readWriteState().settings[userId];
        if (
          !sameScheduledReview(local, fresh) ||
          !linked?.enabled ||
          linked.username !== accountName ||
          !latest?.enabled ||
          latest.account !== accountName ||
          latest.enabledSince !== ticket.enabledSince ||
          !findObservation(readObservations(), request, observation.observedAt)
        )
          continue;
        if (plan.state === 'publish') {
          if (
            !publicationAlreadyRecorded(state.intents, userId, plan.originId) &&
            !equal(local, plan.desired)
          ) {
            await getRepository(MovieReview).save({
              ...local,
              ...plan.desired,
              updatedAt: local.updatedAt,
            });
          }
          updateWriteState((current) => {
            const active = current.settings[userId];
            if (
              !active?.enabled ||
              active.account !== accountName ||
              active.enabledSince !== ticket.enabledSince
            )
              return;
            if (
              publicationAlreadyRecorded(current.intents, userId, plan.originId)
            )
              return;
            enqueueWrite(
              current,
              {
                userId,
                account: accountName,
                originId: plan.originId,
                originEntityId: local.id,
                kind: !creating && observation.entryId ? 'review' : plan.kind,
                ...(creating && plan.kind === 'review'
                  ? { createNew: true, previousEntryId: observation.entryId }
                  : {}),
                film: request.film,
                entryId: creating ? undefined : observation.entryId,
                expected:
                  (!creating && observation.entryId) || plan.kind === 'review'
                    ? plan.expected
                    : { rating: plan.expected.rating },
                desired:
                  (!creating && observation.entryId) || plan.kind === 'review'
                    ? plan.desired
                    : { rating: plan.desired.rating },
              },
              'local',
              Date.now()
            );
          });
        } else if (plan.state === 'current' && !equal(local, plan.merged)) {
          await getRepository(MovieReview).save({
            ...local,
            ...plan.merged,
            updatedAt: local.updatedAt,
          });
          if (receipt)
            recordSyncReceipt({
              ...receipt,
              baseline: plan.merged,
              echoObserved: true,
            });
        }
        if (plan.state === 'current')
          updateWriteState(s => recordCurrentPublication(s, { ...local, ...plan.merged }, accountName));
        retire();
      }
    });
  } finally {
    running = false;
  }
}

export async function prepareLetterboxdPublications() {
  const report = {
    queued: 0,
    issues: [] as Awaited<ReturnType<typeof prepare>>['issues'],
  };
  for (const [id, setting] of Object.entries(readWriteState().settings)) {
    const userId = Number(id);
    if (!Number.isSafeInteger(userId) || userId < 1 || !setting.enabled)
      continue;
    try {
      const result = await prepareForUser(userId);
      report.queued += result.queued;
      report.issues.push(...result.issues);
      const failed = result.issues.some(
        (i) => i.userId === userId && i.reason !== 'needs-baseline'
      );
      // A pending read or a different candidate in this bounded batch is not
      // proof that an earlier failure resolved. Preserve its original age until
      // all eligible reviews settle (or are removed/opted out).
      if (failed || !result.pending)
        updateWriteState((s) =>
          setPreparationFailure(
            s,
            userId,
            setting.account,
            'review-admission',
            failed
          )
        );
    } catch {
      updateWriteState((s) =>
        setPreparationFailure(
          s,
          userId,
          setting.account,
          'review-admission',
          true
        )
      );
      report.issues.push({
        userId,
        originEntityId: '',
        reason: 'review-preparation-failed',
      });
    }
  }
  return report;
}
export async function continueLetterboxdPublications() {
  for (const id of Object.keys(readWriteState().settings)) {
    const userId = Number(id);
    if (!Number.isSafeInteger(userId) || userId < 1) continue;
    const account = readWriteState().settings[userId]?.account;
    if (!account) continue;
    try {
      await continueForUser(userId);
      updateWriteState((s) =>
        setPreparationFailure(s, userId, account, 'review-continuation', false)
      );
    } catch {
      updateWriteState((s) =>
        setPreparationFailure(s, userId, account, 'review-continuation', true)
      );
    }
  }
}
