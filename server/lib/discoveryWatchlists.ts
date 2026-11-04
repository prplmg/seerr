import { getRepository } from '@server/datasource';
import { LetterboxdAccount } from '@server/entity/MovieReview';
import logger from '@server/logger';
import { appDataPath } from '@server/utils/appDataVolume';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { In } from 'typeorm';
import { readAccountMappings } from './accountMappings';
import type { ListFilm } from './discoveryLists';
import { readBrowserState } from './letterboxdBrowser';
import { matchWatchlistFilm } from './letterboxdWatchlistMatch';
import { plexProfileWatchlist } from './plexWatchlist';

type Match = { tmdbId: number; mediaType: 'movie' | 'tv' };
type FilmHint = Match & { externalUrl: string };
type Cached = { value: Match | null; retryAt: number };
export type WatchlistInterest = ListFilm & { userId: number };

/** Resolve exact Letterboxd IDs off the request path. One shared two-worker
 * queue, persisted successes, and negative retry TTL prevent hundreds of film
 * lookups on each refresh. Never infer identity from a film's title. */
export function createWatchlistMatcher(
  resolve: (slug: string) => Promise<Match | null>,
  save: (values: Record<string, Cached>) => void,
  initial: Record<string, Cached> = {}
) {
  const values = new Map(
    Object.entries(initial).filter(
      ([slug, cached]) =>
        /^[a-z0-9-]{1,200}$/.test(slug) &&
        cached &&
        Number.isFinite(cached.retryAt) &&
        (cached.value === null ||
          (Number.isSafeInteger(cached.value?.tmdbId) &&
            cached.value.tmdbId > 0 &&
            ['movie', 'tv'].includes(cached.value.mediaType)))
    )
  );
  const waiting = new Set<string>();
  const queue: string[] = [];
  let active = 0,
    dirty = 0;
  const persist = () => {
    if (!dirty) return;
    try {
      save(Object.fromEntries(values));
      dirty = 0;
    } catch (error) {
      logger.warn('Could not retain watchlist film matches', {
        label: 'Discovery',
        error: String(error),
      });
    }
  };
  const pump = () => {
    while (active < 2 && queue.length) {
      const slug = queue.shift()!;
      if (values.get(slug)?.value) {
        waiting.delete(slug);
        continue;
      }
      active++;
      void (async () => {
        let value: Match | null = null;
        try {
          value = await resolve(slug);
        } catch {
          /* Retry later. */
        }
        if (value || !values.get(slug)?.value)
          values.set(slug, { value, retryAt: Date.now() + 15 * 60 * 1000 });
        // Batch persistence; serializing the growing cache for every film
        // would needlessly compete with discovery requests on the main thread.
        dirty++;
        if (dirty >= 25) persist();
      })().finally(() => {
        active--;
        waiting.delete(slug);
        pump();
        if (!active && !queue.length) persist();
      });
    }
  };
  return (
    snapshots: { userId: number; slugs: string[] }[],
    hints: FilmHint[] = []
  ) => {
    const interests: WatchlistInterest[] = [];
    const frequency = new Map<string, number>();
    for (const snapshot of snapshots)
      for (const slug of new Set(snapshot.slugs))
        frequency.set(slug, (frequency.get(slug) || 0) + 1);
    const known = new Map<string, Match | null>();
    for (const hint of hints) {
      try {
        const url = new URL(hint.externalUrl);
        const slug = url.pathname.match(
          /^\/(?:[^/]+\/)?film\/([a-z0-9-]+)\//
        )?.[1];
        if (
          url.origin !== 'https://letterboxd.com' ||
          !slug ||
          !frequency.has(slug) ||
          !Number.isSafeInteger(hint.tmdbId) ||
          hint.tmdbId <= 0 ||
          !['movie', 'tv'].includes(hint.mediaType)
        )
          continue;
        const prior = known.get(slug);
        if (
          prior === null ||
          (prior &&
            (prior.tmdbId !== hint.tmdbId ||
              prior.mediaType !== hint.mediaType))
        )
          known.set(slug, null);
        else
          known.set(slug, { tmdbId: hint.tmdbId, mediaType: hint.mediaType });
      } catch {
        /* Malformed/unresolved URLs are not film identity evidence. */
      }
    }
    for (const [slug, value] of known)
      if (value && !values.get(slug)?.value) {
        values.set(slug, { value, retryAt: 0 });
        dirty++;
      }
    let updating = false,
      unresolved = 0;
    for (const snapshot of snapshots)
      for (const slug of new Set(snapshot.slugs)) {
        if (!/^[a-z0-9-]{1,200}$/.test(slug)) continue;
        const cached = values.get(slug);
        if (cached?.value)
          interests.push({
            userId: snapshot.userId,
            type: cached.value.mediaType,
            tmdbId: cached.value.tmdbId,
          });
        else if (!cached || cached.retryAt <= Date.now()) {
          updating = true;
          if (!waiting.has(slug)) {
            waiting.add(slug);
            queue.push(slug);
          }
        } else unresolved++;
      }
    // Shared films are the highest-priority recommendations: resolve these
    // first instead of letting one long watchlist monopolize the queue.
    queue.sort((a, b) => (frequency.get(b) || 0) - (frequency.get(a) || 0));
    pump();
    if (!active && !queue.length) persist();
    return { interests, updating, unresolved };
  };
}

