import PlexAPI from '@server/api/plexapi';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import { preferredPartyEpisode } from '@server/lib/partyEpisodePreference';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import type { ActivityRow, PartySnapshot } from '@server/lib/watchingNow';
import { mergeWatchingNow } from '@server/lib/watchingNow';
import { isAuthenticated } from '@server/middleware/auth';
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
  extensionVersion?: string;
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
    if (
      p.extensionVersion !== undefined &&
      !/^\d+\.\d+\.\d+$/.test(p.extensionVersion)
    )
      throw Error('Invalid extension version');
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
// Coarse, browser-reported class only; never persist the raw user agent or IP.
function controlDevice(agent = '') {
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(agent)) return 'tablet';
  if (/iPhone|iPod|Android.*Mobile|Windows Phone/i.test(agent)) return 'phone';
  return /Windows NT|Macintosh|X11|CrOS/i.test(agent) ? 'desktop' : 'unknown';
}
router.get(
  '/admin/usage',
  isAuthenticated(Permission.ADMIN),
  async (req, res) => {
    const days = Number(req.query.days || 30),
      page = Number(req.query.page || 1);
    if (
      ![7, 30, 90].includes(days) ||
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 10000
    )
      return res.sendStatus(400);
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const p = config();
      if (!p) return res.sendStatus(503);
      return res.json(await relay(p, 'get', `usage?days=${days}&page=${page}`));
    } catch {
      return res.status(503).json({ error: 'Activity history unavailable' });
    }
  }
);
router.get(
  '/admin/usage/:id',
  isAuthenticated(Permission.ADMIN),
  async (req, res) => {
    const id = Number(req.params.id),
      after = Number(req.query.after || 0);
    if (
      !Number.isSafeInteger(id) ||
      id < 1 ||
      !Number.isSafeInteger(after) ||
      after < 0
    )
      return res.sendStatus(400);
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const p = config();
      if (!p) return res.sendStatus(503);
      const detail = await relay(p, 'get', `usage/${id}?after=${after}`);
      const users = await getRepository(User).find({
        select: { id: true, username: true, plexUsername: true, avatar: true },
      });
      const ids = new Set<number>(
        detail.visits.map((v: { userId: number }) => v.userId)
      );
      return res.json({
        ...detail,
        users: users
          .filter((u) => ids.has(u.id))
          .map((u) => ({ id: u.id, name: u.displayName, avatar: u.avatar })),
      });
    } catch (error) {
      return res.sendStatus(
        axios.isAxiosError(error) && error.response?.status === 404 ? 404 : 503
      );
    }
  }
);
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
      extensionVersion: cfg?.extensionVersion || '0.0.4',
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

