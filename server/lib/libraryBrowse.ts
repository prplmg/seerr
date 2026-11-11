import TheMovieDb from '@server/api/themoviedb';
import {
  mapMovieDetailsToResult,
  mapMovieResult,
  mapTvDetailsToResult,
  mapTvResult,
  type MovieResult,
  type TvResult,
} from '@server/models/Search';
import { randomUUID } from 'crypto';
import { searchPeople } from './aiSearchPeople';
import { matchesAiFilters, type AiFilters } from './aiSearchPlan';
import { sortSearchResults, type AiSort } from './aiSearchSort';
import { discoveryData } from './discoveryData';
import { togetherSeen } from './discoveryRecommendations';
import { collectListRatings } from './listSort';
export type LibraryRow = {
  media: MovieResult | TvResult;
  addedAt?: number | null;
  runtime: number | null;
  letterboxdRating?: number;
};
type Job = {
  id: string;
  userId: number;
  key: string;
  until: number;
  message: string;
  ready: boolean;
  cancelled: boolean;
  error?: string;
  rows: LibraryRow[];
  total: number;
  unknown: number;
  full: boolean;
  page: number;
  valid: () => boolean;
  request: {
    filters: AiFilters;
    sort: AiSort;
    people: number[];
    allTypes: boolean;
  };
};
const jobs = new Map<string, Job>();
// Bound base-metadata reads globally, including overlapping requests/users.
let active = 0;
const waiting: (() => void)[] = [];
async function metadata<T>(run: () => Promise<T>): Promise<T> {
  await new Promise<void>((resolve) => {
    const enter = () => {
      active++;
      resolve();
    };
    if (active < 2) enter();
    else waiting.push(enter);
  });
  try {
    return await run();
  } finally {
    active--;
    waiting.shift()?.();
  }
}
export function libraryJob(userId: number, id: string, page: number) {
  const job = jobs.get(id);
  if (!job || job.userId !== userId || job.until < Date.now() || job.cancelled)
    throw Object.assign(Error('This view expired. Apply your filters again.'), {
      status: 404,
    });
  if (!job.full && job.page !== page)
    throw Object.assign(Error('Apply filters to load this page.'), {
      status: 400,
    });
  if (!job.valid())
    throw Object.assign(Error('Catalogue changed. Apply your filters again.'), {
      status: 409,
    });
  if (job.error) throw Object.assign(Error(job.error), { status: 503 });
  return {
    id: job.id,
    ready: job.ready,
    message: job.message,
    ...(job.ready
      ? {
          results: job.full
            ? job.rows.slice(page * 20, page * 20 + 20)
            : job.rows,
          total: job.total,
          next: (page + 1) * 20 < job.total ? page + 1 : null,
          unknown: job.unknown,
        }
      : {}),
  };
}
// Revalidate stale discovery snapshots instead of exposing routine background
// writes as errors. The fresh pool key lets unchanged work continue in place.
export async function refreshLibraryJob(
  userId: number,
  id: string,
  page: number
) {
  const job = jobs.get(id);
  if (
    job &&
    job.userId === userId &&
    !job.cancelled &&
    job.until >= Date.now() &&
    !job.valid()
  ) {
    const { filters, sort, people, allTypes } = job.request;
    return startLibraryBrowse(userId, filters, sort, people, page, allTypes);
  }
  return libraryJob(userId, id, page);
}
export async function startLibraryBrowse(
  userId: number,
  filters: AiFilters,
  sort: AiSort,
  people: unknown,
  page: number,
  allTypes = false
) {
  const d = await discoveryData(userId);
  const ids = searchPeople(userId, people, '', d.users).ids;
  if (filters.unwatched && !d.historyAvailable)
    throw Object.assign(
      Error('Watch history is temporarily unavailable. Please retry.'),
      { status: 503 }
    );
  const seen = togetherSeen(ids, d.ratings, d.watched);
  const ranked = d.feed?.recommendations ?? [];
  const ordered = [
    ...new Set([
      ...ranked.map((item) => `${item.type}:${item.tmdbId}`),
      ...[...d.requestAvailable].sort(),
    ]),
  ];
  if (sort[0]?.field === 'added')
    ordered.sort((a, b) => {
      const av = d.addedDates?.get(a),
        bv = d.addedDates?.get(b);
      if (av == null && bv == null) return a.localeCompare(b);
      if (av == null) return 1;
      if (bv == null) return -1;
      return (
        (av - bv) * (sort[0].direction === 'asc' ? 1 : -1) || a.localeCompare(b)
      );
    });
  const pool = ordered.filter(
    (key) =>
      d.requestAvailable.has(key) &&
      (allTypes || key.startsWith(filters.type + ':')) &&
      (!filters.unwatched || !seen.has(key))
  );
  const f = { ...filters, available: true };
  const full = !!(
    sort.some((s) => s.field !== 'added') ||
    f.maxRuntime != null ||
    f.yearFrom != null ||
    f.yearTo != null ||
    f.genres.length ||
    f.minLetterboxdRating != null ||
    f.maxLetterboxdRating != null
  );
  const key = JSON.stringify([
    f,
    allTypes,
    sort,
    ids,
    pool,
    sort.some((s) => s.field === 'added')
      ? pool.map((k) => d.addedDates?.get(k) ?? null)
      : null,
    full ? null : page,
  ]);
  for (const [id, job] of jobs) {
    if (job.until < Date.now()) {
      job.cancelled = true;
      jobs.delete(id);
    }
  }
  const existing = [...jobs.values()].find(
    (j) =>
      j.userId === userId &&
      j.key === key &&
      !j.cancelled &&
      !j.error &&
      (!j.ready || !j.unknown)
  );
  if (existing) {
    existing.valid = d.visibilityStillValid;
    return libraryJob(userId, existing.id, page);
  }
  // Latest view wins; old jobs stop after their current bounded batch.
  for (const job of jobs.values())
    if (job.userId === userId && !job.ready) job.cancelled = true;
  if (jobs.size >= 64) {
    const old = [...jobs.values()].find((j) => j.ready || j.cancelled);
    if (old) jobs.delete(old.id);
    else
      throw Object.assign(Error('Library filtering is busy. Please retry.'), {
        status: 429,
      });
  }
  const job: Job = {
    id: randomUUID(),
    userId,
    key,
    until: Date.now() + 15 * 60000,
    message: 'Checking available titles…',
    ready: false,
    cancelled: false,
    rows: [],
    total: pool.length,
    unknown: 0,
    full,
    page,
    valid: d.visibilityStillValid,
    request: {
      filters,
      sort,
      people: ids.filter((id) => id !== userId),
      allTypes,
    },
  };
  jobs.set(job.id, job);
  const selected = full ? pool : pool.slice(page * 20, page * 20 + 20);
  void (async () => {
    const tmdb = new TheMovieDb();
    let done = 0;
    for (let i = 0; i < selected.length; i += 2) {
      if (job.cancelled) return;
      if (job.until < Date.now()) throw Error('Expired');
      job.message = `Checking ${f.maxRuntime != null || sort.some((s) => s.field === 'runtime') ? 'runtimes and title details' : 'title details'}… ${done}/${selected.length}`;
      const rows = await Promise.all(
        selected.slice(i, i + 2).map((key) =>
          metadata(async () => {
            if (job.cancelled) return null;
            const id = Number(key.split(':')[1]);
            try {
              const row: LibraryRow = key.startsWith('movie:')
                ? await tmdb.getLibraryMovie(id).then((m) => ({
                    media: mapMovieResult(mapMovieDetailsToResult(m)),
                    runtime: m.runtime || null,
                  }))
                : await tmdb.getLibraryTv(id).then((m) => ({
                    media: mapTvResult(mapTvDetailsToResult(m)),
                    runtime: m.episode_run_time?.length
                      ? Math.max(...m.episode_run_time) || null
                      : null,
                  }));
              row.addedAt = d.addedDates?.get(key);
              const year = Number(
                (row.media.mediaType === 'movie'
                  ? row.media.releaseDate
                  : row.media.firstAirDate
                )?.slice(0, 4)
              );
              return matchesAiFilters(
                { ...f, minLetterboxdRating: null, maxLetterboxdRating: null },
                {
                  available: true,
                  watched: seen.has(key),
                  runtime: row.runtime,
                  year,
                  genres: row.media.genreIds,
                }
              )
                ? row
                : null;
            } catch {
              job.unknown++;
              return null;
            }
          })
        )
      );
      done += rows.length;
      job.rows.push(...rows.filter((r): r is LibraryRow => !!r));
    }
    const needsRating =
      f.minLetterboxdRating != null ||
      f.maxLetterboxdRating != null ||
      sort.some((s) => s.field === 'rating');
    if (needsRating) {
      const accepted: LibraryRow[] = [];
      for (let i = 0; i < job.rows.length; i += 40) {
        if (job.cancelled) return;
        if (job.until < Date.now()) throw Error('Expired');
        const batch = job.rows.slice(i, i + 40);
        const scores = await collectListRatings(
          batch.map((r) => ({ tmdbId: r.media.id, type: r.media.mediaType })),
          (count) => {
            job.message = `Checking Letterboxd ratings… ${i + count}/${job.rows.length}`;
          }
        );
        for (const row of batch) {
          const score = scores.get(`${row.media.mediaType}:${row.media.id}`);
          if (score == null) {
            job.unknown++;
            if (f.minLetterboxdRating == null && f.maxLetterboxdRating == null)
              accepted.push(row);
          } else if (
            (f.minLetterboxdRating == null || score >= f.minLetterboxdRating) &&
            (f.maxLetterboxdRating == null || score <= f.maxLetterboxdRating)
          )
            accepted.push({ ...row, letterboxdRating: score });
        }
      }
      job.rows = accepted;
    }
    if (job.cancelled) return;
    job.rows = sortSearchResults(job.rows, sort);
    job.total = full ? job.rows.length : pool.length;
    job.ready = true;
    job.message = 'Ready';
  })().catch(() => {
    job.error = 'Could not finish filtering the library. Please retry.';
  });
  return libraryJob(userId, job.id, page);
}
