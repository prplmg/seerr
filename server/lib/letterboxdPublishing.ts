import { getLetterboxdRating } from '@server/api/rating/letterboxd';
import { getRepository } from '@server/datasource';
import { LetterboxdAccount, MovieReview } from '@server/entity/MovieReview';
import { letterboxdEntryIdentity } from './letterboxdImport';
import {
  findObservation,
  readObservations,
  requestObservation,
  updateObservations,
} from './letterboxdObservations';
import {
  planReviewPublication,
  publicationAlreadyRecorded,
  samePublicationRevision,
  verifiedRatingBaseline,
  latestVerifiedPublicationAt,
  publicationIsSettled,
  recordCurrentPublication,
  publicationObservationAfter,
} from './letterboxdPublicationPlan';
import type { ReviewFields } from './letterboxdReconcile';
import { readSyncReceipts, recordSyncReceipt } from './letterboxdSyncReceipts';
import { matchWatchlistFilm } from './letterboxdWatchlistMatch';
import {
  enqueueWrite,
  readWriteState,
  updateWriteState,
} from './letterboxdWriteQueue';
import { reviewDiaryIntent } from './reviewDiaryPublication';
import { currentFilmRating, newUnboundReview } from './reviewPublicationTarget';
import { withReviewLock } from './reviews';
const fields = (r: ReviewFields): ReviewFields => ({
  rating: r.rating,
  text: r.text,
  spoiler: r.spoiler,
});
const equal = (a: ReviewFields, b: ReviewFields) =>
  JSON.stringify(fields(a)) === JSON.stringify(fields(b));
