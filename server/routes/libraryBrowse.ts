import { parseAiFilters } from '@server/lib/aiSearchPlan';
import { parseAiSort } from '@server/lib/aiSearchSort';
import { libraryJob, startLibraryBrowse } from '@server/lib/libraryBrowse';
import { Router } from 'express';
const router = Router();
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
      sort = parseAiSort(req.body.sort ?? []);
    } catch {
      throw Object.assign(Error('Invalid library filters or sorting'), {
        status: 400,
      });
    }
    return res.json(
      await startLibraryBrowse(
        req.user!.id,
        filters,
        sort,
        req.body.people,
        pageNumber(req.body.page)
      )
    );
  } catch (e) {
    return next({
      status: e.status ?? 503,
      message: e.status ? e.message : 'Could not load available titles.',
    });
  }
});
router.get('/:id', (req, res, next) => {
  try {
    return res.json(
      libraryJob(
        req.user!.id,
        String(req.params.id),
        pageNumber(req.query.page)
      )
    );
  } catch (e) {
    return next({ status: e.status ?? 503, message: e.message });
  }
});
export default router;
