import {
  DuplicateWatchlistRequestError,
  NotFoundError,
  Watchlist,
} from '@server/entity/Watchlist';
import logger from '@server/logger';
import { Router } from 'express';
import { plexBookmark } from '@server/lib/plexWatchlist';
import { QueryFailedError } from 'typeorm';

import { MediaType } from '@server/constants/media';
import { watchlistCreate } from '@server/interfaces/api/watchlistCreate';

const watchlistRoutes = Router();

watchlistRoutes.route('/plex/:type/:id')
  .get(async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const { type, id } = req.params;
    if (!['movie', 'tv'].includes(type) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) return res.sendStatus(400);
    try { return res.json(await plexBookmark(req.user.id, type as 'movie' | 'tv', Number(id))); }
    catch { return res.status(503).json({ message: 'Plex watchlist unavailable' }); }
  })
  .put(async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const { type, id } = req.params;
    if (!['movie', 'tv'].includes(type) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0 || typeof req.body.added !== 'boolean') return res.sendStatus(400);
    try { return res.json(await plexBookmark(req.user.id, type as 'movie' | 'tv', Number(id), req.body.added)); }
    catch { return res.status(503).json({ message: 'Plex watchlist unavailable' }); }
  });

watchlistRoutes.post<never, Watchlist, Watchlist>(
  '/',
  async (req, res, next) => {
    try {
      if (!req.user) {
        return next({
          status: 401,
          message: 'You must be logged in to add watchlist.',
        });
      }
      const values = watchlistCreate.parse(req.body);

      const request = await Watchlist.createWatchlist({
        watchlistRequest: values,
        user: req.user,
      });
      return res.status(201).json(request);
    } catch (error) {
      if (!(error instanceof Error)) {
        return;
      }
      switch (error.constructor) {
        case QueryFailedError:
          logger.warn('Something wrong with data watchlist', {
            tmdbId: req.body.tmdbId,
            mediaType: req.body.mediaType,
            label: 'Watchlist',
          });
          return next({ status: 409, message: 'Something wrong' });
        case DuplicateWatchlistRequestError:
          return next({ status: 409, message: error.message });
        default:
          return next({ status: 500, message: error.message });
      }
    }
  }
);

watchlistRoutes.delete('/:tmdbId', async (req, res, next) => {
  if (!req.user) {
    return next({
      status: 401,
      message: 'You must be logged in to delete watchlist data.',
    });
  }
  try {
    const mediaType = req.query.mediaType;
    if (mediaType !== MediaType.MOVIE && mediaType !== MediaType.TV) {
      return next({
        status: 400,
        message: 'Invalid mediaType query parameter.',
      });
    }

    await Watchlist.deleteWatchlist(
      Number(req.params.tmdbId),
      mediaType,
      req.user
    );
    return res.status(204).send();
  } catch (e) {
    if (e instanceof NotFoundError) {
      return next({
        status: 404,
        message: e.message,
      });
    }
    return next({ status: 500, message: e.message });
  }
});

export default watchlistRoutes;
