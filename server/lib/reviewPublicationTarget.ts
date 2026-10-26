/** Explicitly-created unbound entries must never inherit an older review ID. */
export function newUnboundReview(
  local: { id: string; externalEntryId?: string | null; text: string; watchedDate?: string | null; viewingEventId?: string | null },
  receipt?: { entryId: string }
) {
  return (
    !receipt &&
    !local.externalEntryId &&
    ((!!local.watchedDate && !!local.viewingEventId) ||
      (/:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(local.id) && !!local.text.trim()))
  );
}

/** Retain previous undated ratings locally, but only the newest edit owns the
 * single Letterboxd film rating. Bound diary ratings remain entry-specific. */
export function currentFilmRating<
  T extends {
    id: string;
    tmdbId: number;
    updatedAt: string;
    text: string;
    externalEntryId?: string | null;
    watchedDate?: string | null;
  },
>(local: T, rows: readonly T[]) {
  if (local.text.trim() || local.externalEntryId || local.watchedDate) return true;
  return !rows.some(
    (other) =>
      other.id !== local.id &&
      other.tmdbId === local.tmdbId &&
      (other.updatedAt > local.updatedAt ||
        (other.updatedAt === local.updatedAt && other.id > local.id))
  );
}
