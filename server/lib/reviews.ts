import { getRepository } from '@server/datasource';
import { LetterboxdAccount, MovieReview } from '@server/entity/MovieReview';
import {
  importKey,
  letterboxdEntryIdentity,
  letterboxdUrl,
  type ImportedReview,
} from '@server/lib/letterboxdImport';
import axios from 'axios';
import logger from '@server/logger';
import type { EntityManager } from 'typeorm';
import { wasVerifiedDeleted } from './letterboxdDeletedEntries';

const matches = new Map<string, { id: number; type: 'movie' | 'tv' }>();
const shortLinks = new Map<string, string>();
export async function expandReviewLink(
  entry: ImportedReview,
  username: string
) {
  if (new URL(entry.externalUrl).hostname !== 'boxd.it') return;
  let target = shortLinks.get(entry.externalUrl);
  if (!target) {
    const response = await axios.head(letterboxdUrl(entry.externalUrl), {
      timeout: 10000,
      maxRedirects: 0,
      validateStatus: (status) => status === 301 || status === 302,
    });
    target = letterboxdUrl(String(response.headers.location), username);
    if (new URL(target).hostname !== 'letterboxd.com')
      throw Error('Invalid short-link destination');
    if (shortLinks.size >= 2000)
      shortLinks.delete(shortLinks.keys().next().value!);
    shortLinks.set(entry.externalUrl, target);
  }
  entry.externalUrl = letterboxdUrl(target, username);
  entry.key = importKey(entry.externalUrl, entry.watchedDate);
}
let activeFetches = 0;
const fetchWaiters: (() => void)[] = [];
const locks = new Map<number, Promise<unknown>>();
export async function withReviewLock<T>(
  userId: number,
  work: () => Promise<T>
): Promise<T> {
  const prior = locks.get(userId) || Promise.resolve();
  const next = prior.catch(() => undefined).then(work);
  locks.set(userId, next);
  try {
    return await next;
  } finally {
    if (locks.get(userId) === next) locks.delete(userId);
  }
}
export async function fetchLetterboxd(url: string) {
  if (activeFetches >= 4) {
    if (fetchWaiters.length >= 100) throw Error('Fetch queue full');
    await new Promise<void>((resolve) => fetchWaiters.push(resolve));
  } else activeFetches++;
  try {
    const response = await axios.get<string>(letterboxdUrl(url), {
      timeout: 10000,
      maxContentLength: 2 * 1024 * 1024,
      maxRedirects: 3,
      responseType: 'text',
      beforeRedirect: (o) => {
        if (o.hostname !== 'letterboxd.com' || o.protocol !== 'https:')
          throw Error('Unexpected redirect');
      },
    });
    return response.data;
  } finally {
    const next = fetchWaiters.shift();
    if (next) next();
    else activeFetches--;
  }
}
export async function resolveReview(
  entry: ImportedReview
): Promise<number | undefined> {
  if (entry.tmdbId) return entry.tmdbId;
  const cached = matches.get(entry.externalUrl);
  if (cached) {
    entry.mediaType = cached.type;
    return cached.id;
  }
  try {
    const filmPath = new URL(entry.externalUrl).pathname.match(
      /^\/[^/]+\/film\/([^/]+)\//
    );
    let html: string;
    try {
      html = await fetchLetterboxd(entry.externalUrl);
    } catch (error) {
      // A review can be inaccessible while its film metadata remains public.
      // Resolve metadata only; retain the exact review identity for reconciliation.
      if (!filmPath) throw error;
      html = await fetchLetterboxd(
        `https://letterboxd.com/film/${filmPath[1]}/`
      );
    }
    let match =
      html.match(/data-tmdb-id=["'](\d+)["']/i) ||
      html.match(/themoviedb\.org\/movie\/(\d+)/i);
    if (!match) {
      const film = new URL(entry.externalUrl).pathname.match(
        /^\/[^/]+\/film\/([^/]+)\//
      );
      if (film) {
        html = await fetchLetterboxd(`https://letterboxd.com/film/${film[1]}/`);
        match =
          html.match(/data-tmdb-id=["'](\d+)["']/i) ||
          html.match(/themoviedb\.org\/movie\/(\d+)/i);
      }
    }
    const typed = html.match(/themoviedb\.org\/(movie|tv)\/(\d+)/i);
    const id = Number(typed?.[2] || match?.[1]);
    if (Number.isSafeInteger(id) && id > 0) {
      if (matches.size >= 2000) matches.delete(matches.keys().next().value!);
      entry.mediaType = typed?.[1] === 'tv' ? 'tv' : 'movie';
      matches.set(entry.externalUrl, { id, type: entry.mediaType });
      return id;
    }
  } catch {
    /* Show unresolved entries for explicit matching; never fuzzy-match. */
  }
}
export async function saveImported(
  userId: number,
  entry: ImportedReview,
  tmdbId: number,
  allowUpdate = true,
  manager?: EntityManager
) {
  const { exportAllowsImport } = await import('./letterboxdExportPolicy');
  if (!(await exportAllowsImport(userId,entry,tmdbId))) return;
  const repo =
    manager?.getRepository(MovieReview) || getRepository(MovieReview);
  const mediaType = entry.mediaType || 'movie';
  const entryKind = entry.entryKind || 'diary';
  const externalEntryId =
    entryKind === 'diary' ? letterboxdEntryIdentity(entry.externalUrl) : null;
  if (externalEntryId && wasVerifiedDeleted(userId, externalEntryId)) return;
  let id =
    entryKind === 'summary'
      ? `letterboxd:${userId}:${mediaType}:${tmdbId}:summary`
      : `letterboxd:${userId}:${entry.key}`;
  let old = await repo.findOneBy({ id });
  if (externalEntryId) {
    const candidates = (
      await repo.findBy({ userId, source: 'letterboxd', entryKind: 'diary' })
    ).filter(
      (r) =>
        r.externalEntryId === externalEntryId ||
        (r.externalUrl &&
          letterboxdEntryIdentity(r.externalUrl) === externalEntryId)
    );
    if (candidates.length > 1)
      throw Error(
        'Ambiguous Letterboxd entry identity; reconciliation required'
      );
    if (candidates.length === 1) {
      if (
        candidates[0].tmdbId !== tmdbId ||
        candidates[0].mediaType !== mediaType
      )
        throw Error('Letterboxd entry media identity changed');
      old = candidates[0];
      id = old.id;
    }
  }
  if (!old && entryKind === 'summary') {
    const previous = await repo.findBy({
      userId,
      tmdbId,
      mediaType,
      source: 'letterboxd',
      entryKind: 'summary',
    });
    old = previous[0] || null;
    if (old) id = old.id;
  }
  if (!old && entry.watchedDate) {
    const sameViewing = await repo.findBy({
      userId,
      tmdbId,
      mediaType,
      source: 'letterboxd',
      watchedDate: entry.watchedDate,
    });
    // A diary CSV and its written review describe the same viewing. Explicit
    // distinct written rewatch reviews remain separate.
    old =
      sameViewing.find(
        (r) =>
          r.externalUrl === entry.externalUrl ||
          ((!r.text || !entry.text) &&
            [r.externalUrl, entry.externalUrl].some(
              (url) => url && new URL(url).pathname.startsWith('/film/')
            ))
      ) || null;
    if (old) id = old.id;
  }
  if (old && !old.text && entry.text) allowUpdate = true;
  if (old && old.rating === null && entry.rating !== null) allowUpdate = true;
  if (old && !allowUpdate) return;
  const explicitKnown =
    !!old &&
    !!externalEntryId &&
    (old.externalEntryId === externalEntryId ||
      (old.externalUrl &&
        letterboxdEntryIdentity(old.externalUrl) === externalEntryId));
  if (
    !old &&
    entry.explicitFields &&
    !entry.text &&
    entry.rating === null &&
    !entry.watchedDate
  )
    return;
  const clearRating = explicitKnown && entry.explicitFields?.rating;
  const clearReview = explicitKnown && entry.explicitFields?.review;
  const next = {
    id,
    userId,
    tmdbId,
    mediaType,
    watched: entry.watched ?? true,
    entryKind,
    source: 'letterboxd' as const,
    rating: clearRating ? entry.rating : (entry.rating ?? old?.rating ?? null),
    text: clearReview ? entry.text : entry.text || old?.text || '',
    spoiler:
      clearReview || entry.text ? entry.spoiler : old?.spoiler || entry.spoiler,
    publishedAt: entry.publishedAt,
    updatedAt: new Date().toISOString(),
    externalUrl: !entry.text && old?.text ? old.externalUrl : entry.externalUrl,
    externalEntryId: externalEntryId || old?.externalEntryId || null,
    watchedDate: entry.watchedDate,
  };
  // Keep identity stable across polls/imports. Unchanged entries retain their
  // update timestamp and never move to the top of the recent-review feed.
  if (
    old &&
    JSON.stringify([
      old.rating,
      old.text,
      old.spoiler,
      old.watchedDate,
      old.watched,
      old.externalEntryId,
    ]) ===
      JSON.stringify([
        next.rating,
        next.text,
        next.spoiler,
        next.watchedDate,
        next.watched,
        next.externalEntryId,
      ])
  )
    return;
  await repo.save(repo.create(next));
}
const pending = new Map<number, Promise<void>>();
export function syncReviews(userId: number): Promise<void> {
  if (pending.has(userId)) return pending.get(userId)!;
  const work = withReviewLock(userId, async () => {
    const repo = getRepository(LetterboxdAccount),
      account = await repo.findOneBy({ userId });
    if (!account?.enabled) return;
    const username = account.username;
    const started = Date.now();
    logger.info('RSS account refresh started', { label: 'Letterboxd', userId });
    await repo.update({ userId }, { lastAttempt: new Date().toISOString() });
    try {
      const { backgroundWork } = await import('./backgroundWork');
      const entries = await backgroundWork.run(
        { kind: 'rss', username },
        () => fetchLetterboxd(`https://letterboxd.com/${username}/rss/`)
      );
      // A linked account can be disabled/replaced while collection is underway.
      const current = await repo.findOneBy({ userId });
      if (!current?.enabled || current.username !== username) return;
      let unresolved = 0;
      for (const entry of entries) {
        const id = await resolveReview(entry);
        if (id) await saveImported(userId, entry, id);
        else unresolved++;
      }
      await repo.update(
        { userId, username },
        {
          lastSync: new Date().toISOString(),
          error: unresolved ? 'unresolved' : null,
        }
      );
      logger.info('RSS account refresh completed', { label: 'Letterboxd', userId, entries: entries.length, unresolved, durationMs: Date.now() - started });
    } catch (error) {
      await repo.update({ userId, username }, { error: 'unavailable' });
      const failure = error as {code?: unknown; response?: {status?: unknown}};
      logger.warn('RSS account refresh failed', { label: 'Letterboxd', userId, reason: 'unavailable', durationMs: Date.now() - started, code: typeof failure?.code === 'string' && /^[A-Z_0-9]{1,50}$/.test(failure.code) ? failure.code : 'RSS_REFRESH_FAILED', httpStatus: typeof failure?.response?.status === 'number' ? failure.response.status : undefined });
    }
  }).finally(() => pending.delete(userId));
  pending.set(userId, work);
  return work;
}
let polling = false;
/** Do not hold the browser acknowledgement or review lock while fetching RSS.
 * lastSync also suppresses repeated acknowledgements of the same publication. */
export function refreshReviewsAfterPublication(userId: number, verifiedAt: number) {
  void (async () => {
    // An older in-flight fetch may predate the write; finish it before deciding
    // whether a fresh pass is required.
    const existing = pending.get(userId);
    if (existing) await existing;
    const account = await getRepository(LetterboxdAccount).findOneBy({ userId });
    if (!account?.enabled || (!existing && Date.parse(account.lastSync || '') >= verifiedAt)) return;
    await syncReviews(userId);
  })().catch(() => logger.warn('Post-publication RSS refresh failed', { label: 'Letterboxd', userId }));
}
export async function pollReviews(force = false) {
  if (polling) return;
  polling = true;
  try {
    for (const a of await getRepository(LetterboxdAccount).findBy({
      enabled: true,
    })) {
      if (
        force || !a.lastAttempt ||
        Date.now() - Date.parse(a.lastAttempt) >= 14 * 60 * 1000
      )
        await syncReviews(a.userId);
      else logger.info('RSS account refresh skipped', { label: 'Letterboxd', userId: a.userId, reason: 'cooldown' });
    }
  } finally {
    polling = false;
  }
}
