import type { ImportedReview } from './letterboxdImport';
import { resolveReview } from './reviews';

type Match = { tmdbId: number; mediaType: 'movie' | 'tv' };
const cache = new Map<string, { value: Match | null; expires: number }>();
const pending = new Map<string, Promise<Match | null>>();

// Exact IDs from Letterboxd only. Titles are display text, never identity.
export async function matchWatchlistFilm(slug: string): Promise<Match | null> {
  if (!/^[a-z0-9-]{1,200}$/.test(slug)) throw Error('Invalid film slug');
  const saved = cache.get(slug);
  if (saved && saved.expires > Date.now()) return saved.value;
  const running = pending.get(slug);
  if (running) return running;
  const work = (async () => {
    const entry: ImportedReview = {
      key: slug,
      title: '',
      year: '',
      rating: null,
      text: '',
      spoiler: false,
      publishedAt: '',
      watchedDate: null,
      externalUrl: `https://letterboxd.com/film/${slug}/`,
    };
    const tmdbId = await resolveReview(entry);
    const value: Match | null = tmdbId
      ? { tmdbId, mediaType: entry.mediaType || 'movie' }
      : null;
    if (cache.size >= 5000) cache.delete(cache.keys().next().value!);
    cache.set(slug, {
      value,
      expires: Date.now() + (value ? 86400000 : 900000),
    });
    return value;
  })();
  pending.set(slug, work);
  try {
    return await work;
  } finally {
    pending.delete(slug);
  }
}
