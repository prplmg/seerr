import { getLetterboxdRating } from '@server/api/rating/letterboxd';
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
const queue: { key: string; film: ListFilm; field: 'rating' | 'runtime' }[] =
  [];
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
function pump() {
  while (active < 2 && queue.length) {
    const task = queue.shift()!;
    active++;
    void (async () => {
      let value: number | null = null;
      try {
        if (task.field === 'rating')
          value =
            (await getLetterboxdRating(task.film.tmdbId, task.film.type))
              ?.score ?? null;
        else if (task.film.type === 'movie')
          value =
            (await new TheMovieDb().getMovie({ movieId: task.film.tmdbId }))
              .runtime || null;
      } catch {
        /* Missing values stay last and are retried later. */
      }
      if (values.size >= 30000 && !values.has(task.key))
        values.delete(values.keys().next().value!);
      values.set(task.key, {
        value,
        until: Date.now() + (value === null ? 15 * 60_000 : 24 * 3600_000),
      });
      dirty++;
      if (dirty >= 25) persist();
    })().finally(() => {
      active--;
      waiting.delete(task.key);
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
export function sortedList(items: ListFilm[], sort: ListSort) {
  if (sort === 'original') return { items, updating: false };
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
