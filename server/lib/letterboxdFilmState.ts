/** Film-level state is deliberately separate from diary/review entry identity. */
export type FilmState = { watched: boolean; rating: number | null };
export type FilmSnapshot = {
  account: string;
  complete: boolean;
  pages: number;
  expectedPages: number;
  films: { film: string; state: FilmState }[];
};

export function validateFilmState(state: FilmState) {
  if (
    typeof state.watched !== 'boolean' ||
    (state.rating !== null &&
      (typeof state.rating !== 'number' ||
        !Number.isFinite(state.rating) ||
        state.rating < 0.5 ||
        state.rating > 5 ||
        !Number.isInteger(state.rating * 2) ||
        !state.watched))
  ) throw Error('Invalid Letterboxd film state');
}

/** Absence is only a removal candidate, even after a complete paginated scan. */
export function compareFilmSnapshot(
  account: string,
  previous: Readonly<Record<string, FilmState>>,
  snapshot: FilmSnapshot
) {
  if (
    snapshot.account !== account || !snapshot.complete ||
    !Number.isSafeInteger(snapshot.pages) || snapshot.pages < 1 ||
    snapshot.pages !== snapshot.expectedPages
  ) throw Error('Incomplete or wrong-account film snapshot');
  const seen = new Set<string>();
  const updates: Record<string, FilmState> = {};
  for (const { film, state } of snapshot.films) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(film) || seen.has(film))
      throw Error('Invalid or duplicate film in snapshot');
    validateFilmState(state);
    if (!state.watched) throw Error('Unwatched film in watched collection');
    seen.add(film);
    updates[film] = { ...state };
  }
  return { updates, removalCandidates: Object.keys(previous).filter(film => !seen.has(film)) };
}

/** Three-way merge prevents old catalogue values resurrecting remote removals. */
export function reconcileFilmState(base: FilmState, local: FilmState, remote: FilmState) {
  [base, local, remote].forEach(validateFilmState);
  const merged = { ...base };
  const conflicts: string[] = [];
  for (const key of ['watched', 'rating'] as const) {
    const localChanged = local[key] !== base[key];
    const remoteChanged = remote[key] !== base[key];
    if (localChanged && remoteChanged && local[key] !== remote[key]) conflicts.push(key);
    else Object.assign(merged, { [key]: localChanged ? local[key] : remote[key] });
  }
  // Independent edits can still conflict semantically (unwatch vs new rating).
  if (!merged.watched && merged.rating !== null) conflicts.push('watched+rating');
  if (conflicts.length) return { state: 'conflict' as const, conflicts };
  return { state: 'ready' as const, merged,
    outgoing: merged.watched !== remote.watched || merged.rating !== remote.rating };
}
