import { getRepository } from '@server/datasource';
import { LetterboxdAccount, MovieReview } from '@server/entity/MovieReview';
import {
  importKey,
  letterboxdUrl,
  rssReviews,
  type ImportedReview,
} from '@server/lib/letterboxdImport';
import axios from 'axios';
import type { EntityManager } from 'typeorm';

const matches = new Map<string, number>();
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
  if (matches.has(entry.externalUrl)) return matches.get(entry.externalUrl);
  try {
    let html = await fetchLetterboxd(entry.externalUrl);
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
    const id = Number(match?.[1]);
    if (Number.isSafeInteger(id) && id > 0) {
      if (matches.size >= 2000) matches.delete(matches.keys().next().value!);
      matches.set(entry.externalUrl, id);
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
  const repo =
      manager?.getRepository(MovieReview) || getRepository(MovieReview),
    id = `letterboxd:${userId}:${entry.key}`;
  const old = await repo.findOneBy({ id });
  if (old && !allowUpdate) return;
  const next = {
    id,
    userId,
    tmdbId,
    source: 'letterboxd' as const,
    rating: entry.rating,
    text: entry.text,
    spoiler: entry.spoiler,
    publishedAt: entry.publishedAt,
    updatedAt: new Date().toISOString(),
    externalUrl: entry.externalUrl,
    watchedDate: entry.watchedDate,
  };
  // Keep identity stable across polls/imports. Unchanged entries retain their
  // update timestamp and never move to the top of the recent-review feed.
  if (
    old &&
    JSON.stringify([old.rating, old.text, old.spoiler]) ===
      JSON.stringify([next.rating, next.text, next.spoiler])
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
    await repo.update({ userId }, { lastAttempt: new Date().toISOString() });
    try {
      const entries = await rssReviews(
        await fetchLetterboxd(
          `https://letterboxd.com/${account.username}/rss/`
        ),
        account.username
      );
      let unresolved = 0;
      for (const entry of entries) {
        const id = await resolveReview(entry);
        if (id) await saveImported(userId, entry, id);
        else unresolved++;
      }
      await repo.update(
        { userId, username: account.username },
        {
          lastSync: new Date().toISOString(),
          error: unresolved ? 'unresolved' : null,
        }
      );
    } catch {
      await repo.update({ userId }, { error: 'unavailable' });
    }
  }).finally(() => pending.delete(userId));
  pending.set(userId, work);
  return work;
}
let polling = false;
export async function pollReviews() {
  if (polling) return;
  polling = true;
  try {
    for (const a of await getRepository(LetterboxdAccount).findBy({
      enabled: true,
    })) {
      if (
        !a.lastAttempt ||
        Date.now() - Date.parse(a.lastAttempt) >= 14 * 60 * 1000
      )
        await syncReviews(a.userId);
    }
  } finally {
    polling = false;
  }
}
