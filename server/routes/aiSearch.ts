import TheMovieDb from '@server/api/themoviedb';
import { MediaStatus } from '@server/constants/media';
import Media from '@server/entity/Media';
import { readSearchHistory, rememberSearch } from '@server/lib/aiSearchHistory';
import { searchPeople } from '@server/lib/aiSearchPeople';
import {
  matchesAiFilters,
  normalizedTitle,
  parseAiFilters,
} from '@server/lib/aiSearchPlan';
import { interpretAiSearch } from '@server/lib/aiSearchProvider';
import { discoveryData } from '@server/lib/discoveryData';
import { togetherSeen } from '@server/lib/discoveryRecommendations';
import { collectListRatings } from '@server/lib/listSort';
import {
  mapMovieResult,
  mapTvResult,
  type MovieResult,
  type TvResult,
} from '@server/models/Search';
import { Router } from 'express';

const router = Router();
router.get('/history', async (req, res, next) => {
  try {
    return res.json({ searches: await readSearchHistory(req.user!.id) });
  } catch {
    return next({
      status: 503,
      message: 'Search history is temporarily unavailable.',
    });
  }
});
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
  const emit = (event: unknown) => {
    if (req.body.stream && !res.destroyed)
      res.write(JSON.stringify(event) + '\n');
  };
  const progress = (message: string) => emit({ kind: 'progress', message });
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
    let overrides;
    if (req.body.filters !== undefined) {
      try {
        overrides = parseAiFilters(req.body.filters);
      } catch {
        return next({ status: 400, message: 'Invalid search filters.' });
      }
    }
    if (req.body.stream) {
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
    }
    progress('Checking your catalogue…');
    const d = await discoveryData(req.user!.id);
    const people = searchPeople(req.user!.id, req.body.people, query, d.users);
    if (people.ids.length > 1 && !d.historyAvailable)
      throw Object.assign(
        Error('Watch history is temporarily unavailable. Please retry.'),
        { status: 503 }
      );
    progress(overrides ? 'Reusing your search…' : 'Understanding your search…');
    const { plan, cached } = await interpretAiSearch(
      req.user!.id,
      people.query,
      Boolean(overrides)
    );
    if (overrides && overrides.type !== plan.filters.type)
      throw Object.assign(
        Error('Change movies or series in your description and search again.'),
        { status: 400 }
      );
    const base = overrides ?? plan.filters;
    const f = {
      ...base,
      unwatched:
        base.unwatched ||
        people.ids.length > 1 ||
        (!overrides && /\bunwatched by\b/i.test(query)),
    };
    const seen = togetherSeen(people.ids, d.ratings, d.watched);
    if (f.unwatched && !d.historyAvailable)
      throw Object.assign(
        Error('Watch history is temporarily unavailable. Please retry.'),
        { status: 503 }
      );
    progress(f.type === 'movie' ? 'Finding movies…' : 'Finding series…');
    const tmdb = new TheMovieDb();
    const candidates: {
      media: MovieResult | TvResult;
      reason: string;
      runtime?: number | null;
      letterboxdRating?: number;
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
    const checks = [
      f.available ? 'availability' : null,
      f.unwatched ? 'watched status' : null,
      f.yearFrom || f.yearTo ? 'release years' : null,
      f.genres.length ? 'genres' : null,
    ].filter(Boolean);
    progress(
      checks.length
        ? `Checking ${checks.join(', ')}…`
        : 'Checking catalogue matches…'
    );
    const related = await Media.getRelatedMedia(
      req.user,
      unique.map((r) => ({ tmdbId: r.media.id, mediaType: f.type }))
    );
    const results: typeof candidates = [];
    let runtimeProgress = false;
    for (
      let i = 0;
      i < unique.length &&
      results.length <
        (f.minLetterboxdRating != null || f.maxLetterboxdRating != null
          ? 60
          : 20);
      i += 3
    ) {
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
          const year = Number(
            (r.media.mediaType === 'movie'
              ? r.media.releaseDate
              : r.media.firstAirDate
            )?.slice(0, 4)
          );
          if (
            !matchesAiFilters(
              { ...f, maxRuntime: null },
              {
                available: d.available.has(key),
                watched: seen.has(key),
                runtime: null,
                year,
                genres: r.media.genreIds,
              }
            )
          )
            return null;
          let runtime: number | null = null;
          if (f.maxRuntime !== null) {
            if (!runtimeProgress) {
              runtimeProgress = true;
              progress('Checking runtimes…');
            }
            if (f.type === 'movie')
              runtime = (await tmdb.getListMovie(r.media.id)).runtime || null;
            else {
              const times = (await tmdb.getTvShow({ tvId: r.media.id }))
                .episode_run_time;
              runtime = times?.length ? Math.max(...times) : null;
            }
          }
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
    let filteredResults = results;
    let ratingCoverage: { checked: number; unknown: number } | undefined;
    if (f.minLetterboxdRating != null || f.maxLetterboxdRating != null) {
      const scores = await collectListRatings(
        results.map((row) => ({ tmdbId: row.media.id, type: f.type })),
        (completed, total) =>
          progress(`Checking Letterboxd ratings… ${completed}/${total}`)
      );
      let unknown = 0;
      filteredResults = results.flatMap((row) => {
        const score = scores.get(`${f.type}:${row.media.id}`);
        if (score == null) {
          unknown++;
          return [];
        }
        return (f.minLetterboxdRating == null ||
          score >= f.minLetterboxdRating) &&
          (f.maxLetterboxdRating == null || score <= f.maxLetterboxdRating)
          ? [{ ...row, letterboxdRating: score }]
          : [];
      });
      ratingCoverage = { checked: results.length - unknown, unknown };
    }
    if (!d.visibilityStillValid())
      throw Object.assign(Error('Catalogue changed. Please retry.'), {
        status: 409,
      });
    // Chip edits and History reopens reuse the prompt; do not create or
    // overwrite a history entry with manually changed filters.
    if (!overrides) await rememberSearch(req.user!.id, query, people.ids, f);
    const response = {
      results: filteredResults.slice(0, 20),
      ratingCoverage,
      filters: f,
      people: d.users.filter((u) => people.ids.includes(u.id)),
      note: plan.note,
      cached,
      limited: true,
    };
    if (req.body.stream) {
      emit({ kind: 'result', data: response });
      return res.end();
    }
    return res.json(response);
  } catch (e) {
    if (res.headersSent) {
      emit({
        kind: 'error',
        message: e.status
          ? e.message
          : 'Could not load catalogue results. Please retry.',
      });
      return res.end();
    }
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