let running = false;
export type PublicationIssue = {
  userId: number;
  originEntityId: string;
  reason: string;
};
// Scan persisted local revisions instead of fire-and-forget writes from the
// save request. A restart cannot lose a successful local review save.
export async function prepareLetterboxdPublications(
  candidateIds?: readonly string[]
) {
  const report = { queued: 0, issues: [] as PublicationIssue[] };
  if (running) return report;
  running = true;
  try {
    const settings = readWriteState().settings;
    for (const [id, setting] of Object.entries(settings)) {
      const userId = Number(id);
      if (
        !setting.enabled ||
        !setting.enabledSince ||
        !Number.isSafeInteger(userId) || userId < 1
      )
        continue;
      const account = await getRepository(LetterboxdAccount).findOneBy({
        userId,
      });
      if (!account?.enabled || account.username !== setting.account) continue;
      const candidates = await getRepository(MovieReview).find({
        where: {
          userId,
          source: 'local',
          mediaType: 'movie',
          syncToLetterboxd: true,
        },
        order: { updatedAt: 'ASC' },
      });
      let queued = 0;
      for (const candidate of candidates) {
        if (candidate.id.startsWith('watched:')) continue;
        if (publicationIsSettled(readWriteState(), candidate, account.username)) continue;
        if (!currentFilmRating(candidate, candidates)) continue;
        if (
          candidate.source !== 'local' ||
          candidate.mediaType !== 'movie' ||
          candidate.syncToLetterboxd !== true
        )
          continue;
        if (candidateIds && !candidateIds.includes(candidate.id)) continue;
        const linkedReceipt = readSyncReceipts().find(
          (r) =>
            r.userId === userId &&
            r.originId === candidate.id &&
            r.account === account.username &&
            r.baseline
        );
        if (
          Date.parse(candidate.updatedAt) < setting.enabledSince! &&
          !linkedReceipt
        )
          continue;
        if (queued >= 2) break;
        await withReviewLock(userId, async () => {
          const state = readWriteState();
          if (
            !state.settings[userId]?.enabled ||
            state.settings[userId].account !== account.username ||
            state.settings[userId].enabledSince !== setting.enabledSince
          )
            return;
          if (
            state.intents.some(
              (j) =>
                j.userId === userId &&
                j.originEntityId === candidate.id &&
                ['queued', 'dispatched', 'unknown', 'conflict'].includes(
                  j.state
                )
            )
          ) {
            const blocked = state.intents.find(
              (j) =>
                j.userId === userId &&
                j.originEntityId === candidate.id &&
                ['unknown', 'conflict'].includes(j.state)
            );
            if (blocked)
              report.issues.push({
                userId,
                originEntityId: candidate.id,
                reason: blocked.state,
              });
            return;
          }
          const local = await getRepository(MovieReview).findOneBy({
            id: candidate.id,
          });
          if (!local || !samePublicationRevision(candidate, local)) return;
          const { exportPublicationHeld, exportReviewBaseline } =
            await import('./letterboxdExportPolicy');
          if (await exportPublicationHeld(userId, local.id)) {
            report.issues.push({
              userId,
              originEntityId: local.id,
              reason: 'export-conflict',
            });
            return;
          }
          const hold = (reason: string) => {
            report.issues.push({ userId, originEntityId: local.id, reason });
          };
          const receipt = readSyncReceipts().find(
            (r) => r.userId === userId && r.originId === local.id
          );
          if (receipt && receipt.account !== account.username)
            return hold('account-changed');
          const imported = await getRepository(MovieReview).findBy({
            userId,
            tmdbId: local.tmdbId,
            mediaType: local.mediaType,
            source: 'letterboxd',
          });
          const entries = imported.filter(
            (r) => r.externalUrl && letterboxdEntryIdentity(r.externalUrl)
          );
          // Never guess which rewatch should be edited.
          const creating = newUnboundReview(local, receipt);
          const bound = receipt?.entryId || local.externalEntryId;
          if (!bound && !creating && entries.length > 1)
            return hold('ambiguous-entry');
          const remote = bound
            ? entries.find(
                (r) =>
                  r.externalUrl &&
                  letterboxdEntryIdentity(r.externalUrl) === bound
              )
            : creating
              ? undefined
              : entries[0];
          let entryId =
            bound ||
            (remote?.externalUrl
              ? letterboxdEntryIdentity(remote.externalUrl)
              : undefined) ||
            undefined;
          let film = entryId
            ? new URL(entryId).pathname.split('/')[3]
            : undefined;
          if (!film && local.mediaType === 'movie') {
            const rating = await getLetterboxdRating(local.tmdbId);
            film = rating?.url
              ? new URL(rating.url).pathname.split('/')[2]
              : undefined;
          }
          if (!film) return hold('unresolved-film');
          const match = await matchWatchlistFilm(film);
          if (
            !match ||
            match.tmdbId !== local.tmdbId ||
            match.mediaType !== local.mediaType
          )
            return hold('unresolved-film');
          // Network lookups may outlive an edit, unlink, or disable/re-enable cycle.
          const freshAccount = await getRepository(LetterboxdAccount).findOneBy(
            { userId }
          );
          const fresh = await getRepository(MovieReview).findOneBy({
            id: local.id,
          });
          const latest = readWriteState();
          if (
            !samePublicationRevision(local, fresh) ||
            !freshAccount?.enabled ||
            freshAccount.username !== account.username ||
            !latest.settings[userId]?.enabled ||
            latest.settings[userId].account !== account.username ||
            latest.settings[userId].enabledSince !== setting.enabledSince
          )
            return hold('changed-during-planning');
          if (
            latest.intents.some(
              (j) =>
                j.userId === userId &&
                j.originEntityId === local.id &&
                ['queued', 'dispatched', 'unknown', 'conflict'].includes(
                  j.state
                )
            )
          )
            return;
          const ratingBase = verifiedRatingBaseline(
            latest.intents,
            userId,
            account.username,
            local.id
          );
          const summaries = imported.filter((r) => r.entryKind === 'summary');
          if (!remote && summaries.length > 1) return hold('ambiguous-rating');
          const importedFields = remote
            ? fields(remote)
            : !receipt && summaries[0]
              ? fields(summaries[0])
              : null;
          const scope = {
            userId,
            account: account.username,
            film,
            entryId,
            ...(creating ? { createNew: true } : {}),
          };
          const observation = findObservation(
            readObservations(),
            scope,
            publicationObservationAfter(latest, userId, account.username, film, receipt?.verifiedAt)
          );
          let base = receipt?.baseline ?? ratingBase ?? importedFields;
          base =
            (await exportReviewBaseline(
              userId,
              local.id,
              local.tmdbId,
              entryId,
              latestVerifiedPublicationAt(latest.intents, userId, local.id)
            )) ?? base;
          // Absence from a partial RSS/import is not proof of remote absence.
          // A browser baseline read is required before the first unobserved write.
          let actual = importedFields;
          if (observation) {
            if (local.watchedDate && !bound) {
              try {
                const diary = reviewDiaryIntent(local, receipt, observation);
                if (diary) {
                  updateWriteState((s) =>
                    enqueueWrite(
                      s,
                      { ...diary, userId, account: account.username, film },
                      'local',
                      Date.now()
                    )
                  );
                  queued++;
                  report.queued++;
                  return;
                }
              } catch {
                return hold('viewing-association-conflict');
              }
            }
            actual = creating
              ? { rating: observation.rating, text: '', spoiler: false }
              : fields(observation);
            entryId = creating ? undefined : observation.entryId;
            if (creating) base = actual;
            if (receipt?.diaryBaseline && !receipt.baseline) base = actual;
            if (!base) {
              const empty =
                observation.rating === null &&
                observation.text === '' &&
                !observation.spoiler &&
                !observation.entryId;
              if (!empty && !equal(local, observation))
                return hold('initial-conflict');
              base = fields(observation);
            }
          } else if (
            // An export baseline is historical comparison data, not a current
            // remote read. Missing imported content must request observation;
            // it must never be passed as null (a deletion) to the planner.
            !actual ||
            local.watchedDate ||
            creating ||
            bound ||
            !base ||
            ratingBase ||
            receipt?.baseline
          ) {
            updateObservations((s) => requestObservation(s, scope, Date.now(), `review:${local.id}`));
            return hold('needs-baseline');
          }
          if (
            !observation &&
            !receipt &&
            ratingBase &&
            !equal(
              ratingBase,
              importedFields ?? { rating: null, text: '', spoiler: false }
            )
          )
            return hold('rating-baseline-awaiting-refresh');
          // Wait for the inbound feed to acknowledge our publication before treating
          // an older imported value as a subsequent remote edit.
          if (!observation && receipt?.baseline && !receipt.echoObserved) {
            if (remote && equal(remote, receipt.baseline))
              recordSyncReceipt({ ...receipt, echoObserved: true });
            else actual = base;
          }
          const plan = planReviewPublication(
            local,
            setting.enabledSince!,
            base,
            actual,
            {
              inboundOnly:
                !!receipt?.baseline &&
                Date.parse(local.updatedAt) < setting.enabledSince!,
            }
          );
          if (plan.state === 'current') {
            if (!equal(local, plan.merged)) {
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
            updateWriteState(s => recordCurrentPublication(s, { ...local, ...plan.merged }, account.username));
            return;
          }
          if (plan.state !== 'publish') return hold(plan.state);
          if (
            !publicationAlreadyRecorded(
              latest.intents,
              userId,
              plan.originId
            ) &&
            !equal(local, plan.desired)
          ) {
            // Persist incoming merged fields before enqueue. Keep the local edit
            // revision stable, so retries cannot reinterpret them as a new edit.
            await getRepository(MovieReview).save({
              ...local,
              ...plan.desired,
              updatedAt: local.updatedAt,
            });
          }
          let added = false;
          updateWriteState((current) => {
            if (
              publicationAlreadyRecorded(current.intents, userId, plan.originId)
            )
              return;
            if (
              !current.settings[userId]?.enabled ||
              current.settings[userId].account !== account.username ||
              current.settings[userId].enabledSince !== setting.enabledSince
            )
              return;
            enqueueWrite(
              current,
              {
                userId,
                account: account.username,
                originId: plan.originId,
                originEntityId: local.id,
                kind: entryId ? 'review' : plan.kind,
                ...(creating && plan.kind === 'review'
                  ? { createNew: true, previousEntryId: observation?.entryId }
                  : {}),
                film,
                entryId,
                expected:
                  entryId || plan.kind === 'review'
                    ? plan.expected
                    : { rating: plan.expected.rating },
                desired:
                  entryId || plan.kind === 'review'
                    ? plan.desired
                    : { rating: plan.desired.rating },
              },
              'local',
              Date.now()
            );
            added = true;
          });
          if (added) {
            queued++;
            report.queued++;
          }
        });
      }
    }
    return report;
  } finally {
    running = false;
  }
}
