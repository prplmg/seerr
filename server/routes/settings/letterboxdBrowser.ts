import { getRepository } from '@server/datasource';
import { LetterboxdExportBaseline } from '@server/entity/LetterboxdExport';
import { LetterboxdAccount } from '@server/entity/MovieReview';
import {
  bindLetterboxdBrowser,
  readBrowserState,
  rotateBrowserToken,
} from '@server/lib/letterboxdBrowser';
import { readPlaybackConfig } from '@server/lib/letterboxdPlaybackConfig';
import { summarizeWorkerHealth } from '@server/lib/letterboxdSyncHealth';
import {
  readWriteState,
  setWriteEnabled,
  updateWriteState,
} from '@server/lib/letterboxdWriteQueue';
import { Permission } from '@server/lib/permissions';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';
const router = Router();
router.use(isAuthenticated(Permission.ADMIN));
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});
router.get('/', async (_req, res) => {
  try {
    const state = readBrowserState();
    const writes = readWriteState();
    const exports = await getRepository(LetterboxdExportBaseline).find();
    return res.json({
      configured: !!state.tokenHash,
      bindings: state.bindings.map(({ snapshot, ...row }) => ({
        ...row,
        syncHealth: summarizeWorkerHealth(
          row.workerHealth,
          writes.intents.filter(
            (i) => i.userId === row.userId && i.account === row.username
          )
        ),
        reconciliationHolds:
          JSON.parse(
            exports.find((e) => e.userId === row.userId)?.value || '{}'
          ).holds || [],
        writeEnabled:
          !!writes.settings[row.userId]?.enabled &&
          writes.settings[row.userId]?.account === row.username,
        writePilotEligible: row.enabled,
        writeQueue: writes.intents.reduce(
          (counts, intent) => {
            if (
              intent.userId === row.userId &&
              intent.account === row.username &&
              Object.prototype.hasOwnProperty.call(counts, intent.state)
            ) {
              counts[intent.state as keyof typeof counts]++;
            }
            return counts;
          },
          { queued: 0, dispatched: 0, verified: 0, conflict: 0, unknown: 0 }
        ),
        itemCount: snapshot?.items.length,
        captured: snapshot?.captured,
      })),
    });
  } catch {
    return res.sendStatus(503);
  }
});
router.put('/writes', async (req, res) => {
  try {
    const { userId, enabled } = req.body;
    if (
      !Number.isSafeInteger(userId) ||
      userId < 1 ||
      typeof enabled !== 'boolean'
    )
      return res.sendStatus(400);
    if (!enabled) {
      updateWriteState((state) => {
        const old = state.settings[userId];
        if (old) setWriteEnabled(state, userId, old.account, false);
      });
      return res.json({ saved: true });
    }
    const account = await getRepository(LetterboxdAccount).findOneBy({
      userId,
    });
    const binding = readBrowserState().bindings.find(
      (b) => b.userId === userId
    );
    if (
      !account?.enabled ||
      !binding?.enabled ||
      account.username !== binding.username
    )
      return res.sendStatus(409);
    if (enabled && (binding.issue || !binding.lastSuccess))
      return res.sendStatus(409);
    const baseline = await getRepository(LetterboxdExportBaseline).findOneBy({
      userId,
    });
    const snapshot = baseline ? JSON.parse(baseline.value) : null;
    if (
      !baseline ||
      baseline.account !== account.username ||
      snapshot?.snapshot?.complete !== true ||
      snapshot?.snapshot?.account !== account.username ||
      !Number.isFinite(snapshot.capturedAt) ||
      Date.now() - snapshot.capturedAt > 24 * 60 * 60 * 1000 ||
      snapshot.capturedAt > Date.now() ||
      !binding.lastSeen ||
      Date.now() - binding.lastSeen > 10 * 60 * 1000 ||
      (snapshot.holds || []).length
    ) {
      return res.status(409).json({
        code: 'account-readiness-required',
        message:
          'A recent complete export, active browser, and resolved reconciliation holds are required.',
      });
    }
    try {
      readPlaybackConfig();
    } catch {
      return res.status(409).json({
        code: 'playback-configuration-required',
        message:
          'Configure letterboxdPlayback.sourceId and letterboxdPlayback.timezone in social.json before enabling publishing.',
      });
    }
    updateWriteState((state) =>
      setWriteEnabled(state, userId, account.username, enabled)
    );
    return res.json({ saved: true });
  } catch {
    return res.status(400).json({
      message:
        'Write setting rejected; check the linked account and browser readiness.',
    });
  }
});
router.post('/token', (_req, res) => {
  try {
    return res.json({ token: rotateBrowserToken() });
  } catch {
    return res.sendStatus(503);
  }
});
router.put('/', async (req, res) => {
  try {
    await bindLetterboxdBrowser(
      req.body.userId,
      req.body.instance,
      req.body.enabled
    );
    return res.json({ saved: true });
  } catch {
    return res.status(400).json({
      message:
        'Could not bind browser. Check the linked account and pilot profile.',
    });
  }
});
export default router;