// Resolve only this configured Plex server, never an arbitrary remote URL.
router.get(
  '/resolve',
  rateLimit({ windowMs: 60000, limit: 30 }),
  async (req, res) => {
    try {
      if (!config() || !social().enabled) return res.sendStatus(503);
      const { serverId, key } = req.query;
      if (
        serverId !== getSettings().plex.machineId ||
        typeof key !== 'string' ||
        !/^\d+$/.test(key)
      )
        return res.sendStatus(400);
      const metadata = await (await cataloguePlex()).getMetadata(key);
      if (!['movie', 'episode', 'show'].includes(metadata.type))
        return res.sendStatus(400);
      const media = await getRepository(Media).findOne({
        where: {
          ratingKey: String(
            metadata.type === 'episode' ? metadata.grandparentRatingKey : key
          ),
        },
      });
      if (
        !media ||
        media.status === MediaStatus.BLOCKLISTED ||
        media.status4k === MediaStatus.BLOCKLISTED
      )
        return res.sendStatus(404);
      return res.json({
        tmdbId: media.tmdbId,
        mediaType: media.mediaType,
        plexMedia: {
          title: metadata.title,
          duration: Number(metadata.duration || 0) / 1000,
        },
        ...(metadata.type === 'episode' ? { episodeKey: key } : {}),
      });
    } catch {
      return res.status(503).json({ error: 'Unable to resolve Plex media' });
    }
  }
);

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
    let suggestedKey: string | undefined;
    let profileLabel: string | undefined;
    try {
      // Independent many-to-one playback preferences; never change the avatar
      // map or use these associations to credit watched history.
      const preferences = read('playback-profiles.json');
      const profile =
        preferences.version === 1
          ? preferences.users?.[String(req.user!.id)]
          : undefined;
      if (profile && /^\d+$/.test(String(profile.plexUserId))) {
        const policy = social();
        const query = async (cmd: string, extra = {}) => {
          const response = (
            await axios.get(`${policy.tautulliUrl.replace(/\/$/, '')}/api/v2`, {
              params: { apikey: policy.tautulliKey, cmd, ...extra },
              timeout: 5000,
            })
          ).data.response;
          if (response?.result !== 'success')
            throw Error('Progress unavailable');
          return response.data;
        };
        const activity = await query('get_activity');
        const active = (activity.sessions || []).filter(
          (s: ActivityRow) =>
            String(s.user_id) === String(profile.plexUserId) &&
            String(s.grandparent_rating_key) === String(media.ratingKey) &&
            ['playing', 'paused', 'buffering'].includes(s.state)
        );
        let recent;
        if (!active.length) {
          const history = await query('get_history', {
            user_id: profile.plexUserId,
            grandparent_rating_key: media.ratingKey,
            length: 1,
            order_column: 'date',
            order_dir: 'desc',
          });
          recent = history.data?.[0];
        }
        suggestedKey = preferredPartyEpisode(results, active, recent);
        profileLabel = String(profile.label || profile.plexUserId).slice(0, 80);
      }
    } catch {
      /* No mapping/progress: keep an explicit episode selection. */
    }
    return res.json({ results, suggestedKey, profileLabel });
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
      let externalParty: PartySnapshot | undefined;
      if (partyId) {
        const existing = (
          (await relay(p, 'get', 'rooms')) as PartySnapshot[]
        ).find(
          (r) =>
            r.id === partyId && r.tmdbId === tmdbId && r.mediaType === mediaType
        );
        if (!existing)
          return res.status(409).json({ error: 'This party has ended' });
        if (
          existing.switchStatus === 'loading' ||
          existing.switchStatus === 'failed'
        )
          return res
            .status(409)
            .json({ error: 'Wait for this party to finish switching' });
        if (existing.external) {
          if (!existing.returnTo || !/^\d+$/.test(existing.returnTo.ratingKey))
            return res
              .status(409)
              .json({ error: 'Previous media unavailable' });
          externalParty = existing;
        }
        ratingKey = externalParty?.returnTo?.ratingKey || existing.ratingKey;
      } else if (mediaType === 'tv') {
        if (typeof episodeKey !== 'string' || !/^\d+$/.test(episodeKey))
          return res.status(400).json({ error: 'Choose a specific episode' });
        ratingKey = episodeKey;
      }
      const plex = await cataloguePlex();
      const metadata = await plex.getMetadata(ratingKey, {
        includeMarkers: true,
      });
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
          title: metadata.title,
          creditsStart:
            metadata.Marker?.filter((m) => m.type === 'credits').reduce(
              (v, m) => Math.min(v, m.startTimeOffset / 1000),
              Infinity
            ) || null,
          id,
          tmdbId,
          mediaType,
          ratingKey,
          duration: Number(metadata.duration || 0) / 1000,
          serverId: getSettings().plex.machineId,
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
        extensionVersion: p.extensionVersion || '0.0.4',
        catalogueUrl: `https://catalogue.prpl.com.mx/${mediaType}/${tmdbId}`,
        username: req.user!.displayName,
        plexUrl,
        plexMedia: {
          title: metadata.title,
          duration: Number(metadata.duration || 0) / 1000,
        },
        mediaType: mediaType === 'tv' ? 'episode' : 'movie',
        launchMode: partyId ? 'join' : 'create',
        serverUrl: p.browserRelayUrl,
        ...(externalParty
          ? {
              external: externalParty.external,
              externalDuration: externalParty.duration,
            }
          : {}),
      });
    } catch {
      return res.status(503).json({
        error: 'Unable to prepare this party. Check Plex access and the relay.',
      });
    }
  }
);

router.post(
  '/source',
  rateLimit({ windowMs: 60000, limit: 6 }),
  async (req, res) => {
    try {
      const p = config();
      if (!p || !social().enabled) return res.sendStatus(503);
      const origin = req.get('origin');
      if (
        origin &&
        ![
          'https://catalogue.prpl.com.mx',
          'http://127.0.0.1:15056',
          'http://localhost:15056',
        ].includes(origin)
      )
        return res.sendStatus(403);
      const {
        roomId,
        requestId,
        source,
        videoId,
        duration,
        title,
        position = 0,
      } = req.body;
      if (
        !/^cat-[a-f0-9-]{36}$/.test(roomId || '') ||
        !/^[a-f0-9-]{36}$/.test(requestId || '') ||
        !['youtube', 'previous'].includes(source)
      )
        return res.sendStatus(400);
      if (
        source === 'youtube' &&
        (!/^[\w-]{11}$/.test(videoId || '') ||
          !Number.isFinite(duration) ||
          duration <= 0 ||
          duration > 86400 ||
          !Number.isFinite(position) ||
          position < 0 ||
          position > duration ||
          typeof title !== 'string' ||
          title.length > 200)
      )
        return res.sendStatus(400);
      const party = ((await relay(p, 'get', 'rooms')) as PartySnapshot[]).find(
        (r) => r.id === roomId
      );
      if (!party?.userIds.includes(req.user!.id)) return res.sendStatus(403);
      const result = await relay(p, 'post', `rooms/${roomId}/switch`, {
        userId: req.user!.id,
        requestId,
        source,
        device: controlDevice(req.get('user-agent')),
        ...(source === 'youtube'
          ? {
              url: `https://www.youtube.com/watch?v=${videoId}`,
              duration,
              position,
              title: title.trim() || 'YouTube',
            }
          : {}),
      });
      cache.delete(`relay:${p.relayUrl}`);
      return res.status(202).json(result);
    } catch (error) {
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      return res
        .status(
          status && [400, 403, 404, 409, 429].includes(status) ? status : 503
        )
        .json({ error: 'Party source switch unavailable' });
    }
  }
);

