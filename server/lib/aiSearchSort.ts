import type { AiFilters } from './aiSearchPlan';
export type SortField = 'rating' | 'runtime' | 'year';
export type AiSort = { field: SortField; direction: 'asc' | 'desc' }[];
export function parseAiSort(value: unknown): AiSort {
  if (
    !Array.isArray(value) ||
    value.length > 2 ||
    value.some(
      (x) =>
        !x ||
        !['rating', 'runtime', 'year'].includes(x.field) ||
        !['asc', 'desc'].includes(x.direction)
    ) ||
    new Set(value.map((x) => x.field)).size !== value.length
  )
    throw Error('Invalid search sort');
  return value.map(({ field, direction }) => ({ field, direction }));
}
export function suggestAiSort(query: string, filters: AiFilters): AiSort {
  const q = query.toLowerCase();
  const explicit = q.match(
    /(?:sort(?:ed)?|order(?:ed)?)\s+(?:by\s+)?(.+)$/
  )?.[1];
  const clause = (text: string): AiSort => {
    const field: SortField | undefined = /rating|score|letterboxd|\blb\b/.test(
      text
    )
      ? 'rating'
      : /runtime|length|duration|shortest|longest/.test(text)
        ? 'runtime'
        : /year|release|newest|oldest/.test(text)
          ? 'year'
          : undefined;
    if (!field) return [];
    const direction = /ascending|lowest|shortest|oldest|low to high/.test(text)
      ? 'asc'
      : /descending|highest|longest|newest|high to low/.test(text)
        ? 'desc'
        : field === 'runtime'
          ? 'asc'
          : 'desc';
    return [{ field, direction }];
  };
  if (explicit) {
    if (/best match|relevance/.test(explicit)) return [];
    const parts = explicit.split(/,?\s+(?:then|and)\s+|,\s*/).flatMap(clause);
    if (parts.length)
      return parts
        .filter((x, i) => parts.findIndex((y) => y.field === x.field) === i)
        .slice(0, 2);
  }
  if (/highest[- ]rated|best[- ]rated|top[- ]rated/.test(q))
    return [{ field: 'rating', direction: 'desc' }];
  if (/lowest[- ]rated|worst[- ]rated/.test(q))
    return [{ field: 'rating', direction: 'asc' }];
  if (/newest|latest|\brecent\b/.test(q))
    return [{ field: 'year', direction: 'desc' }];
  if (/\bshortest\b/.test(q)) return [{ field: 'runtime', direction: 'asc' }];
  if (/\blongest\b/.test(q)) return [{ field: 'runtime', direction: 'desc' }];
  if (/\boldest\b/.test(q)) return [{ field: 'year', direction: 'asc' }];
  if (
    (filters.minLetterboxdRating != null &&
      filters.maxLetterboxdRating == null) ||
    /highly[- ]rated/.test(q)
  )
    return [{ field: 'rating', direction: 'desc' }];
  if (
    filters.maxLetterboxdRating != null &&
    filters.minLetterboxdRating == null
  )
    return [{ field: 'rating', direction: 'asc' }];
  if (/\bshort(?:est)?\b/.test(q) || filters.maxRuntime != null)
    return [{ field: 'runtime', direction: 'asc' }];
  if (/\blongest\b/.test(q)) return [{ field: 'runtime', direction: 'desc' }];
  return [];
}
export interface SortableSearchResult {
  media: { releaseDate?: string; firstAirDate?: string };
  runtime?: number | null;
  letterboxdRating?: number;
}
export function sortSearchResults<T extends SortableSearchResult>(
  rows: T[],
  sort: AiSort
): T[] {
  const value = (row: T, field: SortField) => {
    const v =
      field === 'rating'
        ? row.letterboxdRating
        : field === 'runtime'
          ? row.runtime
          : Number(
              (row.media.releaseDate || row.media.firstAirDate || '').slice(
                0,
                4
              )
            ) || null;
    return v != null && Number.isFinite(v) ? v : null;
  };
  return [...rows].sort((a, b) => {
    for (const s of sort) {
      const av = value(a, s.field),
        bv = value(b, s.field);
      if (av === null && bv === null) continue;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av !== bv) return (av - bv) * (s.direction === 'asc' ? 1 : -1);
    }
    return 0;
  });
}
export function sortLabel(sort: AiSort) {
  return sort.length
    ? sort
        .map(
          (s) =>
            `${{ rating: 'Rating', runtime: 'Runtime', year: 'Year' }[s.field]} ${s.direction === 'asc' ? '↑' : '↓'}`
        )
        .join(' · ')
    : 'Best match';
}
