import {
  exchangeBrowserLists,
  pendingBrowserList,
} from '@server/lib/discoveryBrowser';
import {
  browserExchange,
  browserPending,
  browserTokenMatches,
} from '@server/lib/letterboxdBrowser';
import {
  exchangeObservations,
  exchangeWrites,
  parseSupportedObservations,
  parseSupportedWriteKinds,
} from '@server/lib/letterboxdWriteWorker';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
const router = Router();
router.use(rateLimit({ windowMs: 60000, max: 60 }));
router.post('/lists', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const auth = req.header('Authorization') || '';
  if (
    !auth.startsWith('Bearer ') ||
    auth.length > 200 ||
    !browserTokenMatches(auth.slice(7))
  )
    return res.sendStatus(403);
  if (
    req.body.version !== 1 ||
    req.body.supported !== true ||
    typeof req.body.instance !== 'string'
  )
    return res.sendStatus(400);
  try {
    return res.json(
      exchangeBrowserLists(
        req.body.instance,
        req.body.report,
        req.body.inPrivateAllowed === true
      )
    );
  } catch {
    return res.status(409).json({ message: 'List delivery rejected' });
  }
});
router.post('/observations', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const auth = req.header('Authorization') || '';
    if (
      !auth.startsWith('Bearer ') ||
      auth.length > 200 ||
      !browserTokenMatches(auth.slice(7))
    )
      return res.sendStatus(403);
    if (
      req.body.version !== 1 ||
      typeof req.body.instance !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(req.body.instance)
    )
      return res.sendStatus(400);
    let supported;
    try {
      supported = parseSupportedObservations(req.body.supported);
    } catch {
      return res.sendStatus(400);
    }
    return res.json(
      await exchangeObservations(req.body.instance, req.body.report, supported)
    );
  } catch {
    return res
      .status(409)
      .json({ message: 'Observation report or binding rejected' });
  }
});
router.post('/writes', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const auth = req.header('Authorization') || '';
    if (
      !auth.startsWith('Bearer ') ||
      auth.length > 200 ||
      !browserTokenMatches(auth.slice(7))
    )
      return res.sendStatus(403);
    if (req.body.version !== 1 || typeof req.body.instance !== 'string')
      return res.sendStatus(400);
    let supported;
    try {
      supported = parseSupportedWriteKinds(req.body.supported);
    } catch {
      return res.sendStatus(400);
    }
    return res.json(
      await exchangeWrites(req.body.instance, req.body.report, supported)
    );
  } catch {
    return res
      .status(409)
      .json({ message: 'Write report or binding rejected' });
  }
});
router.get('/pending', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const authorization = req.header('Authorization') || '';
    if (
      !authorization.startsWith('Bearer ') ||
      authorization.length > 200 ||
      !browserTokenMatches(authorization.slice(7))
    )
      return res.sendStatus(403);
    if (
      typeof req.query.instance !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(req.query.instance)
    )
      return res.sendStatus(400);
    const result = await browserPending(req.query.instance);
    return res.json(
      result.pending ? result : pendingBrowserList(req.query.instance)
    );
  } catch {
    return res.sendStatus(503);
  }
});
// Dedicated credential: no catalogue user privileges, no arbitrary actions or URLs.
router.post('/exchange', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const authorization = req.header('Authorization') || '';
    if (
      !authorization.startsWith('Bearer ') ||
      authorization.length > 200 ||
      !browserTokenMatches(authorization.slice(7))
    )
      return res.sendStatus(403);
    if (req.body.version !== 1 || typeof req.body.instance !== 'string')
      return res.sendStatus(400);
    return res.json(
      await browserExchange(
        req.body.instance,
        req.body.report,
        req.body.exportCapable === true
      )
    );
  } catch {
    return res.status(409).json({
      message:
        'Browser report could not be accepted; check the account binding',
    });
  }
});
export default router;
