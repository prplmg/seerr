import { syncMappedAvatars } from '@server/lib/accountAvatarSync';
import {
  effectiveAccountMappings,
  plexMappingProfiles,
} from '@server/lib/accountMappingProfiles';
import {
  mappingRevision,
  readAccountMappings,
  saveAccountMappings,
  validateAccountMappings,
} from '@server/lib/accountMappings';
import { avatarMigrationActive } from '@server/lib/catalogueMigration';
import { Permission } from '@server/lib/permissions';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const router = Router();
let checkingAvatars = false;
router.use(isAuthenticated(Permission.ADMIN));
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});
router.get('/', async (_req, res) => {
  try {
    const [users, profiles] = await Promise.all([
      effectiveAccountMappings(),
      plexMappingProfiles(),
    ]);
    return res.json({
      users,
      profiles: profiles.map(({ id, title }) => ({ id, title })),
      revision: mappingRevision(readAccountMappings()),
      avatarEditable: avatarMigrationActive(),
    });
  } catch {
    return res
      .status(503)
      .json({ message: 'Account mapping sources unavailable' });
  }
});
router.post('/check', async (_req, res) => {
  if (checkingAvatars)
    return res.status(409).json({ message: 'Check already running' });
  checkingAvatars = true;
  try {
    // Uses the exact scheduler implementation, without changing any user records.
    return res.json(await syncMappedAvatars(true));
  } catch {
    return res.status(503).json({
      message: 'Avatar mapping verification failed; no avatars changed',
    });
  } finally {
    checkingAvatars = false;
  }
});
router.put('/', async (req, res) => {
  try {
    const document = validateAccountMappings(req.body.document);
    const [users, profiles] = await Promise.all([
      effectiveAccountMappings(),
      plexMappingProfiles(),
    ]);
    for (const row of document.users) {
      if (!users.some((user) => user.userId === row.userId))
        return res.sendStatus(400);
      if (
        [row.avatarPlexId, row.playbackPlexId, row.watchlistPlexId].some(
          (id) => id !== null && !profiles.some((profile) => profile.id === id)
        )
      )
        return res.sendStatus(400);
    }
    // The legacy avatar task still owns avatars until its scheduler replacement is verified.
    if (
      !avatarMigrationActive() &&
      document.users.some(
        (row) =>
          row.avatarPlexId !==
            users.find((u) => u.userId === row.userId)?.mapping.avatarPlexId ||
          row.avatarSource !==
            users.find((u) => u.userId === row.userId)?.mapping.avatarSource
      )
    )
      return res
        .status(409)
        .json({ message: 'Avatar migration has not been activated' });
    const existing = readAccountMappings();
    const changed = new Set(document.users.map((row) => row.userId));
    return res.json(
      saveAccountMappings(
        {
          version: 1,
          users: [
            ...existing.users.filter((row) => !changed.has(row.userId)),
            ...document.users,
          ],
        },
        String(req.body.revision)
      )
    );
  } catch (error) {
    return res
      .status(error.message === 'Mapping revision conflict' ? 409 : 400)
      .json({ message: 'Mappings could not be saved; refresh and retry' });
  }
});
export default router;
