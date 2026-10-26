import PlexAPI from '@server/api/plexapi';
import PlexTvAPI from '@server/api/plextv';
import TheMovieDb from '@server/api/themoviedb';
import { MediaStatus, type MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { LetterboxdAccount, MovieReview } from '@server/entity/MovieReview';
import { User } from '@server/entity/User';
import { latestEpisode } from '@server/lib/latestEpisode';
import { refreshLetterboxdPartyPlaybackEvents } from '@server/lib/letterboxdPartyPlaybackEvents';
import { persistPlaybackEvents } from '@server/lib/letterboxdPlaybackEvents';
import { mergeLetterboxdRecent } from '@server/lib/letterboxdRecent';
import { readWriteState, updateWriteState, setPreparationFailure } from '@server/lib/letterboxdWriteQueue';
import { partyWatched } from '@server/lib/partyWatched';
import { plexEpisodeUrl } from '@server/lib/plexEpisodeUrl';
import { getSettings } from '@server/lib/settings';
import type { SessionIdentity } from '@server/lib/viewingAttribution';
import {
  historyViewers,
  readAttributions,
} from '@server/lib/viewingAttribution';
import { appDataPath } from '@server/utils/appDataVolume';
import axios from 'axios';
import { Router } from 'express';
import fs from 'fs';
import path from 'path';

// Filter at serialization time, including cache hits. Never send raw history.
type Person = {
  id: number;
  name: string;
  avatar: string;
  lastWatched?: number;
  seasons?: number[];
  latestEpisode?: { season: number; episode: number; stamp: number };
};
type Policy = {
  letterboxdPlayback?: { timezone?: string; sourceId?: string };
  historyAliases?: Record<string, string[]>;
  historyConcurrency?: number;
  enabled: boolean;
  hiddenWatchers: number[];
  hiddenRequesters: number[];
  tautulliUrl: string;
  tautulliKey: string;
  mappingScript: string;
};
// Verified historical Plex IDs only; never infer identity from a title at runtime.
function historyKeys(item: Media, p: Policy): string[] {
  const aliases = p.historyAliases?.[`${item.mediaType}:${item.tmdbId}`] ?? [];
  if (
    !Array.isArray(aliases) ||
    aliases.some((key) => typeof key !== 'string' || !/^\d+$/.test(key))
  )
    throw Error('Invalid history aliases');
  return [
    ...new Set(
      [item.ratingKey, item.ratingKey4k, ...aliases].filter(Boolean) as string[]
    ),
  ];
}
function policy(): Policy {
  const p = JSON.parse(
    fs
      .readFileSync(path.join(appDataPath(), 'social.json'), 'utf8')
      .replace(/^\uFEFF/, '')
  );
  if (
    typeof p.enabled !== 'boolean' ||
    !Array.isArray(p.hiddenWatchers) ||
    !Array.isArray(p.hiddenRequesters)
  )
    throw Error('Invalid social policy');
  return p;
}
type AttributedHistory = SessionIdentity & {
  stamp: number;
  season?: number;
  episode?: number;
};
type HistoryResult = { value: AttributedHistory[]; stale: boolean };
const cache = new Map<string, { until: number; value: AttributedHistory[] }>();
const pending = new Map<string, Promise<HistoryResult>>();
const cooldown = new Map<string, number>();
let active = 0;
const waiters: { grant: () => void }[] = [];
function concurrency(p: Policy): number {
  const value = Number(p.historyConcurrency ?? 8);
  return Number.isInteger(value) && value >= 1 && value <= 16 ? value : 8;
}
async function permit(limit: number): Promise<() => void> {
  if (active >= limit || waiters.length) {
    if (waiters.length >= 64) throw Error('History queue full');
    await new Promise<void>((resolve, reject) => {
      const entry = {
        grant: () => {
          clearTimeout(timer);
          resolve();
        },
      };
      const timer = setTimeout(() => {
        const index = waiters.indexOf(entry);
        if (index >= 0) waiters.splice(index, 1);
        reject(Error('History queue timeout'));
      }, 15000);
      waiters.push(entry);
    });
  } else active++;
  return () => {
    const next = waiters.shift();
    if (next)
      next.grant(); // Transfer this slot; do not briefly overbook it.
    else active--;
  };
}
async function history(
  key: string,
  type: string,
  p: Policy
): Promise<HistoryResult> {
  const cacheKey = `${p.tautulliUrl}:${type}:${key}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.until > Date.now()) return { value: hit.value, stale: false };
  const underway = pending.get(cacheKey);
  if (underway) return underway;
  if ((cooldown.get(cacheKey) || 0) > Date.now()) {
    if (hit) return { value: hit.value, stale: true };
    throw Error('History retry cooldown');
  }
  // Register before entering the queue: refocusing cannot enqueue duplicates.
  const work = Promise.resolve().then(async () => {
    let release: (() => void) | undefined;
    try {
      release = await permit(concurrency(p));
      const deadline = Date.now() + 20000;
      const result: AttributedHistory[] = [];
      for (let start = 0; start < 20000; start += 500) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw Error('History lookup deadline');
        const response = await axios.get(
          `${p.tautulliUrl.replace(/\/$/, '')}/api/v2`,
          {
            timeout: Math.min(10000, remaining),
            params: {
              apikey: p.tautulliKey,
              cmd: 'get_history',
              grouping: 0,
              length: 500,
              start,
              order_column: 'date',
              order_dir: 'desc',
              ...(type === 'tv'
                ? { grandparent_rating_key: key }
                : { rating_key: key }),
            },
          }
        );
        const payload = response.data.response;
        if (payload?.result !== 'success' || !Array.isArray(payload.data?.data))
          throw Error('History unavailable');
        for (const row of payload.data.data) {
          if (
            String(
              type === 'tv' ? row.grandparent_rating_key : row.rating_key
            ) !== key
          )
            continue;
          if (row.media_type !== (type === 'tv' ? 'episode' : 'movie'))
            continue;
          const stamp = Number(row.stopped || row.date || row.started);
          if (Number.isFinite(stamp))
            result.push({
              user_id: String(row.user_id),
              rating_key: String(row.rating_key),
              machine_id: row.machine_id,
              started: Number(row.started),
              watched_status: Number(row.watched_status),
              season:
                row.parent_media_index == null
                  ? undefined
                  : Number(row.parent_media_index),
              episode:
                row.media_index == null ? undefined : Number(row.media_index),
              stamp,
            });
        }
        if (
          start + payload.data.data.length >=
            Number(payload.data.recordsFiltered) ||
          payload.data.data.length < 500
        ) {
          if (!cache.has(cacheKey) && cache.size >= 500)
            cache.delete(cache.keys().next().value!);
          cache.set(cacheKey, { until: Date.now() + 120000, value: result });
          cooldown.delete(cacheKey);
          return { value: result, stale: false };
        }
      }
      throw Error('History exceeds safe paging limit');
    } catch (error) {
      if (cooldown.size >= 500) cooldown.delete(cooldown.keys().next().value!);
      cooldown.set(cacheKey, Date.now() + 15000);
      // Keep only raw history in the cache. Current mappings and privacy policy
      // are applied by the route on every response, including stale fallback.
      if (hit) return { value: hit.value, stale: true };
      throw error;
    } finally {
      release?.();
    }
  });
  pending.set(cacheKey, work);
  try {
    return await work;
  } finally {
    if (pending.get(cacheKey) === work) pending.delete(cacheKey);
  }
}

const router = Router();
type RecentWatch = AttributedHistory & {
  row_id?: unknown;
  reference_id?: unknown;
  stopped?: number;
  plexId: string;
  key: string;
  type: string;
};
let recentCache:
  | { until: number; rows: RecentWatch[]; source: string }
  | undefined;
let recentPending: Promise<RecentWatch[]> | undefined;
let recentPendingSource: string | undefined;
async function recentHistory(p: Policy): Promise<RecentWatch[]> {
  const source = `${p.tautulliUrl}:${p.tautulliKey}`;
  if (
    recentCache &&
    recentCache.until > Date.now() &&
    recentCache.source === source
  )
    return recentCache.rows;
  if (recentPending && recentPendingSource === source) return recentPending;
  const work = (async () => {
    const { backgroundWork } = await import('../lib/backgroundWork');
    // One shared, bounded history fetch, not one request per catalogue title.
    // Read the complete supported history before sorting by completion time:
    // history's start-date order is not a reliable last-watched order.
    const rows = await backgroundWork.run({ kind: 'history' }, async (page) => {
      const response = await axios.get(
        `${p.tautulliUrl.replace(/\/$/, '')}/api/v2`,
        {
          timeout: 10000,
          responseType: 'text',
          transformResponse: [(text: string) => text],
          params: {
            apikey: p.tautulliKey,
            cmd: 'get_history',
            grouping: 0,
            length: 500,
            start: page * 500,
            order_column: 'date',
            order_dir: 'desc',
          },
        }
      );
      return response.data;
    });
    recentCache = { until: Date.now() + 120000, rows, source };
    return rows;
  })();
  recentPending = work;
  recentPendingSource = source;
  try {
    return await work;
  } finally {
    if (recentPending === work) {
      recentPending = undefined;
      recentPendingSource = undefined;
    }
  }
}
// Shared with the scheduler: the same in-flight request and cache serve page reads.
// Read-only projection for discovery; independent of Letterboxd publication opt-in.
export async function discoveryViewingHistory(requester: number, snapshot?: { users: User[]; media: Media[] }, episodesOnly = false) {
  let p = policy();
  const [rows, parties, users, media] = await Promise.all([
    recentHistory(p), partyWatched(), snapshot?.users ?? getRepository(User).find({ loadEagerRelations: false }), snapshot?.media ?? getRepository(Media).find({ loadEagerRelations: false }),
  ]);
  const mapped = new Map(users.filter(u=>u.plexId).map(u=>[String(u.plexId),u.id]));
  const block = fs.readFileSync(p.mappingScript,'utf8').match(/const mappings = \[([\s\S]*?)\];/)?.[1];
  if (!block) throw Error('Mapping unavailable');
  for (const m of block.matchAll(/\['(\d+)'\s*,\s*'[^']+'\s*,\s*(\d+)\s*,\s*'([^']+)'\]/g))
    if (users.some(u=>u.id===Number(m[2])&&u.username===m[3])) mapped.set(m[1],Number(m[2]));
  const byKey = new Map<string,Media>();
  for (const m of media) {
    if (m.status===MediaStatus.BLOCKLISTED||m.status4k===MediaStatus.BLOCKLISTED) continue;
    for (const key of historyKeys(m,p)) {
      const id=`${m.mediaType}:${key}`;
      if(byKey.has(id)&&byKey.get(id)!.id!==m.id)throw Error('Ambiguous history alias');
      byKey.set(id,m);
    }
  }
  p=policy();
  const allowed=new Set(users.filter(u=>u.id===requester||(p.enabled&&!p.hiddenWatchers.includes(u.id))).map(u=>u.id));
  const attribution=readAttributions();
  const result: {type:'movie'|'tv';tmdbId:number;userId:number;at:number;season?:number;episode?:number}[]=[];
  for(const row of rows){
    const m=byKey.get(`${row.type}:${row.key}`);if(!m||m.mediaType!==(episodesOnly?'tv':'movie'))continue;
    for(const userId of historyViewers(row,mapped.get(row.plexId),attribution))
      if(allowed.has(userId))result.push({type:m.mediaType as 'movie'|'tv',tmdbId:m.tmdbId,userId,at:row.stamp*1000,season:row.season,episode:row.episode});
  }
  // An episode completion is not proof of completing an entire series/list item.
  for(const row of parties)if(row.mediaType===(episodesOnly?'tv':'movie')&&allowed.has(row.userId))result.push({type:episodesOnly?'tv':'movie',tmdbId:row.tmdbId,userId:row.userId,at:row.stamp*1000,season:row.seasonNumber,episode:row.episodeNumber});
  return result;
}
export async function refreshCatalogueHistory() {
  const p = policy();
  if (!p.enabled) return;
  const [tautulli, party] = await Promise.all([
    recentHistory(p).then(collectCompletedLetterboxdPlayback),
    refreshLetterboxdPartyPlaybackEvents(),
  ]);
  return { tautulli, party };
}

let playbackRefreshAt = 0;
let playbackRefreshPending: Promise<void> | undefined;
function playbackRefreshFailure(failed: boolean) {
  updateWriteState(state => {
    for (const [id, setting] of Object.entries(state.settings)) {
      if (setting.enabled)
        setPreparationFailure(state, Number(id), setting.account, 'playback-history', failed);
    }
  });
}
// Cheap additive fast path. The existing full history job remains the catch-up
// path for unusually old starts; absence here is never interpreted as removal.
export async function refreshRecentMoviePlayback() {
  if (playbackRefreshPending) return playbackRefreshPending;
  // Leave five seconds of tolerance for scheduler jitter around the 30s cadence.
  if (Date.now() - playbackRefreshAt < 25000) return;
  const p = policy();
  if (!p.enabled || !Object.values(readWriteState().settings).some(s => s.enabled)) return;
  playbackRefreshAt = Date.now();
  playbackRefreshPending = (async () => {
    const response = await axios.get(`${p.tautulliUrl.replace(/\/$/, '')}/api/v2`, {
      timeout: 5000,
      params: { apikey: p.tautulliKey, cmd: 'get_history', grouping: 0,
        media_type: 'movie', length: 50, start: 0, order_column: 'date', order_dir: 'desc' },
    });
    const payload = response.data.response;
    if (payload?.result !== 'success' || !Array.isArray(payload.data?.data)) throw Error('Invalid playback history response');
    await collectCompletedLetterboxdPlayback(payload.data.data
      .filter((row: Record<string, unknown>) => row.media_type === 'movie' && Number(row.stopped) > 0 && row.rating_key)
      .map((row: Record<string, unknown>) => ({row_id: row.row_id, reference_id: row.reference_id,
        stopped: Number(row.stopped), stamp: Number(row.stopped),
        plexId: String(row.user_id), user_id: String(row.user_id),
        key: String(row.rating_key), rating_key: String(row.rating_key), type: 'movie',
        machine_id: row.machine_id, started: Number(row.started), watched_status: Number(row.watched_status)})));
    playbackRefreshFailure(false);
  })().catch(() => {
    // A history outage must not prevent acknowledgement of an existing write.
    playbackRefreshFailure(true);
  }).finally(() => { playbackRefreshPending = undefined; });
  return playbackRefreshPending;
}

// Collection only: the publication layer must obtain browser baselines later.
export async function collectCompletedLetterboxdPlayback(rows: RecentWatch[]) {
  const settings = readWriteState().settings;
  if (!Object.values(settings).some(s => s.enabled)) return;
  const users = await getRepository(User).find();
  const accounts = await getRepository(LetterboxdAccount).find();
  const media = await getRepository(Media).find();
  const p = policy();
  if (
    !p.enabled
  )
    return;
  const mapped = new Map<string, number>();
  for (const user of users)
    if (user.plexId) mapped.set(String(user.plexId), user.id);
  const block = fs
    .readFileSync(p.mappingScript, 'utf8')
    .match(/const mappings = \[([\s\S]*?)\];/)?.[1];
  if (!block) throw Error('Mapping unavailable');
  for (const m of block.matchAll(
    /\['(\d+)'\s*,\s*'[^']+'\s*,\s*(\d+)\s*,\s*'([^']+)'\]/g
  ))
    if (users.some((u) => u.id === Number(m[2]) && u.username === m[3]))
      mapped.set(m[1], Number(m[2]));
  const byKey = new Map<string, Media>();
  for (const item of media) {
    if (
      item.mediaType !== 'movie' ||
      item.status === MediaStatus.BLOCKLISTED ||
      item.status4k === MediaStatus.BLOCKLISTED
    )
      continue;
    for (const key of historyKeys(item, p)) {
      if (byKey.has(key) && byKey.get(key)?.id !== item.id)
        throw Error('Ambiguous history alias');
      byKey.set(key, item);
    }
  }
  const attribution = readAttributions();
  const results = [];
  for (const account of accounts) {
    const userId = account.userId;
    const fresh = readWriteState().settings[userId];
    if (!fresh?.enabled || !account.enabled || fresh.account !== account.username ||
        p.hiddenWatchers.includes(userId) || !users.some(u => u.id === userId) ||
        fresh.enabledSince !== settings[userId]?.enabledSince ||
        fresh.account !== settings[userId]?.account) continue;
    results.push(persistPlaybackEvents(
    path.join(appDataPath(), 'letterboxd-playback-events.json'),
    rows.map((row) => ({
      ...row,
      viewers: historyViewers(row, mapped.get(row.plexId), attribution),
      tmdbId: byKey.get(row.key)?.tmdbId,
    })),
    {
      ...fresh,
      userId,
      timezone: p.letterboxdPlayback?.timezone,
      sourceId: p.letterboxdPlayback?.sourceId,
      now: Date.now(),
    }
    ));
  }
  return results;
}

router.get('/recently-watched', async (req, res) => {
  const profileId =
    req.query.userId === undefined ? undefined : Number(req.query.userId);
  if (
    profileId !== undefined &&
    (!Number.isSafeInteger(profileId) || profileId < 1)
  )
    return res.status(400).json({ error: 'Invalid user' });
  const type = req.query.type ?? 'all';
  const page = Number(req.query.page ?? 1);
  if (
    !['all', 'movie', 'tv'].includes(String(type)) ||
    typeof type !== 'string' ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 100000
  )
    return res.status(400).json({ error: 'Invalid type or page' });
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    let p = policy();
    if (!p.enabled)
      return res.json({
        enabled: false,
        page,
        totalResults: 0,
        totalPages: 0,
        results: [],
      });
    const [rows, partyRows] = await Promise.all([
      recentHistory(p),
      partyWatched(),
    ]);
    const users = await getRepository(User).find();
    const mapped = new Map<string, number>();
    for (const user of users)
      if (user.plexId) mapped.set(String(user.plexId), user.id);
    const block = fs
      .readFileSync(p.mappingScript, 'utf8')
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
    const media = await getRepository(Media).find({
      select: [
        'id',
        'tmdbId',
        'tvdbId',
        'mediaType',
        'ratingKey',
        'ratingKey4k',
        'status',
        'status4k',
      ],
    });
    const byKey = new Map<string, Media>();
    for (const item of media) {
      if (
        item.status === MediaStatus.BLOCKLISTED ||
        item.status4k === MediaStatus.BLOCKLISTED
      )
        continue;
      for (const key of historyKeys(item, p)) {
        const identity = `${item.mediaType}:${key}`;
        if (byKey.has(identity) && byKey.get(identity)?.id !== item.id)
          throw Error('Ambiguous history alias');
        byKey.set(identity, item);
      }
    }
    // Re-read opt-outs after I/O, including cache hits. Never expose timestamps.
    p = policy();
    if (!p.enabled)
      return res.json({
        enabled: false,
        page,
        totalResults: 0,
        totalPages: 0,
        results: [],
      });
    const watched = new Map<number, { item: Media; stamp: number }>();
    const attribution = readAttributions();
    for (const row of rows) {
      for (const userId of historyViewers(
        row,
        mapped.get(row.plexId),
        attribution
      )) {
        if (
          userId === undefined ||
          p.hiddenWatchers.includes(userId) ||
          (profileId !== undefined && profileId !== userId)
        )
          continue;
        if (!users.some((u) => u.id === userId)) continue;
        const item = byKey.get(`${row.type}:${row.key}`);
        if (
          item &&
          (type === 'all' || item.mediaType === type) &&
          row.stamp > (watched.get(item.id)?.stamp || 0)
        )
          watched.set(item.id, { item, stamp: row.stamp });
      }
    }
    const byTmdb = new Map(
      media
        .filter(
          (m) =>
            m.status !== MediaStatus.BLOCKLISTED &&
            m.status4k !== MediaStatus.BLOCKLISTED
        )
        .map((m) => [`${m.mediaType}:${m.tmdbId}`, m])
    );
    for (const row of partyRows) {
      if (
        !users.some((u) => u.id === row.userId) ||
        p.hiddenWatchers.includes(row.userId) ||
        (profileId !== undefined && profileId !== row.userId)
      )
        continue;
      const item = byTmdb.get(`${row.mediaType}:${row.tmdbId}`);
      if (
        item &&
        (type === 'all' || item.mediaType === type) &&
        row.stamp > (watched.get(item.id)?.stamp || 0)
      )
        watched.set(item.id, { item, stamp: row.stamp });
    }
    const lbEntries = await getRepository(MovieReview)
      .createQueryBuilder('review')
      .innerJoin(
        LetterboxdAccount,
        'account',
        'account.userId = review.userId AND account.enabled = :enabled',
        { enabled: true }
      )
      .where('review.source = :source AND review.watchedDate IS NOT NULL', {
        source: 'letterboxd',
      })
      .select([
        'review.userId',
        'review.tmdbId',
        'review.mediaType',
        'review.watchedDate',
        'review.publishedAt',
        'review.watched',
      ])
      .getMany();
    const merged = mergeLetterboxdRecent(
      [...watched.values()],
      lbEntries,
      media,
      new Set(users.map((u) => u.id)),
      p.hiddenWatchers,
      new Set(
        media
          .filter(
            (m) =>
              m.status === MediaStatus.BLOCKLISTED ||
              m.status4k === MediaStatus.BLOCKLISTED
          )
          .map((m) => `${m.mediaType}:${m.tmdbId}`)
      ),
      profileId,
      type
    );
    const results = merged
      .slice((page - 1) * 20, page * 20)
      .map(({ item }) => ({
        id: item.id,
        tmdbId: item.tmdbId,
        tvdbId: item.tvdbId,
        mediaType: item.mediaType,
      }));
    return res.json({
      enabled: true,
      page,
      totalResults: merged.length,
      totalPages: Math.ceil(merged.length / 20),
      results,
    });
  } catch {
    return res.status(503).json({ error: 'Watch history unavailable' });
  }
});

const episodeLinkCache = new Map<
  string,
  { until: number; results: { episode: number; url: string }[] }
>();
router.get('/episodes/:id/:season', async (req, res) => {
  const id = Number(req.params.id),
    seasonNumber = Number(req.params.season);
  if (
    !Number.isSafeInteger(id) ||
    id < 1 ||
    !Number.isSafeInteger(seasonNumber) ||
    seasonNumber < 0
  )
    return res.sendStatus(400);
  try {
    const media = await getRepository(Media).findOneBy({
      tmdbId: id,
      mediaType: 'tv' as MediaType,
    });
    if (
      !media?.ratingKey ||
      media.status === MediaStatus.BLOCKLISTED ||
      media.status4k === MediaStatus.BLOCKLISTED
    )
      return res.json({ results: [] });
    const cacheKey = `${id}:${seasonNumber}:${media.ratingKey}`;
    const cached = episodeLinkCache.get(cacheKey);
    if (cached && cached.until > Date.now())
      return res.json({ results: cached.results });
    const owner = await getRepository(User).findOne({
      where: { id: 1 },
      select: { id: true, plexToken: true },
    });
    if (!owner?.plexToken) return res.sendStatus(503);
    const plex = new PlexAPI({ plexToken: owner.plexToken, timeout: 5000 });
    const seasons = (await plex.getChildrenMetadata(media.ratingKey)).filter(
      (s) => s.type === 'season' && s.index === seasonNumber
    );
    if (seasons.length !== 1) return res.json({ results: [] });
    const canonical = await new TheMovieDb().getTvSeason({
      tvId: id,
      seasonNumber,
    });
    const episodes = await plex.getChildrenMetadata(seasons[0].ratingKey);
    // Public metadata failure must not remove the working desktop links.
    const showUrl = await new PlexTvAPI(owner.plexToken)
      .getPublicWatchUrl(id, 'tv')
      .catch(() => null);
    const normalize = (title: string) =>
      title
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, '');
    const results = canonical.episodes.flatMap((e) => {
      const matches = episodes.filter(
        (p) =>
          p.type === 'episode' &&
          String(p.grandparentRatingKey) === String(media.ratingKey) &&
          p.parentIndex === seasonNumber &&
          p.index === e.episode_number &&
          normalize(p.title) === normalize(e.name)
      );
      return matches.length === 1
        ? [
            {
              episode: e.episode_number,
              mobileUrl: plexEpisodeUrl(
                showUrl,
                seasonNumber,
                e.episode_number
              ),
              url: `https://app.plex.tv/desktop/#!/server/${getSettings().plex.machineId}/details?key=${encodeURIComponent(`/library/metadata/${matches[0].ratingKey}`)}`,
            },
          ]
        : [];
    });
    if (episodeLinkCache.size >= 100)
      episodeLinkCache.delete(episodeLinkCache.keys().next().value!);
    episodeLinkCache.set(cacheKey, { until: Date.now() + 120000, results });
    return res.json({ results });
  } catch {
    return res.sendStatus(503);
  }
});
router.get('/:type/:id', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const type = String(req.params.type),
    id = Number(req.params.id);
  if (!['movie', 'tv'].includes(type) || !Number.isSafeInteger(id) || id <= 0)
    return res.status(400).json({ error: 'Invalid media' });
  try {
    let p = policy();
    if (!p.enabled)
      return res.json({ watchers: [], requesters: [], enabled: false });
    const media = await getRepository(Media).findOne({
      where: { tmdbId: id, mediaType: type as MediaType },
      relations: ['requests', 'requests.requestedBy', 'requests.seasons'],
    });
    const users = await getRepository(User).find();
    const mapped = new Map<string, User>();
    for (const user of users)
      if (user.plexId) mapped.set(String(user.plexId), user);
    // Read only the literal mapping block; never execute the avatar-sync script.
    const source = fs.readFileSync(p.mappingScript, 'utf8');
    const block = source.match(/const mappings = \[([\s\S]*?)\];/)?.[1];
    if (!block) throw Error('Mapping unavailable');
    for (const m of block.matchAll(
      /\['(\d+)'\s*,\s*'[^']+'\s*,\s*(\d+)\s*,\s*'([^']+)'\]/g
    )) {
      const user = users.find(
        (u) => u.id === Number(m[2]) && u.username === m[3]
      );
      if (user) mapped.set(m[1], user);
    }
    const person = (u: User): Person => ({
      id: u.id,
      name: u.username || u.plexUsername || 'User',
      avatar: u.avatar,
    });
    const requested = new Map<number, Person>();
    for (const request of media?.requests || []) {
      if (!request.requestedBy || request.status === 3) continue;
      const u = request.requestedBy;
      const entry = requested.get(u.id) || { ...person(u), seasons: [] };
      entry.seasons = [
        ...new Set([
          ...(entry.seasons || []),
          ...(request.seasons || []).map((s) => s.seasonNumber),
        ]),
      ].sort((a, b) => a - b);
      requested.set(u.id, entry);
    }
    const watched = new Map<number, Person>();
    const latestEpisodes = new Map<
      number,
      { season: number; episode: number; stamp: number }
    >();
    let historyAvailable = true;
    let historyStale = false;
    const attribution = readAttributions();
    try {
      for (const key of media ? historyKeys(media, p) : []) {
        const snapshot = await history(String(key), type, p);
        historyStale ||= snapshot.stale;
        for (const row of snapshot.value) {
          const lastWatched = row.stamp;
          for (const userId of historyViewers(
            row,
            mapped.get(String(row.user_id))?.id,
            attribution
          )) {
            const u = users.find((u) => u.id === userId);
            if (u) {
              const progress = latestEpisode(latestEpisodes.get(u.id), row);
              if (progress) latestEpisodes.set(u.id, progress);
            }
            if (u && lastWatched > (watched.get(u.id)?.lastWatched || 0))
              watched.set(u.id, { ...person(u), lastWatched });
          }
        }
      }
    } catch {
      historyAvailable = false;
    }
    for (const row of await partyWatched()) {
      if (row.tmdbId !== id || row.mediaType !== type) continue;
      // Legacy party completions only identify the show. Never invent an
      // episode or keep an older marker that claims to be the latest watch.
      if (row.stamp > (latestEpisodes.get(row.userId)?.stamp || 0)) {
        const progress = latestEpisode(undefined, {
          season: row.seasonNumber,
          episode: row.episodeNumber,
          stamp: row.stamp,
          watched_status: 1,
        });
        if (progress) latestEpisodes.set(row.userId, progress);
        else latestEpisodes.delete(row.userId);
      }
      const u = users.find((u) => u.id === row.userId);
      if (u && row.stamp > (watched.get(u.id)?.lastWatched || 0))
        watched.set(u.id, { ...person(u), lastWatched: row.stamp });
    }
    const catalogueWatchers = new Set(watched.keys());
    for (const row of await getRepository(MovieReview).findBy({tmdbId:id, mediaType:type as 'movie'|'tv', source:'local', watched:true})) {
      if (!row.id.startsWith('watched:')) continue;
      const u = users.find(u => u.id === row.userId);
      if (!u) continue;
      catalogueWatchers.add(u.id);
      if (!watched.has(u.id)) watched.set(u.id, person(u));
    }
    const letterboxdWatchers = new Set<number>();
    for (const row of await getRepository(MovieReview).findBy({
      tmdbId: id,
      mediaType: type as 'movie' | 'tv',
      source: 'letterboxd',
      watched: true,
    })) {
      const u = users.find((u) => u.id === row.userId);
      if (!u) continue;
      letterboxdWatchers.add(u.id);
      const stamp = row.watchedDate ? Date.parse(row.watchedDate) / 1000 : 0;
      if (!watched.has(u.id) || stamp > (watched.get(u.id)?.lastWatched || 0)) {
        watched.set(u.id, {
          ...person(u),
          ...(stamp > 0 ? { lastWatched: stamp } : {}),
        });
      }
    }
    p = policy(); // Opt-outs apply even when changed during a history fetch.
    if (!p.enabled)
      return res.json({ watchers: [], requesters: [], enabled: false });
    return res.json({
      enabled: true,
      historyAvailable,
      historyStale,
      watchers: [...watched.values()]
        .filter((u) => !p.hiddenWatchers.includes(u.id))
        .sort((a, b) => (b.lastWatched || 0) - (a.lastWatched || 0))
        .map((u) => ({
          ...u,
          latestEpisode: latestEpisodes.get(u.id),
          watchedSource: letterboxdWatchers.has(u.id)
            ? catalogueWatchers.has(u.id)
              ? 'both'
              : 'letterboxd'
            : 'catalogue',
        })),
      requesters: [...requested.values()].filter(
        (u) => !p.hiddenRequesters.includes(u.id)
      ),
    });
  } catch {
    return res.status(503).json({ error: 'Social information unavailable' });
  }
});
export default router;
