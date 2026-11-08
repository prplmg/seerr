import { getFreshLetterboxdRating } from '@server/api/rating/letterboxd';
import TheMovieDb from '@server/api/themoviedb';
import logger from '@server/logger';
import { appDataPath } from '@server/utils/appDataVolume';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { filmKey, type ListFilm } from './discoveryLists';
export type ListSort =
  | 'original'
  | 'rating-desc'
  | 'rating-asc'
  | 'runtime-asc'
  | 'runtime-desc';
type Value = { value: number | null; until: number };
const values = new Map<string, Value>();
const waiting = new Set<string>();
const ratingObservers = new Set<() => void>();
const queue: { key: string; film: ListFilm; field: 'rating' | 'runtime' }[] =
  [];
const activeByField = { rating: 0, runtime: 0 };
const fieldLimits = { rating: 4, runtime: 2 };
let loaded = false,
  active = 0,
  dirty = 0;
const file = () => path.join(appDataPath(), 'list-sort-metadata.json');
function persist() {
  if (!dirty) return;
  const temp = `${file()}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(Object.fromEntries(values)), {
      mode: 0o600,
    });
    fs.renameSync(temp, file());
    dirty = 0;
  } catch (error) {
    logger.warn('List sort metadata could not be cached', {
      label: 'Discovery lists',
      error: String(error),
    });
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
export function refreshedListValue(
  field: 'rating' | 'runtime',
  previous: Value | undefined,
  value: number | null,
  now = Date.now()
): Value {
  return {
    value: value ?? previous?.value ?? null,
    until:
      now +
      (value === null
        ? 15 * 60_000
        : (field === 'rating' ? 7 : 30) * 24 * 3600_000),
  };
}
function pump() {
  // Share four slots overall, with no more than two runtime lookups.
  while (active < 4 && queue.length) {
    const index = queue.findIndex(
      ({ field }) => activeByField[field] < fieldLimits[field]
    );
    if (index === -1) break;
    const [task] = queue.splice(index, 1);
    active++;
    activeByField[task.field]++;
    void (async () => {
      let value: number | null = null;
      try {
        if (task.field === 'rating')
          value =
            (await getFreshLetterboxdRating(task.film.tmdbId, task.film.type))
              ?.score ?? null;
        else if (task.film.type === 'movie')
          value =
            (await new TheMovieDb().getListMovie(task.film.tmdbId)).runtime ||
            null;
      } catch {
        /* Missing values stay last and are retried later. */
      }
      if (values.size >= 30000 && !values.has(task.key))
        values.delete(values.keys().next().value!);
      values.set(
        task.key,
        refreshedListValue(task.field, values.get(task.key), value)
      );
      dirty++;
      if (dirty >= 25) persist();
    })().finally(() => {
      active--;
      activeByField[task.field]--;
      waiting.delete(task.key);
      if (task.field === 'rating')
        for (const notify of ratingObservers) notify();
      pump();
      if (!active && !queue.length) persist();
    });
  }
}
export function orderList<T>(
  items: T[],
  value: (item: T) => number | null,
  descending: boolean
): T[] {
  return [...items].sort((a, b) => {
    const x = value(a),
      y = value(b);
    if (x === null) return y === null ? 0 : 1;
    if (y === null) return -1;
    return descending ? y - x : x - y;
  });
}
/** Read-only progress: never enqueue, fetch, sort, or touch the filesystem. */
export function listSortReadiness(items: ListFilm[], sort: ListSort) {
  const field = sort.startsWith('rating') ? 'rating' : 'runtime';
  let completed = 0,
    available = 0;
  for (const film of items) {
    const value = values.get(`${field}:${filmKey(film)}`);
    if (value) {
      completed++;
      if (value.value !== null) available++;
    }
  }
  return {
    field,
    state:
      completed === items.length ? ('ready' as const) : ('pending' as const),
    completed,
    total: items.length,
    unavailable: completed - available,
  };
}
function loadSavedValues() {
  if (!loaded) {
    loaded = true;
    try {
      const saved = JSON.parse(fs.readFileSync(file(), 'utf8')) as Record<
        string,
        Value
      >;
      for (const [key, value] of Object.entries(saved))
        if (
          Number.isFinite(value.until) &&
          (value.value === null || Number.isFinite(value.value))
        )
          values.set(key, value);
    } catch (error) {
      if (error.code !== 'ENOENT')
        logger.warn('List sort cache unavailable', {
          label: 'Discovery lists',
        });
    }
  }
}

/** Read only: reuse the last known score without starting list collection. */
export function cachedListRating(id: number, mediaType: 'movie' | 'tv') {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  loadSavedValues();
  const score = values.get(`rating:${mediaType}:${id}`)?.value;
  return typeof score === 'number' &&
    Number.isFinite(score) &&
    score >= 0 &&
    score <= 5
    ? score
    : null;
}

export function sortedList(items: ListFilm[], sort: ListSort) {
  if (sort === 'original') return { items, updating: false };
  loadSavedValues();
  const field = sort.startsWith('rating') ? 'rating' : 'runtime';
  let updating = false;
  for (const film of items) {
    const key = `${field}:${filmKey(film)}`,
      cached = values.get(key);
    if (!cached || cached.until <= Date.now()) {
      if (!waiting.has(key) && waiting.size < 10000) {
        waiting.add(key);
        queue.push({ key, film, field });
      }
      if (!cached) updating = true;
    }
  }
  pump();
  const enriched = items.map((film) => ({
    ...film,
    [field === 'rating' ? 'listRating' : 'listRuntime']:
      values.get(`${field}:${filmKey(film)}`)?.value ?? null,
  }));
  return {
    items: orderList(
      enriched,
      (film) => values.get(`${field}:${filmKey(film)}`)?.value ?? null,
      sort.endsWith('desc')
    ),
    updating,
  };
}

/** Await the existing shared queue, never create a second pool for AI Search. */
export function collectListRatings(
  items: ListFilm[],
  onProgress: (completed: number, total: number) => void = () => undefined,
  timeoutMs = 90000
): Promise<Map<string, number | null>> {
  const unique = [
    ...new Map(items.map((film) => [filmKey(film), film])).values(),
  ];
  sortedList(unique, 'rating-desc');
  return new Promise((resolve) => {
    const snapshot = () =>
      new Map(
        unique.map((film) => [
          filmKey(film),
          values.get(`rating:${filmKey(film)}`)?.value ?? null,
        ])
      );
    const finish = () => {
      clearTimeout(timer);
      ratingObservers.delete(check);
      resolve(snapshot());
    };
    const check = () => {
      const completed = unique.filter((film) => {
        const entry = values.get(`rating:${filmKey(film)}`);
        return entry && (entry.value !== null || entry.until > Date.now());
      }).length;
      onProgress(completed, unique.length);
      if (completed === unique.length) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    ratingObservers.add(check);
    check();
  });
}
