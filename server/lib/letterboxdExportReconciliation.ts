import dataSource, { getRepository } from '@server/datasource';
import { LetterboxdExportBaseline } from '@server/entity/LetterboxdExport';
import { MovieReview } from '@server/entity/MovieReview';
import { applyExportRecords } from './letterboxdExportApply';
import { commitExportToDatabase } from './letterboxdExportDatabase';
import { assertExportFresh } from './letterboxdExportPreflight';
import type { ExportRecord } from './letterboxdExportRecords';
import { resolveExportRecords } from './letterboxdExportRecords';
import { readExportSnapshot } from './letterboxdExportSnapshot';
import type { ExportBaseline } from './letterboxdExportTransaction';
import { recordFilmEvidence } from './letterboxdFilmEvidence';
import {
  readMetadataMatch,
  saveMetadataMatch,
} from './letterboxdMetadataMatches';
import {
  latestVerifiedPublicationAt,
  verifiedRatingBaseline,
} from './letterboxdPublicationPlan';
import { reconcileLetterboxdReview } from './letterboxdReconcile';
import { readSyncReceipts } from './letterboxdSyncReceipts';
import { readWriteState, updateWriteState } from './letterboxdWriteQueue';
import { currentFilmRating } from './reviewPublicationTarget';
import { cancelQueuedReviewWrites } from './reviewPublishingPolicy';
import { expandReviewLink, resolveReview, withReviewLock } from './reviews';

type Mapping = {
  externalUrl: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
};
export type ResolvedBaseline = ExportBaseline & {
  mappings?: Record<string, Mapping>;
  records?: ExportRecord[];
  holds?: { originId: string; reason: string }[];
};

