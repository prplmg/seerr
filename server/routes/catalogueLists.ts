import TheMovieDb from '@server/api/themoviedb';
import type { MovieChoice } from '@server/interfaces/api/catalogueLists';
import { parseMovieLine } from '@server/interfaces/api/catalogueLists';
import {
  CatalogueListError,
  deleteCatalogueList,
  ownedCatalogueList,
  saveCatalogueList,
  validateCatalogueList,
} from '@server/lib/catalogueLists';
import { readListStore, updateListStore } from '@server/lib/discoveryLists';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

const router = Router();
const active = new Map<number, number>();
// Bound concurrent metadata work per account; never enqueue background/LB work.
router.use((req, res, next) => {
  const user = req.user!.id;
  if ((active.get(user) || 0) >= 4)
    return res
      .status(429)
      .json({ message: 'Please wait for the current searches to finish.' });
  active.set(user, (active.get(user) || 0) + 1);
  res.once('close', () => {
    const count = (active.get(user) || 1) - 1;
    if (count) active.set(user, count);
    else active.delete(user);
  });
  next();
});
async function movies(ids: number[]): Promise<MovieChoice[]> {
  const api = new TheMovieDb();
  const results: MovieChoice[] = new Array(ids.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (cursor < ids.length) {
        const index = cursor++;
        const movie = await api.getListMovie(ids[index]);
        if (movie.id !== ids[index])
          throw new CatalogueListError(
            422,
            'A movie could not be verified. Try again.'
          );
        results[index] = {
          id: movie.id,
          title: movie.title,
          year: movie.release_date?.slice(0, 4) || '',
          poster: movie.poster_path || null,
        };
      }
    })
  );
  return results;
}
router.get('/search', async (req, res, next) => {
  try {
    const query = String(req.query.query || '').trim(),
      page = Number(req.query.page || 1);
    if (
      !query ||
      query.length > 300 ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 50
    )
      return res.sendStatus(400);
    const { title, year } = parseMovieLine(query);
    const data = await new TheMovieDb().searchMovies({
      query: title,
      year: year ? Number(year) : undefined,
      page,
      throwOnError: true,
    });
    return res.json({
      results: data.results.map((m) => ({
        id: m.id,
        title: m.title,
        year: m.release_date?.slice(0, 4) || '',
        poster: m.poster_path || null,
      })),
      total: data.total_results,
      next: page < Math.min(50, data.total_pages) ? page + 1 : null,
    });
  } catch (e) {
    next(e);
  }
});
router.get('/:id', async (req, res, next) => {
  try {
    const list = ownedCatalogueList(
      readListStore(),
      req.user!.id,
      req.params.id
    );
    return res.json({
      id: list.id,
      title: list.title,
      description: list.description,
      revision: list.checkedAt,
      visibility: list.visibility,
      movies: await movies(list.items.map((f) => f.tmdbId)),
    });
  } catch (e) {
    next(e);
  }
});
router.post('/', async (req, res, next) => {
  try {
    const value = validateCatalogueList(req.body);
    await movies(value.movieIds);
    const list = updateListStore((store) =>
      saveCatalogueList(store, req.user!.id, req.user!.displayName, req.body)
    );
    return res.status(201).json({ id: list.id });
  } catch (e) {
    next(e);
  }
});
router.put('/:id', async (req, res, next) => {
  try {
    ownedCatalogueList(readListStore(), req.user!.id, req.params.id);
    const value = validateCatalogueList(req.body);
    await movies(value.movieIds);
    const list = updateListStore((store) =>
      saveCatalogueList(
        store,
        req.user!.id,
        req.user!.displayName,
        req.body,
        req.params.id
      )
    );
    return res.json({ id: list.id });
  } catch (e) {
    next(e);
  }
});
router.delete('/:id', (req, res, next) => {
  try {
    updateListStore((store) =>
      deleteCatalogueList(
        store,
        req.user!.id,
        req.params.id,
        req.body?.revision
      )
    );
    return res.sendStatus(204);
  } catch (e) {
    next(e);
  }
});
router.use((error: Error, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof CatalogueListError)
    return res.status(error.status).json({ message: error.message });
  next(error);
});
export default router;
