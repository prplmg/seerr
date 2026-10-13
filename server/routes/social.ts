import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import { MediaType, MediaStatus } from '@server/constants/media';
import { appDataPath } from '@server/utils/appDataVolume';
import { partyWatched } from '@server/lib/partyWatched';

// Filter at serialization time, including cache hits. Never send raw history.
type Person = { id: number; name: string; avatar: string; lastWatched?: number; seasons?: number[] };
type Policy = { historyAliases?: Record<string, string[]>; historyConcurrency?: number; enabled: boolean; hiddenWatchers: number[]; hiddenRequesters: number[]; tautulliUrl: string; tautulliKey: string; mappingScript: string };
// Verified historical Plex IDs only; never infer identity from a title at runtime.
function historyKeys(item: Media, p: Policy): string[] {
  const aliases = p.historyAliases?.[`${item.mediaType}:${item.tmdbId}`] ?? [];
  if (!Array.isArray(aliases) || aliases.some(key => typeof key !== 'string' || !/^\d+$/.test(key))) throw Error('Invalid history aliases');
  return [...new Set([item.ratingKey, item.ratingKey4k, ...aliases].filter(Boolean) as string[])];
}
function policy(): Policy {
  const p = JSON.parse(fs.readFileSync(path.join(appDataPath(), 'social.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (typeof p.enabled !== 'boolean' || !Array.isArray(p.hiddenWatchers) || !Array.isArray(p.hiddenRequesters)) throw Error('Invalid social policy');
  return p;
}
type HistoryResult = { value: Map<string, number>; stale: boolean };
const cache = new Map<string, { until: number; value: Map<string, number> }>();
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
      const entry = { grant: () => { clearTimeout(timer); resolve(); } };
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
    if (next) next.grant(); // Transfer this slot; do not briefly overbook it.
    else active--;
  };
}
async function history(key: string, type: string, p: Policy): Promise<HistoryResult> {
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
      const result = new Map<string, number>();
      for (let start = 0; start < 20000; start += 500) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw Error('History lookup deadline');
        const response = await axios.get(`${p.tautulliUrl.replace(/\/$/, '')}/api/v2`, {
          timeout: Math.min(10000, remaining),
          params: { apikey: p.tautulliKey, cmd: 'get_history', grouping: 0, length: 500, start,
            order_column: 'date', order_dir: 'desc', ...(type === 'tv' ? { grandparent_rating_key: key } : { rating_key: key }) },
        });
        const payload = response.data.response;
        if (payload?.result !== 'success' || !Array.isArray(payload.data?.data)) throw Error('History unavailable');
        for (const row of payload.data.data) {
          if (String(type === 'tv' ? row.grandparent_rating_key : row.rating_key) !== key) continue;
          if (Number(row.watched_status) !== 1 || row.media_type !== (type === 'tv' ? 'episode' : 'movie')) continue;
          const stamp = Number(row.stopped || row.date || row.started), id = String(row.user_id);
          if (Number.isFinite(stamp)) result.set(id, Math.max(result.get(id) || 0, stamp));
        }
        if (start + payload.data.data.length >= Number(payload.data.recordsFiltered) || payload.data.data.length < 500) {
          if (!cache.has(cacheKey) && cache.size >= 500) cache.delete(cache.keys().next().value!);
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
    } finally { release?.(); }
  });
  pending.set(cacheKey, work);
  try { return await work; } finally { if (pending.get(cacheKey) === work) pending.delete(cacheKey); }
}