export async function reconcileExport(
  userId: number,
  account: string,
  revision: string,
  capturedAt: number,
  encoded: string
) {
  const snapshot = await readExportSnapshot(encoded, account);
  return withReviewLock(userId, async () => {
    const saved = await getRepository(LetterboxdExportBaseline).findOneBy({
      userId,
    });
    const old = saved ? (JSON.parse(saved.value) as ResolvedBaseline) : null;
    const receipts = readSyncReceipts(),
      writes = readWriteState();
    const mappings: Record<string, Mapping> = { ...old?.mappings };
    const existing = await getRepository(MovieReview).findBy({
      userId,
      source: 'letterboxd',
    });
    assertExportFresh(revision, capturedAt, old, existing);
    for (const r of existing)
      if (r.externalUrl && !mappings[r.externalUrl])
        mappings[r.externalUrl] = {
          externalUrl: r.externalUrl,
          tmdbId: r.tmdbId,
          mediaType: r.mediaType,
        };
    const records = await resolveExportRecords(
      snapshot,
      async (entry, username) => {
        const originalUrl = entry.externalUrl;
        const cached = mappings[originalUrl] || readMetadataMatch(originalUrl);
        if (cached) {
          mappings[originalUrl] = cached;
          Object.assign(entry, cached);
        } else {
          await expandReviewLink(entry, username);
          const previous = existing.find(
            (r) => r.externalUrl === entry.externalUrl
          );
          const tmdbId = previous?.tmdbId || (await resolveReview(entry));
          if (!tmdbId) throw Error('Export contains unresolved film');
          mappings[originalUrl] = {
            externalUrl: entry.externalUrl,
            tmdbId,
            mediaType: previous?.mediaType || entry.mediaType || 'movie',
          };
          saveMetadataMatch(originalUrl, mappings[originalUrl]);
          Object.assign(entry, mappings[originalUrl]);
        }
        const previous = existing.find(
          (r) => r.externalUrl === entry.externalUrl
        );
        // CSV absence is not evidence of a spoiler-flag change, even on text edits.
        if (previous) entry.spoiler = previous.spoiler;
        else {
          const own = receipts.find(
            (r) =>
              r.userId === userId &&
              r.account === account &&
              r.entryId === entry.externalUrl &&
              r.baseline
          );
          if (own?.baseline) entry.spoiler = own.baseline.spoiler;
        }
        return { ...entry, tmdbId: entry.tmdbId!, mediaType: entry.mediaType! };
      }
    );
    const incoming: ResolvedBaseline = {
      revision,
      capturedAt,
      snapshot,
      mappings,
      records,
      holds: old?.holds || [],
    };
    const result = await commitExportToDatabase(
      dataSource,
      userId,
      incoming,
      old?.revision ?? null,
      async (manager) => {
        await applyExportRecords(manager, userId, records, capturedAt);
        const repo = manager.getRepository(MovieReview);
        const locals = await repo.findBy({
          userId,
          source: 'local',
          mediaType: 'movie',
        });
        for (const local of locals) {
          if (Date.parse(local.updatedAt) > capturedAt) continue;
          const verifiedAt = latestVerifiedPublicationAt(
            writes.intents,
            userId,
            local.id
          );
          if (verifiedAt > capturedAt) continue;
          const receipt = receipts.find(
            (r) =>
              r.userId === userId &&
              r.account === account &&
              r.originId === local.id
          );
          if (!receipt && !currentFilmRating(local, locals)) continue;
          const previousRemote = old?.records?.find((r) =>
            receipt
              ? r.externalUrl === receipt.entryId
              : r.entryKind === 'summary' &&
                r.tmdbId === local.tmdbId &&
                r.mediaType === local.mediaType
          );
          const verifiedBase =
            receipt?.baseline ||
            verifiedRatingBaseline(writes.intents, userId, account, local.id);
          const base =
            verifiedBase &&
            old &&
            Math.max(receipt?.verifiedAt || 0, verifiedAt) <= old.capturedAt
              ? previousRemote ||
                (!receipt
                  ? { rating: null, text: '', spoiler: false }
                  : verifiedBase)
              : verifiedBase;
          if (!base) continue;
          const remote = receipt
            ? records.find((r) => r.externalUrl === receipt.entryId)
            : records.find(
                (r) =>
                  r.entryKind === 'summary' &&
                  r.tmdbId === local.tmdbId &&
                  r.mediaType === local.mediaType
              );
          // Film-level absence is an explicit empty current rating, not a diary deletion.
          const value =
            remote ||
            (!receipt ? { rating: null, text: '', spoiler: false } : null);
          const merge = reconcileLetterboxdReview(base, local, value);
          if (merge.state === 'ready') {
            const held = incoming.holds!.some((h) => h.originId === local.id);
            if (!held || !merge.outgoing) {
              await repo.save({
                ...local,
                ...merge.merged,
                updatedAt: local.updatedAt,
              });
              incoming.holds = incoming.holds!.filter(
                (h) => h.originId !== local.id
              );
            }
          } else {
            incoming.holds = incoming.holds!.filter(
              (h) => h.originId !== local.id
            );
            incoming.holds.push({
              originId: local.id,
              reason: remote ? 'concurrent-edit' : 'remote-entry-removed',
            });
          }
        }
      }
    );
    // Replay repairs these idempotent projections after a crash following DB
    // commit. The transaction remains authoritative for removals and holds.
    const committed = result.replay ? old! : incoming;
    for (const mapping of Object.values(committed.mappings || {})) {
      const summary = committed.records?.find(
        (r) =>
          r.entryKind === 'summary' &&
          r.tmdbId === mapping.tmdbId &&
          r.mediaType === mapping.mediaType
      );
      const parts = new URL(mapping.externalUrl).pathname.split('/');
      const film = parts[1] === 'film' ? parts[2] : parts[3];
      if (!film) continue;
      recordFilmEvidence({
        userId,
        account,
        film,
        observedAt: committed.capturedAt,
        watched: !!summary,
        rating: summary?.rating ?? null,
      });
    }
    updateWriteState((state) => {
      for (const hold of committed.holds || [])
        cancelQueuedReviewWrites(state, userId, hold.originId);
    });
    return result;
  });
}
