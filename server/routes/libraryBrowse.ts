import Media from '@server/entity/Media';
import type { User } from '@server/entity/User';
import { parseAiFilters } from '@server/lib/aiSearchPlan';
import { parseAiSort } from '@server/lib/aiSearchSort';
import {
  libraryJob,
  refreshLibraryJob,
  startLibraryBrowse,
} from '@server/lib/libraryBrowse';
import { Router } from 'express';
const router = Router();
// Hydrate only the returned page; progress checks never query media metadata.
async function withMediaStatus(
  result: ReturnType<typeof libraryJob>,
  user: User
) {
  if (!result.ready || !result.results?.length) return result;
  const related = await Media.getRelatedMedia(
    user,
    result.results.map(({ media }) => ({
      tmdbId: media.id,
      mediaType: media.mediaType,
    }))
  );
  return {
    ...result,
    results: result.results.map((row) => ({
      ...row,
      media: {
        ...row.media,
        mediaInfo: related.find(
          (m) =>
            m.tmdbId === row.media.id && m.mediaType === row.media.mediaType
        ),
      },
    })),
  };
}

const pageNumber = (raw: unknown) => {
  const p = Number(raw ?? 0);
  if (!Number.isInteger(p) || p < 0 || p > 10000)
    throw Object.assign(Error('Invalid page'), { status: 400 });
  return p;
};
router.post('/', async (req, res, next) => {
  try {
    let filters, sort;
    try {
      filters = parseAiFilters(req.body.filters);
      sort = parseAiSort(
        req.body.sort?.length
          ? req.body.sort
          : [{ field: 'added', direction: 'desc' }]
      );
    } catch {
      throw Object.assign(Error('Invalid library filters or sorting'), {
        status: 400,
      });
    }
    return res.json(
      await withMediaStatus(
        await startLibraryBrowse(
          req.user!.id,
          filters,
          sort,
          req.body.people,
          pageNumber(req.body.page),
          req.body.allTypes === true
        ),
        req.user!
      )
    );
  } catch (e) {
    return next({
      status: e.status ?? 503,
      message: e.status ? e.message : 'Could not load available titles.',
    });
  }
});
router.get('/:id', async (req, res, next) => {
  try {
    return res.json(
      await withMediaStatus(
        await refreshLibraryJob(
          req.user!.id,
          String(req.params.id),
          pageNumber(req.query.page)
        ),
        req.user!
      )
    );
  } catch (e) {
    return next({ status: e.status ?? 503, message: e.message });
  }
});
export default router;
