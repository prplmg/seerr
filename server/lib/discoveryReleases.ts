import TheMovieDb from '@server/api/themoviedb';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import logger from '@server/logger';
import { appDataPath } from '@server/utils/appDataVolume';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { discoveryMedia, discoveryRequests } from './discoveryDatabaseCache';
import { updateListStore } from './discoveryLists';
import { cachedReleaseEpisodes } from './discoveryReleaseCache';
import {
  assertDiscoveryRevision,
  discoveryFileStamp,
  discoveryRevision,
  stableDiscoveryRead,
} from './discoverySharedCache';

type Interest = { key: string; since: number };
type Episode = {
  season: number;
  episode: number;
  name: string;
  date: string;
  image?: string;
};
type Title = {
  checkedAt: number;
  name: string;
  poster?: string;
  release?: string;
  episodes: Episode[];
  available?: boolean;
  downloadedAt?: number;
};
type State = {
  version: 1;
  follows: Record<string, Interest[]>;
  titles: Record<string, Title>;
};
const filename = () => path.join(appDataPath(), 'discovery-releases.json');
const empty = (): State => ({ version: 1, follows: {}, titles: {} });
export function readReleaseState(): State {
  if (!fs.existsSync(filename())) return empty();
  const state = JSON.parse(fs.readFileSync(filename(), 'utf8')) as State;
  if (state.version !== 1 || !state.follows || !state.titles)
    throw Error('Invalid release store');
  return state;
}
function update(fn: (state: State) => void) {
  const state = readReleaseState();
  fn(state);
  const target = filename(),
    temp = `${target}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.writeFileSync(temp, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, target);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
export function releaseKey(type: string, id: number) {
  if (!['movie', 'tv'].includes(type) || !Number.isSafeInteger(id) || id < 1)
    throw Error('Invalid media');
  return `${type}:${id}`;
}
export function setReleaseFollow(
  userId: number,
  key: string,
  following: boolean
) {
  update((s) => {
    const current = s.follows[userId] || [];
    if (following && !current.some((i) => i.key === key)) {
      if (current.length >= 500) throw Error('Follow limit reached');
      s.follows[userId] = [...current, { key, since: Date.now() }];
    } else if (!following)
      s.follows[userId] = current.filter((i) => i.key !== key);
  });
}
async function interests() {
  const requests = await discoveryRequests();
  const result = new Map<number, Interest[]>();
  for (const [user, items] of Object.entries(readReleaseState().follows))
    result.set(Number(user), [...items]);
  for (const r of requests) {
    if (!r.media || !r.requestedBy || r.status === MediaRequestStatus.DECLINED)
      continue;
    const key = releaseKey(r.media.mediaType, r.media.tmdbId),
      since = new Date(r.createdAt).getTime();
    if (!Number.isFinite(since)) continue;
    const rows = result.get(r.requestedBy.id) || [],
      old = rows.find((i) => i.key === key);
    if (old) old.since = Math.min(old.since, since);
    else rows.push({ key, since });
    result.set(r.requestedBy.id, rows);
  }
  return result;
}
export function observeAvailability(
  title: Title,
  available: boolean,
  now: number
) {
  // Initial snapshots are not download events. A re-download is a new transition.
  if (title.available === false && available) title.downloadedAt = now;
  title.available = available;
}
export function releaseRows(
  items: Interest[],
  titles: State['titles'],
  now = Date.now()
) {
  const cutoff = now - 30 * 86400000;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Merida',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const episodes: {
    key: string;
    name: string;
    date: string;
    season: number;
    episode: number;
    episodeName: string;
    image?: string;
    poster?: string;
  }[] = [];
  const movies: { key: string; name: string; downloadedAt: number }[] = [];
  for (const interest of items) {
    const title = titles[interest.key];
    if (!title) continue;
    for (const ep of title.episodes) {
      const at = Date.parse(ep.date + 'T23:59:59Z');
      // Air date is a calendar date, not proof of download or an exact release time.
      if (at >= cutoff && ep.date <= today)
        episodes.push({
          key: interest.key,
          name: title.name,
          date: ep.date,
          season: ep.season,
          episode: ep.episode,
          episodeName: ep.name,
          image: ep.image,
          poster: title.poster,
        });
    }
    const release = Date.parse((title.release || '') + 'T00:00:00Z');
    if (
      title.available &&
      title.downloadedAt &&
      title.downloadedAt >= cutoff &&
      title.downloadedAt <= now &&
      interest.since < release &&
      interest.since <= title.downloadedAt
    )
      movies.push({
        key: interest.key,
        name: title.name,
        downloadedAt: title.downloadedAt,
      });
  }
  const uniqueEpisodes = [
    ...new Map(
      episodes.map((e) => [`${e.key}:${e.season}:${e.episode}`, e])
    ).values(),
  ].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      a.key.localeCompare(b.key) ||
      a.season - b.season ||
      a.episode - b.episode
  );
  const groups = new Map<string, typeof uniqueEpisodes>();
  for (const ep of uniqueEpisodes) {
    const key = `${ep.key}:${ep.date}`;
    groups.set(key, [...(groups.get(key) || []), ep]);
  }
  return {
    episodes: [...groups.values()].map((group) => ({
      ...group[0],
      episodes: group.map(({ season, episode, episodeName }) => ({
        season,
        episode,
        name: episodeName,
      })),
    })),
    movies: [...new Map(movies.map((m) => [m.key, m])).values()].sort(
      (a, b) => b.downloadedAt - a.downloadedAt
    ),
  };
}
export async function releasesForUser(userId: number) {
  return stableDiscoveryRead(() => buildReleasesForUser(userId));
}

async function buildReleasesForUser(userId: number) {
  const revision = discoveryRevision();
  const stamp = discoveryFileStamp([filename()]);
  const rows = (await interests()).get(userId) || [];
  const media = await discoveryMedia();
  const blocked = new Set(
    media
      .filter(
        (m) =>
          m.status === MediaStatus.BLOCKLISTED ||
          m.status4k === MediaStatus.BLOCKLISTED
      )
      .map((m) => `${m.mediaType}:${m.tmdbId}`)
  );
  const visible = rows.filter((r) => !blocked.has(r.key));
  const titles = readReleaseState().titles;
  // A historical download transition is not proof the movie is still present.
  for (const key of Object.keys(titles)) {
    if (!key.startsWith('movie:')) continue;
    const item = media.find((m) => `${m.mediaType}:${m.tmdbId}` === key);
    if (
      !item ||
      (item.status !== MediaStatus.AVAILABLE &&
        item.status4k !== MediaStatus.AVAILABLE)
    )
      titles[key] = { ...titles[key], available: false };
  }
  const checks = [...new Set(visible.map((r) => r.key))].filter((key) =>
    key.startsWith('tv:')
  );
  let next = 0;
  // Bound remote work; only recent aired episodes can be displayed.
  await Promise.all(
    Array.from({ length: Math.min(2, checks.length) }, async () => {
      while (next < checks.length) {
        const key = checks[next++],
          title = titles[key];
        if (!title) continue;
        const candidate = title.episodes.filter(
          (ep) =>
            Date.parse(ep.date + 'T23:59:59Z') >= Date.now() - 30 * 86400000 &&
            Date.parse(ep.date) <= Date.now()
        );
        const item = media.find((m) => `${m.mediaType}:${m.tmdbId}` === key);
        const available = item
          ? await cachedReleaseEpisodes(item, candidate)
          : new Set();
        titles[key] = {
          ...title,
          episodes: candidate.filter((ep) => available.has(ep)),
        };
      }
    })
  );
  assertDiscoveryRevision(revision);
  if (discoveryFileStamp([filename()]) !== stamp)
    throw Error('Release interests changed; retry discovery');
  return releaseRows(visible, titles);
}
let running = false;
export async function refreshDiscoveryReleases() {
  if (running) return;
  running = true;
  try {
    // Deliberately independent of discoveryEnabled: collect before UI rollout.
    const all = await interests(),
      keys = [...new Set([...all.values()].flat().map((i) => i.key))];
    const media = await discoveryMedia(),
      now = Date.now();
    const available = new Set(
      media
        .filter(
          (m) =>
            m.status !== MediaStatus.BLOCKLISTED &&
            m.status4k !== MediaStatus.BLOCKLISTED &&
            (m.status === MediaStatus.AVAILABLE ||
              m.status4k === MediaStatus.AVAILABLE)
        )
        .map((m) => `${m.mediaType}:${m.tmdbId}`)
    );
    updateListStore((s) => {
      const first = Object.keys(s.availability).length === 0;
      for (const key of new Set([
        ...Object.keys(s.availability),
        ...available,
      ])) {
        const old = s.availability[key],
          present = available.has(key);
        s.availability[key] = {
          available: present,
          since: old?.available === present ? old.since : first ? 0 : now,
        };
      }
    });
    update((s) => {
      for (const key of keys) {
        const m = media.find((m) => `${m.mediaType}:${m.tmdbId}` === key);
        s.titles[key] ||= { checkedAt: 0, name: '', episodes: [] };
        observeAvailability(
          s.titles[key],
          !!m &&
            (m.status === MediaStatus.AVAILABLE ||
              m.status4k === MediaStatus.AVAILABLE),
          now
        );
      }
    });
    const snapshot = readReleaseState(),
      api = new TheMovieDb();
    const batch = keys
      .filter((key) => now - snapshot.titles[key].checkedAt > 6 * 3600000)
      .sort(
        (a, b) => snapshot.titles[a].checkedAt - snapshot.titles[b].checkedAt
      )
      .slice(0, 20);
    for (const key of batch) {
      try {
        const [type, id] = key.split(':');
        let metadata: Pick<Title, 'name' | 'episodes' | 'release' | 'poster'>;
        if (type === 'movie') {
          const movie = await api.getMovie({ movieId: Number(id) });
          metadata = {
            name: movie.title,
            release: movie.release_date,
            episodes: [],
          };
        } else {
          const show = await api.getTvShow({ tvId: Number(id) });
          const episodes: Episode[] = [];
          // A current season can begin years ago; inspect the latest seasons too.
          const seasons = show.seasons
            .filter((s) => s.season_number > 0 && Date.parse(s.air_date) <= now)
            .sort((a, b) => b.season_number - a.season_number)
            .filter(
              (s, index) =>
                index < 2 || Date.parse(s.air_date) >= now - 31 * 86400000
            )
            .slice(0, 20);
          for (const season of seasons) {
            const data = await api.getTvSeason({
              tvId: Number(id),
              seasonNumber: season.season_number,
            });
            for (const ep of data.episodes)
              if (
                ep.air_date &&
                Date.parse(ep.air_date) >= now - 31 * 86400000 &&
                Date.parse(ep.air_date) <= now
              )
                episodes.push({
                  season: season.season_number,
                  episode: ep.episode_number,
                  name: ep.name,
                  date: ep.air_date,
                  image: ep.still_path || undefined,
                });
          }
          metadata = {
            name: show.name,
            episodes,
            poster: show.poster_path || undefined,
          };
        }
        update((s) => {
          s.titles[key] = { ...s.titles[key], ...metadata, checkedAt: now };
        });
      } catch {
        logger.warn(
          'Release metadata refresh failed; retaining previous data',
          { label: 'Discovery releases', key }
        );
        // Rotate failures fairly instead of starving all later titles.
        update((s) => {
          s.titles[key].checkedAt = now;
        });
      }
    }
  } finally {
    running = false;
  }
}