let matcher: ReturnType<typeof createWatchlistMatcher> | undefined;
const plexSnapshots = new Map<
  string,
  {
    items: ListFilm[];
    until: number;
    pending: boolean;
    failed?: boolean;
  }
>();
function plexInterests(userIds: number[]) {
  const mappings = readAccountMappings();
  const entries = userIds.map((userId) => {
    const mapping = mappings.users.find((u) => u.userId === userId);
    // Explicitly unmapped profiles have no Plex watchlist to consult.
    if (mapping && !mapping.watchlistPlexId) return undefined;
    // Users sharing the same mapped Plex profile share one in-flight fetch and
    // snapshot. Attribute interest to each selected person only when reading.
    const key = mapping?.watchlistPlexId
      ? `profile:${mapping.watchlistPlexId}`
      : `account:${userId}`;
    let entry = plexSnapshots.get(key);
    if (!entry) {
      entry = { items: [], until: 0, pending: false };
      plexSnapshots.set(key, entry);
    }
    if (!entry.pending && entry.until <= Date.now()) {
      entry.pending = true;
      const target = entry;
      void (async () => {
        try {
          const items: ListFilm[] = [];
          let pages = 1;
          for (let page = 1; page <= pages; page++) {
            const result = await plexProfileWatchlist(userId, page);
            pages = result.totalPages;
            if (pages > 250) throw Error('Watchlist exceeds matching limit');
            for (const item of result.results)
              if (Number.isSafeInteger(item.tmdbId) && item.tmdbId! > 0)
                items.push({
                  tmdbId: item.tmdbId!,
                  type: item.mediaType,
                });
          }
          target.items = items; // Replace only a complete snapshot, including empty.
          target.failed = false;
          target.until = Date.now() + 60_000;
        } catch {
          target.until = Date.now() + 5 * 60_000;
          target.failed = true;
        } finally {
          target.pending = false;
        }
      })();
    }
    return { userId, entry };
  });
  return {
    interests: entries.flatMap((e) =>
      e ? e.entry.items.map((f) => ({ ...f, userId: e.userId })) : []
    ),
    updating: entries.some((e) => e?.entry.pending),
    unresolved: entries.filter((e) => e?.entry.failed).length,
  };
}
export async function discoveryWatchlists(
  userIds: number[],
  hints: FilmHint[] = [],
  source?: 'plex' | 'letterboxd'
) {
  if (source === 'plex') return plexInterests(userIds);
  // Recheck current account bindings on every request, even with cached matches.
  const accounts = await getRepository(LetterboxdAccount).findBy({
    userId: In(userIds),
    enabled: true,
  });
  const snapshots = readBrowserState()
    .bindings.filter(
      (b) =>
        b.enabled &&
        userIds.includes(b.userId) &&
        b.snapshot &&
        accounts.some(
          (a) =>
            a.userId === b.userId &&
            a.username.toLowerCase() === b.username.toLowerCase()
        )
    )
    .map((b) => ({
      userId: b.userId,
      slugs: b.snapshot!.items.map((i) => i.slug),
    }));
  if (!matcher) {
    const file = path.join(appDataPath(), 'discovery-watchlist-matches.json');
    let initial: Record<string, Cached> = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        initial = parsed;
    } catch (error) {
      if (error.code !== 'ENOENT')
        logger.warn('Watchlist match cache unavailable', {
          label: 'Discovery',
        });
    }
    matcher = createWatchlistMatcher(
      matchWatchlistFilm,
      (values) => {
        const temp = `${file}.${randomUUID()}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(values), { mode: 0o600 });
        try {
          fs.renameSync(temp, file);
        } finally {
          if (fs.existsSync(temp)) fs.unlinkSync(temp);
        }
      },
      initial
    );
  }
  const letterboxd = matcher(snapshots, hints);
  if (source === 'letterboxd') return letterboxd;
  const plex = plexInterests(userIds);
  return {
    interests: [...letterboxd.interests, ...plex.interests],
    updating: letterboxd.updating || plex.updating,
    unresolved: letterboxd.unresolved + plex.unresolved,
  };
}
