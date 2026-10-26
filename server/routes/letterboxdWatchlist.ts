import { getRepository } from '@server/datasource';
import { LetterboxdAccount } from '@server/entity/MovieReview';
import { readBrowserState } from '@server/lib/letterboxdBrowser';
import { matchWatchlistFilm } from '@server/lib/letterboxdWatchlistMatch';
import { Router } from 'express';
const router = Router();
router.get('/mine/film/:slug/status', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (!/^[a-z0-9-]{1,200}$/.test(req.params.slug)) return res.sendStatus(400);
    const linked = await getRepository(LetterboxdAccount).findOneBy({
      userId: req.user!.id,
    });
    const binding = readBrowserState().bindings.find(
      (b) => b.userId === req.user!.id
    );
    const valid =
      !!linked?.enabled &&
      !!binding?.enabled &&
      linked.username === binding.username;
    return res.json({
      writeEnabled: false,
      member: valid
        ? (binding?.snapshot?.items.some((i) => i.slug === req.params.slug) ??
          null)
        : null,
    });
  } catch {
    return res.sendStatus(503);
  }
});
router.put('/mine/film/:slug', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(403).json({message:'Letterboxd watchlist publishing is disabled'});
});
router.get('/:userId/film/:slug', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const userId = Number(req.params.userId);
  const slug = String(req.params.slug);
  if (
    !Number.isSafeInteger(userId) ||
    userId < 1 ||
    !/^[a-z0-9-]{1,200}$/.test(slug)
  )
    return res.sendStatus(400);
  try {
    const account = await getRepository(LetterboxdAccount).findOne({
      where: { userId },
    });
    const binding = readBrowserState().bindings.find(
      (row) => row.userId === userId && row.username === account?.username
    );
    if (
      !account?.enabled ||
      !binding?.enabled ||
      !binding.snapshot?.items.some((item) => item.slug === slug)
    )
      return res.sendStatus(404);
    const match = await matchWatchlistFilm(slug);
    return res.json({ resolved: !!match, ...match });
  } catch {
    return res.sendStatus(503);
  }
});
router.get('/:userId', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const userId = Number(req.params.userId),
    page = Number(req.query.page || 1);
  if (
    !Number.isSafeInteger(userId) ||
    userId < 1 ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 250
  )
    return res.sendStatus(400);
  try {
    const account = await getRepository(LetterboxdAccount).findOne({
      where: { userId },
    });
    const binding = readBrowserState().bindings.find(
      (row) => row.userId === userId && row.username === account?.username
    );
    if (!account?.enabled || !binding?.enabled || !binding.snapshot)
      return res.json({ available: false, results: [] });
    const items = binding.snapshot.items;
    return res.json({
      available: true,
      username: account.username,
      page,
      totalPages: Math.ceil(items.length / 20),
      totalResults: items.length,
      stale: !!binding.issue,
      results: items.slice((page - 1) * 20, page * 20),
    });
  } catch {
    return res.sendStatus(503);
  }
});
export default router;