const router = Router();
type RecentWatch = { plexId: string; key: string; type: string; stamp: number };
let recentCache: { until: number; rows: RecentWatch[]; source: string } | undefined;
let recentPending: Promise<RecentWatch[]> | undefined;
async function recentHistory(p: Policy): Promise<RecentWatch[]> {
  if (recentCache && recentCache.until > Date.now() && recentCache.source === p.tautulliUrl) return recentCache.rows;
  if (recentPending) return recentPending;
  const work = (async () => {
    const rows: RecentWatch[] = [];
    // One shared, bounded history fetch, not one request per catalogue title.
    // Read the complete supported history before sorting by completion time:
    // history's start-date order is not a reliable last-watched order.
    for (let start = 0; start < 20000; start += 500) {
      const response = await axios.get(`${p.tautulliUrl.replace(/\/$/, '')}/api/v2`, {
        timeout: 10000,
        params: { apikey: p.tautulliKey, cmd: 'get_history', grouping: 0, length: 500, start, order_column: 'date', order_dir: 'desc' },
      });
      const payload = response.data.response;
      if (payload?.result !== 'success' || !Array.isArray(payload.data?.data)) throw Error('History unavailable');
      for (const row of payload.data.data) {
        if (Number(row.watched_status) !== 1 || !['movie', 'episode'].includes(row.media_type)) continue;
        const stamp = Number(row.stopped || row.date || row.started);
        const key = String(row.media_type === 'episode' ? row.grandparent_rating_key : row.rating_key);
        if (Number.isFinite(stamp) && stamp > 0 && key && key !== 'undefined') rows.push({ plexId: String(row.user_id), key, type: row.media_type === 'episode' ? 'tv' : 'movie', stamp });
      }
      if (start + payload.data.data.length >= Number(payload.data.recordsFiltered) || payload.data.data.length < 500) {
        recentCache = { until: Date.now() + 120000, rows, source: p.tautulliUrl };
        return rows;
      }
    }
    throw Error('History exceeds safe paging limit');
  })();
  recentPending = work;
  try { return await work; } finally { recentPending = undefined; }
}

router.get('/recently-watched', async (req, res) => {
  const type = req.query.type ?? 'all';
  const page = Number(req.query.page ?? 1);
  if (!['all', 'movie', 'tv'].includes(String(type)) || typeof type !== 'string' || !Number.isSafeInteger(page) || page < 1 || page > 100000) return res.status(400).json({ error: 'Invalid type or page' });
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    let p = policy();
    if (!p.enabled) return res.json({ enabled: false, page, totalResults: 0, totalPages: 0, results: [] });
    const [rows, partyRows] = await Promise.all([recentHistory(p), partyWatched()]);
    const users = await getRepository(User).find();
    const mapped = new Map<string, number>();
    for (const user of users) if (user.plexId) mapped.set(String(user.plexId), user.id);
    const block = fs.readFileSync(p.mappingScript, 'utf8').match(/const mappings = \[([\s\S]*?)\];/)?.[1];
    if (!block) throw Error('Mapping unavailable');
    for (const m of block.matchAll(/\['(\d+)'\s*,\s*'[^']+'\s*,\s*(\d+)\s*,\s*'([^']+)'\]/g)) {
      const user = users.find(u => u.id === Number(m[2]) && u.username === m[3]);
      if (user) mapped.set(m[1], user.id);
    }
    const media = await getRepository(Media).find({ select: ['id', 'tmdbId', 'tvdbId', 'mediaType', 'ratingKey', 'ratingKey4k', 'status', 'status4k'] });
    const byKey = new Map<string, Media>();
    for (const item of media) {
      if (item.status === MediaStatus.BLOCKLISTED || item.status4k === MediaStatus.BLOCKLISTED) continue;
      for (const key of historyKeys(item, p)) {
        const identity = `${item.mediaType}:${key}`;
        if (byKey.has(identity) && byKey.get(identity)?.id !== item.id) throw Error('Ambiguous history alias');
        byKey.set(identity, item);
      }
    }
    // Re-read opt-outs after I/O, including cache hits. Never expose timestamps.
    p = policy();
    if (!p.enabled) return res.json({ enabled: false, page, totalResults: 0, totalPages: 0, results: [] });
    const watched = new Map<number, { item: Media; stamp: number }>();
    for (const row of rows) {
      const userId = mapped.get(row.plexId);
      if (userId === undefined || p.hiddenWatchers.includes(userId)) continue;
      const item = byKey.get(`${row.type}:${row.key}`);
      if (item && (type === 'all' || item.mediaType === type) && row.stamp > (watched.get(item.id)?.stamp || 0)) watched.set(item.id, { item, stamp: row.stamp });
    }
    const byTmdb = new Map(media.filter(m => m.status !== MediaStatus.BLOCKLISTED && m.status4k !== MediaStatus.BLOCKLISTED).map(m => [`${m.mediaType}:${m.tmdbId}`, m]));
    for (const row of partyRows) {
      if (!users.some(u => u.id === row.userId) || p.hiddenWatchers.includes(row.userId)) continue;
      const item = byTmdb.get(`${row.mediaType}:${row.tmdbId}`);
      if (item && (type === 'all' || item.mediaType === type) && row.stamp > (watched.get(item.id)?.stamp || 0)) watched.set(item.id, { item, stamp: row.stamp });
    }
    const results = [...watched.values()].sort((a,b) => b.stamp - a.stamp || b.item.id - a.item.id).slice((page - 1) * 20, page * 20)
      .map(({item}) => ({ id: item.id, tmdbId: item.tmdbId, tvdbId: item.tvdbId, mediaType: item.mediaType }));
    return res.json({ enabled: true, page, totalResults: watched.size, totalPages: Math.ceil(watched.size / 20), results });
  } catch { return res.status(503).json({ error: 'Watch history unavailable' }); }
});


