import { appDataPath } from '@server/utils/appDataVolume';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { validateFilmState, type FilmState } from './letterboxdFilmState';

export type FilmEvidence = FilmState & {
  userId: number;
  account: string;
  film: string;
  observedAt: number;
  originId?: string;
};
const filename = () =>
  path.join(appDataPath(), 'letterboxd-film-evidence.json');
export function mergeFilmEvidence(
  rows: readonly FilmEvidence[],
  incoming: FilmEvidence
) {
  validateFilmState(incoming);
  if (
    !Number.isSafeInteger(incoming.userId) ||
    incoming.userId < 1 ||
    !/^[a-z0-9_]{1,40}$/.test(incoming.account) ||
    !/^(?:[a-z0-9]+(?:-[a-z0-9]+)*|film:[1-9][0-9]*)$/.test(incoming.film) ||
    !Number.isFinite(incoming.observedAt) ||
    incoming.observedAt <= 0
  )
    throw Error('Invalid film evidence');
  const old = rows.find(
    (r) =>
      r.userId === incoming.userId &&
      r.account === incoming.account &&
      r.film === incoming.film
  );
  if (old && old.observedAt > incoming.observedAt) return [...rows];
  if (
    old &&
    old.observedAt === incoming.observedAt &&
    (old.watched !== incoming.watched || old.rating !== incoming.rating)
  )
    throw Error('Conflicting same-time film evidence');
  const next = { ...old, ...incoming };
  return old ? rows.map((r) => (r === old ? next : r)) : [...rows, next];
}
/** Preserve merge validation/order without repeatedly scanning the whole store. */
export function parseFilmEvidence(data: {
  version?: number;
  entries?: unknown;
}): FilmEvidence[] {
  if (data?.version !== 1 || !Array.isArray(data.entries))
    throw Error('Invalid film evidence store');
  const entries = new Map<string, FilmEvidence>();
  for (const row of data.entries) {
    // Validate before deriving an identity from untrusted persisted data.
    const incoming = mergeFilmEvidence([], row)[0];
    const key = JSON.stringify([
      incoming.userId,
      incoming.account,
      incoming.film,
    ]);
    const old = entries.get(key);
    entries.set(key, old ? mergeFilmEvidence([old], incoming)[0] : incoming);
  }
  return [...entries.values()];
}
export function readFilmEvidence(): FilmEvidence[] {
  try {
    const data = JSON.parse(fs.readFileSync(filename(), 'utf8'));
    return parseFilmEvidence(data);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
export function recordFilmEvidence(incoming: FilmEvidence) {
  const entries = mergeFilmEvidence(readFilmEvidence(), incoming);
  const file = filename(),
    temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify({ version: 1, entries }), {
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

/** A rating removal does not prove an unwatch. Only positive writes imply watched. */
export function evidenceFromVerifiedWrite(
  job: {
    userId: number;
    account: string;
    film: string;
    kind: string;
    originEntityId?: string;
    desired: Record<string, unknown>;
  },
  now: number,
  previous?: FilmState
): FilmEvidence | undefined {
  if (
    (job.kind === 'watched' && job.desired.watched === true) ||
    (job.kind === 'diary' && typeof job.desired.watchedDate === 'string')
  ) {
    const row = {
      userId: job.userId,
      account: job.account,
      film: job.film,
      originId: job.originEntityId,
      observedAt: now,
      watched: true,
      rating:
        'rating' in job.desired
          ? (job.desired.rating as number | null)
          : (previous?.rating ?? null),
    };
    validateFilmState(row);
    return row;
  }
  if (
    !['rating', 'review'].includes(job.kind) ||
    (job.desired.rating == null &&
      !previous &&
      !(
        job.kind === 'review' &&
        typeof job.desired.text === 'string' &&
        job.desired.text.trim()
      ))
  )
    return;
  const row = {
    userId: job.userId,
    account: job.account,
    film: job.film,
    originId: job.originEntityId,
    observedAt: now,
    watched:
      job.desired.rating != null || !!job.desired.text
        ? true
        : previous!.watched,
    rating: (job.desired.rating ?? null) as number | null,
  };
  validateFilmState(row);
  return row;
}

export function verifiedRatingSource(
  review: {
    id: string;
    userId: number;
    source: string;
    rating: number | null;
    text: string;
  },
  evidence: readonly FilmEvidence[]
) {
  if (review.source !== 'local' || review.text.trim() || review.rating === null)
    return {};
  const matches = evidence.filter(
    (r) => r.userId === review.userId && r.originId === review.id
  );
  if (
    matches.length !== 1 ||
    !matches[0].watched ||
    matches[0].rating !== review.rating
  )
    return {};
  return { syncedToLetterboxd: true as const };
}
