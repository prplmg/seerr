import PlexAPI from '@server/api/plexapi';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import type { ActivityRow, PartySnapshot } from '@server/lib/watchingNow';
import { mergeWatchingNow } from '@server/lib/watchingNow';
import { appDataPath } from '@server/utils/appDataVolume';
import axios from 'axios';
import { createHmac, randomUUID } from 'crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';

type Social = {
  enabled: boolean;
  hiddenWatchers: number[];
  tautulliUrl: string;
  tautulliKey: string;
  mappingScript: string;
};
type Config = {
  enabled: boolean;
  relayUrl: string;
  browserRelayUrl: string;
  secret: string;
};
const read = (name: string) =>
  JSON.parse(
    fs
      .readFileSync(path.join(appDataPath(), name), 'utf8')
      .replace(/^\uFEFF/, '')
  );
function social(): Social {
  const p = read('social.json');
  if (typeof p.enabled !== 'boolean' || !Array.isArray(p.hiddenWatchers))
    throw Error('Invalid policy');
  return p;
}
function config(): Config | undefined {
  try {
    const p = read('watch-party.json');
    if (!p.enabled) return undefined;
    if (typeof p.secret !== 'string' || p.secret.length < 32)
      throw Error('Invalid party configuration');
    return p;
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}
// Single-flight and short TTL: one upstream request per source, not per card/tab.
const cache = new Map<string, { until: number; data: unknown }>();
const pending = new Map<string, Promise<unknown>>();
async function snapshot<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.data as T;
  if (pending.has(key)) return pending.get(key) as Promise<T>;
  const work = load().then((data) => {
    cache.set(key, {
      data,
      until: Date.now() + (key.startsWith('relay:') ? 1000 : 5000),
    });
    return data;
  });
  pending.set(key, work);
  try {
    return await work;
  } finally {
    pending.delete(key);
  }
}
async function relay(
  p: Config,
  method: 'get' | 'post',
  resource: string,
  data?: unknown
) {
  return (
    await axios({
      method,
      url: `${p.relayUrl.replace(/\/$/, '')}/catalogue/${resource}`,
      data,
      timeout: 5000,
      maxRedirects: 0,
      headers: { Authorization: `Bearer ${p.secret}` },
    })
  ).data;
}
async function rooms(p: Config): Promise<PartySnapshot[]> {
  return snapshot(`relay:${p.relayUrl}`, () => relay(p, 'get', 'rooms'));
}
const router = Router();
async function cataloguePlex() {
  // Local catalogue accounts need not own a Plex token. Metadata lookup uses the
  // configured library owner; playback itself still uses the browser's Plex login.
  const owner = await getRepository(User).findOne({
    where: { id: 1 },
    select: { id: true, plexToken: true },
  });
  if (!owner?.plexToken) throw Error('Plex is not configured');
  return new PlexAPI({ plexToken: owner.plexToken, timeout: 5000 });
}
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});
router.get('/', async (req, res) => {
  try {
    let policy = social();
    const cfg = config();
    if (!policy.enabled)
      return res.json({ enabled: false, partiesEnabled: false, results: [] });
    const [activity, partyData, users, media] = await Promise.all([
      snapshot<ActivityRow[]>(`activity:${policy.tautulliUrl}`, async () => {
        const result = (
          await axios.get(`${policy.tautulliUrl.replace(/\/$/, '')}/api/v2`, {
            params: { apikey: policy.tautulliKey, cmd: 'get_activity' },
            timeout: 5000,
          })
        ).data.response;
        if (
          result?.result !== 'success' ||
          !Array.isArray(result.data?.sessions)
        )
          throw Error('Activity unavailable');
        return result.data.sessions;
      }).then(
        (data) => ({ available: true, data }),
        () => ({ available: false, data: [] as ActivityRow[] })
      ),
      (cfg ? rooms(cfg) : Promise.resolve([])).then(
        (data) => ({ available: !!cfg, data }),
        () => ({ available: false, data: [] as PartySnapshot[] })
      ),
      getRepository(User).find(),
      getRepository(Media).find({
        select: [
          'tmdbId',
          'mediaType',
          'ratingKey',
          'ratingKey4k',
          'status',
          'status4k',
        ],
      }),
    ]);
    const mapped = new Map<string, number>();
    for (const user of users)
      if (user.plexId) mapped.set(String(user.plexId), user.id);
    const block = fs
      .readFileSync(policy.mappingScript, 'utf8')
      .match(/const mappings = \[([\s\S]*?)\];/)?.[1];
    if (!block) throw Error('Mapping unavailable');
    for (const m of block.matchAll(
      /\['(\d+)'\s*,\s*'[^']+'\s*,\s*(\d+)\s*,\s*'([^']+)'\]/g
    )) {
      const user = users.find(
        (u) => u.id === Number(m[2]) && u.username === m[3]
      );
      if (user) mapped.set(m[1], user.id);
    }
    policy = social(); // Reapply opt-outs after I/O; never serialize raw sessions.
    if (!policy.enabled)
      return res.json({ enabled: false, partiesEnabled: false, results: [] });
    const allowedMedia = media.filter(
      (m) =>
        m.status !== MediaStatus.BLOCKLISTED &&
        m.status4k !== MediaStatus.BLOCKLISTED
    );
    const allowedKeys = new Set(
      allowedMedia.map((m) => `${m.mediaType}:${m.tmdbId}`)
    );
    return res.json({
      enabled: true,
      partiesEnabled: !!cfg,
      extensionVersion: '0.0.2',
      activityAvailable: activity.available,
      relayAvailable: partyData.available,
      results: mergeWatchingNow(
        activity.data,
        partyData.data.filter((p) =>
          allowedKeys.has(`${p.mediaType}:${p.tmdbId}`)
        ),
        allowedMedia,
        new Map(
          users.map((u) => [
            u.id,
            { id: u.id, name: u.displayName, avatar: u.avatar },
          ])
        ),
        mapped,
        policy.hiddenWatchers,
        req.user!.id
      ),
    });
  } catch {
    return res.status(503).json({ error: 'Watching information unavailable' });
  }
});

router.get('/episodes/:tmdbId', async (req, res) => {
  try {
    if (!config() || !social().enabled) return res.sendStatus(503);
    const tmdbId = Number(req.params.tmdbId);
    if (!Number.isSafeInteger(tmdbId) || tmdbId < 1) return res.sendStatus(400);
    const media = await getRepository(Media).findOne({
      where: { tmdbId, mediaType: MediaType.TV },
    });
    if (
      !media?.ratingKey ||
      media.status === MediaStatus.BLOCKLISTED ||
      media.status4k === MediaStatus.BLOCKLISTED
    )
      return res.sendStatus(404);
    const plex = await cataloguePlex();
    const seasons = await plex.getChildrenMetadata(media.ratingKey);
    const results: {
      key: string;
      title: string;
      season: number;
      episode: number;
    }[] = [];
    // Bounded, sequential metadata reads; no media scanning or downloads.
    for (const season of seasons
      .filter((s) => s.type === 'season')
      .slice(0, 100)) {
      for (const episode of await plex.getChildrenMetadata(season.ratingKey)) {
        if (
          episode.type === 'episode' &&
          String(episode.grandparentRatingKey) === String(media.ratingKey)
        )
          results.push({
            key: episode.ratingKey,
            title: episode.title,
            season: episode.parentIndex ?? season.index,
            episode: episode.index,
          });
      }
    }
    return res.json({ results });
  } catch {
    return res.status(503).json({ error: 'Episodes unavailable' });
  }
});

router.post(
  '/launch',
  rateLimit({ windowMs: 60000, limit: 10 }),
  async (req, res) => {
    try {
      const p = config();
      if (!p || !social().enabled)
        return res
          .status(503)
          .json({ error: 'Watch parties are not configured' });
      const { tmdbId, mediaType, partyId, episodeKey } = req.body;
      if (
        !Number.isSafeInteger(tmdbId) ||
        tmdbId < 1 ||
        !['movie', 'tv'].includes(mediaType) ||
        (partyId !== undefined && !/^cat-[a-f0-9-]{36}$/.test(partyId))
      )
        return res.status(400).json({ error: 'Invalid media or party' });
      const media = await getRepository(Media).findOne({
        where: { tmdbId, mediaType: mediaType as MediaType },
      });
      if (
        !media?.ratingKey ||
        media.status === MediaStatus.BLOCKLISTED ||
        media.status4k === MediaStatus.BLOCKLISTED
      )
        return res.status(404).json({ error: 'Media is not available' });
      let ratingKey = String(media.ratingKey);
      if (partyId) {
        const existing = (
          (await relay(p, 'get', 'rooms')) as PartySnapshot[]
        ).find(
          (r) =>
            r.id === partyId && r.tmdbId === tmdbId && r.mediaType === mediaType
        );
        if (!existing)
          return res.status(409).json({ error: 'This party has ended' });
        ratingKey = existing.ratingKey;
      } else if (mediaType === 'tv') {
        if (typeof episodeKey !== 'string' || !/^\d+$/.test(episodeKey))
          return res.status(400).json({ error: 'Choose a specific episode' });
        ratingKey = episodeKey;
      }
      const plex = await cataloguePlex();
      const metadata = await plex.getMetadata(ratingKey);
      if (
        metadata.type !== (mediaType === 'tv' ? 'episode' : 'movie') ||
        (mediaType === 'tv' &&
          String(metadata.grandparentRatingKey) !== String(media.ratingKey))
      )
        return res
          .status(400)
          .json({ error: 'Episode does not belong to this series' });
      const id = partyId || `cat-${randomUUID()}`;
      if (!partyId)
        await relay(p, 'post', 'rooms', {
          id,
          tmdbId,
          mediaType,
          ratingKey,
          duration: Number(metadata.duration || 0) / 1000,
        });
      const claims = {
        roomId: id,
        userId: req.user!.id,
        exp: Math.floor(Date.now() / 1000) + 600,
      };
      const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const ticket = `${body}.${createHmac('sha256', p.secret).update(body).digest('base64url')}`;
      const serverId = getSettings().plex.machineId;
      const plexUrl = `https://app.plex.tv/desktop/#!/server/${serverId}/details?key=${encodeURIComponent(`/library/metadata/${ratingKey}`)}`;
      cache.delete(`relay:${p.relayUrl}`);
      return res.json({
        roomId: id,
        ticket,
        extensionVersion: '0.0.2',
        catalogueUrl: `https://catalogue.prpl.com.mx/${mediaType}/${tmdbId}`,
        username: req.user!.displayName,
        plexUrl,
        mediaType: mediaType === 'tv' ? 'episode' : 'movie',
        launchMode: partyId ? 'join' : 'create',
        serverUrl: p.browserRelayUrl,
      });
    } catch {
      return res.status(503).json({
        error: 'Unable to prepare this party. Check Plex access and the relay.',
      });
    }
  }
);

// Browser builds are served by the catalogue, never by an arbitrary client URL.
router.get('/extension/:browser', (req, res) => {
  if (!['chrome', 'firefox'].includes(String(req.params.browser)))
    return res.sendStatus(404);
  const file = path.join(
    appDataPath(),
    'watch-party-extensions',
    `multimeldia-sync-${req.params.browser}.zip`
  );
  if (!fs.existsSync(file)) return res.sendStatus(404);
  return res.download(file, 'multimeldia-sync.zip');
});
export default router;
