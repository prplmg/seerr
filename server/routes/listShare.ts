import { readListStore } from '@server/lib/discoveryLists';
import {
  listPreview,
  listPreviewHtml,
  listPreviewImage,
} from '@server/lib/listSharePreview';
import { Router } from 'express';
const router = Router();
router.get('/:id/image', async (req, res, next) => {
  try {
    const preview = listPreview(readListStore(), String(req.params.id));
    if (!preview) return res.sendStatus(404);
    const image = await listPreviewImage(preview);
    const current = listPreview(readListStore(), preview.id);
    if (!current) return res.sendStatus(404);
    if (
      current.revision !== preview.revision ||
      current.publicList !== preview.publicList
    )
      return res
        .set('Cache-Control', 'no-store')
        .status(409)
        .send('List changed. Retry the preview.');
    return res.set('Cache-Control', 'no-store').type('png').send(image);
  } catch (e) {
    next(e);
  }
});
router.get('/:id', (req, res) => {
  const preview = listPreview(readListStore(), String(req.params.id));
  if (!preview)
    return res.status(404).type('text').send('This list is unavailable.');
  res.set('Cache-Control', 'private, no-store');
  if (req.user)
    return res.redirect(307, `/lists/${encodeURIComponent(preview.id)}`);
  return res.type('html').send(listPreviewHtml(preview));
});
export default router;
