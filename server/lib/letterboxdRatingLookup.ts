import { getLetterboxdRating } from '@server/api/rating/letterboxd';
import { getRepository } from '@server/datasource';
import { MovieReview } from '@server/entity/MovieReview';

export function canonicalLetterboxdFilm(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://letterboxd.com' || url.username || url.password)
      return null;
    const match = url.pathname.match(
      /^\/(?:[a-z0-9_]+\/)?film\/([a-z0-9-]+)\/(?:\d+\/)?$/i
    );
    return match ? `https://letterboxd.com/film/${match[1]}/` : null;
  } catch {
    return null;
  }
}

export function getMappedLetterboxdRating(
  id: number,
  mediaType: 'movie' | 'tv'
) {
  return getLetterboxdRating(id, mediaType, async () => {
    const rows = await getRepository(MovieReview).find({
      where: { tmdbId: id, mediaType, source: 'letterboxd' },
      select: ['externalUrl'],
    });
    const urls = new Set(
      rows
        .map((r) => canonicalLetterboxdFilm(r.externalUrl || ''))
        .filter((url): url is string => !!url)
    );
    return urls.size === 1 ? [...urls][0] : null;
  });
}
