import { diffLetterboxdExports } from './letterboxdExportDiff';
import type { parseExportSnapshot } from './letterboxdExportSnapshot';

export type ExportSnapshot = ReturnType<typeof parseExportSnapshot>;
export type ExportBaseline = {
  revision: string;
  capturedAt: number;
  snapshot: ExportSnapshot;
};
export type ExportTransaction = {
  readBaseline(): Promise<ExportBaseline | null>;
  apply(
    diff: ReturnType<typeof diffLetterboxdExports>,
    snapshot: ExportSnapshot
  ): Promise<void>;
  saveBaseline(baseline: ExportBaseline): Promise<void>;
  audit(value: {
    revision: string;
    capturedAt: number;
    changes: number;
  }): Promise<void>;
};

/** Database adapters must implement transaction with rollback and account locking.
 * Resolution happens before entering here: an unresolved/malformed collection
 * must not advance the baseline or leave half-applied deletions behind.
 */
export async function commitLetterboxdExport(
  incoming: ExportBaseline,
  expectedRevision: string | null,
  transaction: <T>(work: (tx: ExportTransaction) => Promise<T>) => Promise<T>
) {
  if (
    !incoming.revision ||
    !Number.isFinite(incoming.capturedAt) ||
    incoming.capturedAt <= 0
  )
    throw Error('Invalid export revision');
  return transaction(async (tx) => {
    const old = await tx.readBaseline();
    if (old?.revision === incoming.revision) {
      if (JSON.stringify(old.snapshot) !== JSON.stringify(incoming.snapshot))
        throw Error('Export revision collision');
      return { replay: true, changes: 0 };
    }
    if ((old?.revision ?? null) !== expectedRevision)
      throw Error('Export baseline changed');
    if (old && incoming.capturedAt <= old.capturedAt)
      throw Error('Stale export');
    const empty: ExportSnapshot = {
      account: incoming.snapshot.account,
      complete: true,
      active: {
        'watched.csv': [],
        'ratings.csv': [],
        'diary.csv': [],
        'reviews.csv': [],
      },
    };
    const diff = diffLetterboxdExports(
      old?.snapshot ?? empty,
      incoming.snapshot
    );
    const changes = Object.values(diff).reduce(
      (n, c) => n + c.added.length + c.changed.length + c.removed.length,
      0
    );
    await tx.apply(diff, incoming.snapshot);
    await tx.saveBaseline(incoming);
    await tx.audit({
      revision: incoming.revision,
      capturedAt: incoming.capturedAt,
      changes,
    });
    return { replay: false, changes };
  });
}
