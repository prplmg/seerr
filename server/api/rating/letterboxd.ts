import axios from 'axios';

export interface LetterboxdRating {
  score: number;
  url: string;
}

export function parseLetterboxdRating(
  html: string,
  mediaType: 'movie' | 'tv' = 'movie'
): LetterboxdRating | null {
  for (const script of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    try {
      const parsed = JSON.parse(
        script[1]
          .replace(/\/\*\s*<!\[CDATA\[\s*\*\/|\/\*\s*\]\]>\s*\*\//g, '')
          .trim()
      );
      const nodes = Array.isArray(parsed)
        ? parsed
        : (parsed['@graph'] ?? [parsed]);
      for (const node of nodes) {
        const rating = node.aggregateRating;
        // Letterboxd commonly labels supported miniseries as Movie. Also accept
        // TVSeries for typed TV lookups, but never an individual TVEpisode.
        if (
          !(
            node['@type'] === 'Movie' ||
            (mediaType === 'tv' && node['@type'] === 'TVSeries')
          ) ||
          !rating
        )
          continue;
        const score = Number(rating.ratingValue);
        const url = new URL(node.url);
        if (
          Number(rating.bestRating) === 5 &&
          Number.isFinite(score) &&
          score >= 0 &&
          score <= 5 &&
          url.origin === 'https://letterboxd.com' &&
          url.pathname.startsWith('/film/')
        ) {
          return { score, url: url.href };
        }
      }
    } catch {
      // A malformed or unrelated structured-data block is not a rating.
    }
  }
  return null;
}

const cache = new Map<
  string,
  { value: LetterboxdRating | null; expires: number; verifiedAt: number }
>();
const pending = new Map<string, Promise<LetterboxdRating | null>>();

export function getLetterboxdRating(
  id: number,
  mediaType: 'movie' | 'tv' = 'movie',
  knownFilm?: () => Promise<string | null>
): Promise<LetterboxdRating | null> {
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !['movie', 'tv'].includes(mediaType)
  )
    return Promise.resolve(null);
  const key = `${mediaType}:${id}`;
  const previous = cache.get(key);
  if (previous && previous.expires > Date.now())
    return Promise.resolve(previous.value);
  const running = pending.get(key);
  if (running) return running;
  if (pending.size >= 8) return Promise.resolve(previous?.value ?? null);
  const request = (async () => {
    const deadline = Date.now() + 10000;
    let value = previous?.value ?? null;
    let verifiedAt = previous?.verifiedAt ?? 0;
    let ttl = 60 * 60 * 1000;
    let known: string | null = null;
    try {
      known = (await knownFilm?.()) ?? null;
    } catch {
      /* Mapping failure must not block the normal lookup. */
    }
    if (
      known &&
      !/^https:\/\/letterboxd\.com\/film\/[a-z0-9-]+\/$/i.test(known)
    )
      known = null;
    const urls = [
      ...(known ? [known] : []),
      `https://letterboxd.com/tmdb/${id}/${mediaType === 'tv' ? 'tv/' : ''}`,
    ];
    for (const url of urls) {
      const timeout = deadline - Date.now();
      if (timeout <= 0) break;
      try {
        const response = await axios.get<string>(url, {
          timeout,
          maxContentLength: 2 * 1024 * 1024,
          maxRedirects: 4,
          responseType: 'text',
          beforeRedirect: (options) => {
            if (
              options.hostname !== 'letterboxd.com' ||
              options.protocol !== 'https:'
            )
              throw new Error('Unexpected Letterboxd redirect');
          },
        });
        const rating = parseLetterboxdRating(response.data, mediaType);
        if (url === known) {
          const identity = response.data.match(
            /themoviedb\.org\/(movie|tv)\/(\d+)(?:[/?"'\s<]|$)/i
          );
          if (
            !identity ||
            identity[1] !== mediaType ||
            Number(identity[2]) !== id ||
            rating?.url !== known
          )
            continue;
        }
        if (rating) {
          value = rating;
          verifiedAt = Date.now();
          ttl = 24 * 60 * 60 * 1000;
          break;
        }
      } catch {
        // Retry temporary failures sooner; retain a previously fetched rating.
        ttl = 5 * 60 * 1000;
      }
    }
    if (cache.size >= 1000 && !cache.has(key))
      cache.delete(cache.keys().next().value!);
    cache.set(key, { value, expires: Date.now() + ttl, verifiedAt });
    return value;
  })().finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

/** List refreshes must not mistake a stale fallback for a newly verified score. */
export async function getFreshLetterboxdRating(
  id: number,
  mediaType: 'movie' | 'tv' = 'movie'
) {
  const value = await getLetterboxdRating(id, mediaType);
  const verifiedAt = cache.get(`${mediaType}:${id}`)?.verifiedAt;
  return verifiedAt && Date.now() - verifiedAt < 24 * 60 * 60 * 1000
    ? value
    : null;
}
