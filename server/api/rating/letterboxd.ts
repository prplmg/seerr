import axios from 'axios';

export interface LetterboxdRating {
  score: number;
  url: string;
}

export function parseLetterboxdRating(html: string): LetterboxdRating | null {
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
        if (node['@type'] !== 'Movie' || !rating) continue;
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
  number,
  { value: LetterboxdRating | null; expires: number }
>();
const pending = new Map<number, Promise<LetterboxdRating | null>>();

export function getLetterboxdRating(
  id: number
): Promise<LetterboxdRating | null> {
  const previous = cache.get(id);
  if (previous && previous.expires > Date.now())
    return Promise.resolve(previous.value);
  const running = pending.get(id);
  if (running) return running;
  if (pending.size >= 8) return Promise.resolve(previous?.value ?? null);
  const request = (async () => {
    let value = previous?.value ?? null;
    let ttl = 60 * 60 * 1000;
    try {
      const response = await axios.get<string>(
        `https://letterboxd.com/tmdb/${id}/`,
        {
          timeout: 10000,
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
        }
      );
      const rating = parseLetterboxdRating(response.data);
      if (rating) {
        value = rating;
        ttl = 24 * 60 * 60 * 1000;
      }
    } catch {
      // Keep a previously fetched rating during temporary upstream failures.
    }
    if (cache.size >= 1000 && !cache.has(id))
      cache.delete(cache.keys().next().value!);
    cache.set(id, { value, expires: Date.now() + ttl });
    return value;
  })().finally(() => pending.delete(id));
  pending.set(id, request);
  return request;
}