router.post(
  '/switch',
  rateLimit({ windowMs: 60000, limit: 6 }),
  async (req, res) => {
    try {
      const p = config();
      if (!p || !social().enabled) return res.sendStatus(503);
      const origin = req.get('origin');
      if (
        origin &&
        ![
          'https://catalogue.prpl.com.mx',
          'http://127.0.0.1:15056',
          'http://localhost:15056',
        ].includes(origin)
      )
        return res.sendStatus(403);
      const { roomId, requestId, tmdbId, mediaType, episodeKey } = req.body;
      if (
        !/^cat-[a-f0-9-]{36}$/.test(roomId || '') ||
        !/^[a-f0-9-]{36}$/.test(requestId || '') ||
        !Number.isSafeInteger(tmdbId) ||
        tmdbId < 1 ||
        !['movie', 'tv'].includes(mediaType)
      )
        return res.sendStatus(400);
      // Check live identity before performing metadata work. Relay rechecks after I/O.
      const party = ((await relay(p, 'get', 'rooms')) as PartySnapshot[]).find(
        (r) => r.id === roomId
      );
      if (!party?.userIds.includes(req.user!.id)) return res.sendStatus(403);
      const media = await getRepository(Media).findOne({
        where: { tmdbId, mediaType: mediaType as MediaType },
      });
      if (
        !media?.ratingKey ||
        ![MediaStatus.AVAILABLE, MediaStatus.PARTIALLY_AVAILABLE].includes(
          media.status
        ) ||
        media.status4k === MediaStatus.BLOCKLISTED
      )
        return res.sendStatus(404);
      const ratingKey =
        mediaType === 'tv' ? episodeKey : String(media.ratingKey);
      if (typeof ratingKey !== 'string' || !/^\d+$/.test(ratingKey))
        return res.sendStatus(400);
      const metadata = await (
        await cataloguePlex()
      ).getMetadata(ratingKey, { includeMarkers: true });
      if (
        metadata.type !== (mediaType === 'tv' ? 'episode' : 'movie') ||
        (mediaType === 'tv' &&
          String(metadata.grandparentRatingKey) !== String(media.ratingKey))
      )
        return res.sendStatus(400);
      const result = await relay(p, 'post', `rooms/${roomId}/switch`, {
        title: metadata.title,
        creditsStart:
          metadata.Marker?.filter((m) => m.type === 'credits').reduce(
            (v, m) => Math.min(v, m.startTimeOffset / 1000),
            Infinity
          ) || null,
        device: controlDevice(req.get('user-agent')),
        userId: req.user!.id,
        requestId,
        tmdbId,
        mediaType,
        ratingKey,
        duration: Number(metadata.duration || 0) / 1000,
        serverId: getSettings().plex.machineId,
      });
      cache.delete(`relay:${p.relayUrl}`);
      return res.status(202).json(result);
    } catch (error) {
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      return res
        .status(
          status && [400, 403, 404, 409, 429].includes(status) ? status : 503
        )
        .json({ error: 'Party media switch unavailable' });
    }
  }
);

router.post(
  '/control',
  rateLimit({
    windowMs: 60000,
    limit: 90,
    keyGenerator: (req) => String(req.user!.id),
  }),
  async (req, res) => {
    try {
      const p = config();
      if (!p || !social().enabled) return res.sendStatus(503);
      const origin = req.get('origin');
      if (
        origin &&
        ![
          'https://catalogue.prpl.com.mx',
          'http://127.0.0.1:15056',
          'http://localhost:15056',
        ].includes(origin)
      )
        return res.sendStatus(403);
      const { roomId, action, targetTime, requestId } = req.body;
      if (
        typeof roomId !== 'string' ||
        !/^cat-[a-f0-9-]{36}$/.test(roomId) ||
        !['play', 'pause', 'seek'].includes(action) ||
        typeof requestId !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(requestId) ||
        (action === 'seek' &&
          (!Number.isFinite(targetTime) ||
            targetTime < 0 ||
            targetTime > 86400))
      )
        return res.sendStatus(400);
      // Relay checks CURRENT membership/roles, not the cached public snapshot.
      // Never accept a user/peer identity supplied by the caller.
      const result = await relay(p, 'post', `rooms/${roomId}/control`, {
        device: controlDevice(req.get('user-agent')),
        userId: req.user!.id,
        action,
        targetTime,
        requestId,
      });
      cache.delete(`relay:${p.relayUrl}`);
      return res.json(result);
    } catch (error) {
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      return res
        .status(
          status && [400, 403, 404, 409, 429].includes(status) ? status : 503
        )
        .json({ error: 'Party control unavailable' });
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
