import { MediaStatus } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { curatedLists, dailyCategories } from '@server/lib/curatedLists';
import { Router } from 'express';

const router = Router();
router.get('/', (req, res) => {
  const limit = Number(req.query.limit ?? 15);
  if (limit !== 15 && limit !== 25)
    return res.status(400).json({ message: 'Invalid category limit' });
  res.setHeader('Cache-Control', 'private, no-cache');
  res.json(dailyCategories(undefined, new Date(), limit));
});
router.get('/random', async (req, res, next) => {
  try {
    const query = getRepository(Media)
      .createQueryBuilder('media')
      .select(['media.id', 'media.tmdbId', 'media.mediaType'])
      .where('media.mediaType IN (:...types)', { types: ['movie', 'tv'] })
      .andWhere(
        '((media.status IN (:...available) AND media.ratingKey IS NOT NULL) OR (media.status4k IN (:...available) AND media.ratingKey4k IS NOT NULL))',
        { available: [MediaStatus.AVAILABLE, MediaStatus.PARTIALLY_AVAILABLE] }
      )
      .andWhere('media.status != :blocked AND media.status4k != :blocked', {
        blocked: MediaStatus.BLOCKLISTED,
      });
    const exclude = Number(req.query.exclude);
    if (Number.isSafeInteger(exclude) && exclude > 0)
      query.andWhere('media.id != :exclude', { exclude });
    const result = await query.orderBy('RANDOM()').limit(1).getOne();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ result: result ?? null });
  } catch (error) {
    next(error);
  }
});
router.get('/:id', (req, res) => {
  const list = curatedLists.find((list) => list.id === req.params.id);
  if (!list) return res.status(404).json({ message: 'Category not found' });
  return res.json(list);
});
export default router;