router.get('/:type/:id', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const type = String(req.params.type), id = Number(req.params.id);
  if (!['movie', 'tv'].includes(type) || !Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid media' });
  try {
    let p = policy();
    if (!p.enabled) return res.json({ watchers: [], requesters: [], enabled: false });
    const media = await getRepository(Media).findOne({ where: { tmdbId: id, mediaType: type as MediaType }, relations: ['requests', 'requests.requestedBy', 'requests.seasons'] });
    if (!media) return res.json({ watchers: [], requesters: [], enabled: true });
    const users = await getRepository(User).find();
    const mapped = new Map<string, User>();
    for (const user of users) if (user.plexId) mapped.set(String(user.plexId), user);
    // Read only the literal mapping block; never execute the avatar-sync script.
    const source = fs.readFileSync(p.mappingScript, 'utf8');
    const block = source.match(/const mappings = \[([\s\S]*?)\];/)?.[1];
    if (!block) throw Error('Mapping unavailable');
    for (const m of block.matchAll(/\['(\d+)'\s*,\s*'[^']+'\s*,\s*(\d+)\s*,\s*'([^']+)'\]/g)) {
      const user = users.find(u => u.id === Number(m[2]) && u.username === m[3]);
      if (user) mapped.set(m[1], user);
    }
    const person = (u: User): Person => ({ id: u.id, name: u.username || u.plexUsername || 'User', avatar: u.avatar });
    const requested = new Map<number, Person>();
    for (const request of media.requests || []) {
      if (!request.requestedBy || request.status === 3) continue;
      const u = request.requestedBy;
      const entry = requested.get(u.id) || { ...person(u), seasons: [] };
      entry.seasons = [...new Set([...(entry.seasons || []), ...(request.seasons || []).map(s => s.seasonNumber)])].sort((a,b) => a-b);
      requested.set(u.id, entry);
    }
    const watched = new Map<number, Person>();
    let historyAvailable = true;
    let historyStale = false;
    try {
      for (const key of historyKeys(media, p)) {
        const snapshot = await history(String(key), type, p);
        historyStale ||= snapshot.stale;
        for (const [plexId, lastWatched] of snapshot.value) {
          const u = mapped.get(plexId);
          if (u && lastWatched > (watched.get(u.id)?.lastWatched || 0)) watched.set(u.id, { ...person(u), lastWatched });
        }
      }
    } catch { historyAvailable = false; }
    for (const row of await partyWatched()) {
      if (row.tmdbId !== id || row.mediaType !== type) continue;
      const u = users.find(u => u.id === row.userId);
      if (u && row.stamp > (watched.get(u.id)?.lastWatched || 0)) watched.set(u.id, { ...person(u), lastWatched: row.stamp });
    }
    p = policy(); // Opt-outs apply even when changed during a history fetch.
    if (!p.enabled) return res.json({ watchers: [], requesters: [], enabled: false });
    return res.json({ enabled: true, historyAvailable, historyStale,
      watchers: [...watched.values()].filter(u => !p.hiddenWatchers.includes(u.id)).sort((a,b) => (b.lastWatched || 0)-(a.lastWatched || 0)),
      requesters: [...requested.values()].filter(u => !p.hiddenRequesters.includes(u.id)),
    });
  } catch { return res.status(503).json({ error: 'Social information unavailable' }); }
});
export default router;
