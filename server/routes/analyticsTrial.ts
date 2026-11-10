import { analyticsTrialConfig } from '@server/lib/analyticsTrialConfig';
import logger from '@server/logger';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
const router = Router();
router.use(
  rateLimit({
    windowMs: 60_000,
    max: 20,
    keyGenerator: (req) => String(req.user!.id),
  })
);
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});
router.get('/config', (_req, res) => res.json(analyticsTrialConfig()));
router.post('/metrics', (req, res) => {
  const { session, variant, page, metrics } = req.body || {};
  const allowed = [
    'mounted',
    'longTasks',
    'longTaskMs',
    'fcp',
    'lcp',
    'maxInteractionMs',
    'elapsed',
    'width',
    'assigned',
    'sdkRequested',
    'sdkReady',
    'sdkFailed',
  ];
  if (process.env.POSTHOG_TRIAL_ENABLED !== 'true') return res.sendStatus(204);
  if (
    typeof session !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(session) ||
    !['off', 'events', 'replay'].includes(variant) ||
    ![
      '/',
      '/for-you',
      '/find-to-watch',
      '/ai-search',
      '/movie/:id',
      '/tv/:id',
      'excluded',
    ].includes(page) ||
    !metrics ||
    typeof metrics !== 'object' ||
    Array.isArray(metrics) ||
    Object.keys(metrics).some(
      (k) =>
        !allowed.includes(k) ||
        !Number.isFinite(metrics[k]) ||
        metrics[k] < 0 ||
        metrics[k] > 86_400_000
    )
  )
    return res.sendStatus(400);
  const record = { userId: req.user!.id, session, variant, page, metrics };
  setImmediate(() =>
    logger.info('PostHog trial performance', {
      label: 'Analytics Trial',
      ...record,
    })
  );
  return res.sendStatus(204);
});
export default router;
