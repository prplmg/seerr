import type { ExportBaseline } from './letterboxdExportTransaction';

// An early rejection saves remote matching; the transaction still rechecks for
// updates that arrive while the archive is being resolved.
export function assertExportFresh(
  revision: string,
  capturedAt: number,
  old: ExportBaseline | null,
  existing: { updatedAt: string }[]
) {
  if (!revision || !Number.isFinite(capturedAt) || capturedAt <= 0)
    throw Error('Invalid export revision');
  if (old?.revision === revision) return; // Commit validates identical replay.
  if (old && capturedAt <= old.capturedAt) throw Error('Stale export');
  if (existing.some((row) => Date.parse(row.updatedAt) > capturedAt))
    throw Error('Export predates imported changes');
}
