import TheMovieDb from '@server/api/themoviedb';
import { MediaStatus } from '@server/constants/media';
import Media from '@server/entity/Media';
import { searchPeople } from '@server/lib/aiSearchPeople';
import { matchesAiFilters, normalizedTitle } from '@server/lib/aiSearchPlan';
import { interpretAiSearch } from '@server/lib/aiSearchProvider';
import { discoveryData } from '@server/lib/discoveryData';
import { togetherSeen } from '@server/lib/discoveryRecommendations';
import {
  mapMovieResult,
  mapTvResult,
  type MovieResult,
  type TvResult,
} from '@server/models/Search';
import { Router } from 'express';

const router = Router();
router.get('/people', async (req, res, next) => {
  try {
    const d = await discoveryData(req.user!.id);
    if (!d.visibilityStillValid()) return res.sendStatus(409);
    return res.json({ users: d.users, selfId: req.user!.id });
  } catch {
    return next({
      status: 503,
      message: 'People are temporarily unavailable.',
    });
  }
});
router.post('/', async (req, res, next) => {
  try {
    const query =
      typeof req.body.query === 'string' ? req.body.query.trim() : '';
    if (!query || query.length > 1000)
      return next({
        status: 400,
        message: 'Enter a search of up to 1,000 characters.',
      });
    if (!process.env.OPENAI_API_KEY)
      return next({ status: 503, message: 'AI Search is not configured yet.' });
    const d = await discoveryData(req.user!.id);
    const people = searchPeople(req.user!.id, req.body.people, query, d.users);
    if (people.ids.length > 1 && !d.historyAvailable)
      return next({
        status: 503,
        message: 'Watch history is temporarily unavailable. Please retry.',
      });
    const { plan, cached } = await interpretAiSearch(
      req.user!.id,
      people.query
    );
    const f = {
      ...plan.filters,
      unwatched:
        plan.filters.unwatched ||
        people.ids.length > 1 ||
        /\bunwatched by\b/i.test(query),
    };
    const seen = togetherSeen(people.ids, d.ratings, d.watched);
    if (f.unwatched && !d.historyAvailable)
      return next({
        status: 503,
        message: 'Watch history is temporarily unavailable. Please retry.',
      });
    const tmdb = new TheMovieDb();
    const candidates: {
      media: MovieResult | TvResult;
      reason: string;
      runtime?: number | null;
    }[] = [];
    if (plan.suggestions.length) {
      // Small batches bound metadata concurrency; never trust model-supplied IDs.
      for (let i = 0; i < plan.suggestions.length; i += 3) {
        const rows = await Promise.all(
          plan.suggestions.slice(i, i + 3).map(async (s) => {
            const results =
              f.type === 'movie'
                ? (
                    await tmdb.searchMovies({
                      query: s.title,
                      year: s.year,
                      throwOnError: true,
                    })
                  ).results.map((x) => mapMovieResult(x))
                : (
                    await tmdb.searchTvShows({ query: s.title, year: s.year })
                  ).results.map((x) => mapTvResult(x));
            const matches = results.filter(
              (x) =>
                Number(
                  (x.mediaType === 'movie'
                    ? x.releaseDate
                    : x.firstAirDate
                  )?.slice(0, 4)
                ) === s.year &&
                [
                  x.mediaType === 'movie' ? x.title : x.name,
                  x.mediaType === 'movie' ? x.originalTitle : x.originalName,
                ].some((t) => normalizedTitle(t) === normalizedTitle(s.title))
            );
            return matches.length === 1
              ? { media: matches[0], reason: s.reason }
              : null;
          })
        );
        candidates.push(
          ...rows.filter((r): r is NonNullable<typeof r> => r !== null)
        );
      }
    } else {
      for (let page = 1; page <= 3; page++) {
        const common = {
          page,
          genre: f.genres.join(',') || undefined,
          withRuntimeLte: f.maxRuntime?.toString(),
        };
        const results =
          f.type === 'movie'
            ? (
                await tmdb.getDiscoverMovies({
                  ...common,
                  primaryReleaseDateGte: f.yearFrom
                    ? `${f.yearFrom}-01-01`
                    : undefined,
                  primaryReleaseDateLte: f.yearTo
                    ? `${f.yearTo}-12-31`
                    : undefined,
                })
              ).results.map((x) => mapMovieResult(x))
            : (
                await tmdb.getDiscoverTv({
                  ...common,
                  firstAirDateGte: f.yearFrom
                    ? `${f.yearFrom}-01-01`
                    : undefined,
                  firstAirDateLte: f.yearTo ? `${f.yearTo}-12-31` : undefined,
                })
              ).results.map((x) => mapTvResult(x));
        candidates.push(...results.map((media) => ({ media, reason: '' })));
        if (results.length < 20) break;
      }
    }
    const unique = [
      ...new Map(candidates.map((r) => [r.media.id, r])).values(),
    ];
    const related = await Media.getRelatedMedia(
      req.user,
      unique.map((r) => ({ tmdbId: r.media.id, mediaType: f.type }))
    );
    const results: typeof candidates = [];
    for (let i = 0; i < unique.length && results.length < 20; i += 3) {
      const batch = await Promise.all(
        unique.slice(i, i + 3).map(async (r) => {
          const m = related.find(
            (m) => m.tmdbId === r.media.id && m.mediaType === f.type
          );
          if (
            m?.status === MediaStatus.BLOCKLISTED ||
            m?.status4k === MediaStatus.BLOCKLISTED
          )
            return null;
          const key = `${f.type}:${r.media.id}`;
          if (
            (f.available && !d.available.has(key)) ||
            (f.unwatched && seen.has(key))
          )
            return null;
          let runtime: number | null = null;
          if (f.maxRuntime !== null) {
            if (f.type === 'movie')
              runtime = (await tmdb.getListMovie(r.media.id)).runtime || null;
            else {
              const times = (await tmdb.getTvShow({ tvId: r.media.id }))
                .episode_run_time;
              runtime = times?.length ? Math.max(...times) : null;
            }
          }
          const year = Number(
            (r.media.mediaType === 'movie'
              ? r.media.releaseDate
              : r.media.firstAirDate
            )?.slice(0, 4)
          );
          if (
            !matchesAiFilters(f, {
              available: d.available.has(key),
              watched: seen.has(key),
              runtime,
              year,
              genres: r.media.genreIds,
            })
          )
            return null;
          return { ...r, runtime, media: { ...r.media, mediaInfo: m } };
        })
      );
      results.push(
        ...batch.filter((r): r is NonNullable<typeof r> => r !== null)
      );
    }
    if (!d.visibilityStillValid())
      return next({ status: 409, message: 'Catalogue changed. Please retry.' });
    return res.json({
      results: results.slice(0, 20),
      filters: f,
      people: d.users.filter((u) => people.ids.includes(u.id)),
      note: plan.note,
      cached,
      limited: true,
    });
  } catch (e) {
    // Provider errors are sanitized; never serialize upstream errors or headers.
    return next({
      status: e.status || 502,
      message: e.status
        ? e.message
        : 'Could not load catalogue results. Please retry.',
    });
  }
});
export default router;
