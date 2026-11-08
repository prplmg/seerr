export type AiFilters = {
  type: 'movie' | 'tv';
  available: boolean;
  unwatched: boolean;
  maxRuntime: number | null;
  yearFrom: number | null;
  yearTo: number | null;
  genres: number[];
  minLetterboxdRating?: number | null;
  maxLetterboxdRating?: number | null;
};
export type AiPlan = {
  filters: AiFilters;
  suggestions: { title: string; year: number; reason: string }[];
  note: string;
};
export const movieGenres = [
  28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 10770,
  53, 10752, 37,
];
export const tvGenres = [
  10759, 16, 35, 80, 99, 18, 10751, 10762, 9648, 10763, 10764, 10765, 10766,
  10767, 10768, 37,
];
const integer = (x: unknown, min: number, max: number) =>
  Number.isInteger(x) && Number(x) >= min && Number(x) <= max;
export function parseAiFilters(value: unknown): AiFilters {
  const f = value as AiFilters;
  if (
    !f ||
    !['movie', 'tv'].includes(f.type) ||
    typeof f.available !== 'boolean' ||
    typeof f.unwatched !== 'boolean' ||
    [f.minLetterboxdRating, f.maxLetterboxdRating].some(
      (score) =>
        score != null &&
        (typeof score !== 'number' ||
          !Number.isFinite(score) ||
          score < 0 ||
          score > 5)
    ) ||
    (f.minLetterboxdRating != null &&
      f.maxLetterboxdRating != null &&
      f.minLetterboxdRating > f.maxLetterboxdRating) ||
    !Array.isArray(f.genres) ||
    f.genres.length > 3 ||
    f.genres.some(
      (g) => !(f.type === 'movie' ? movieGenres : tvGenres).includes(g)
    ) ||
    (f.maxRuntime !== null && !integer(f.maxRuntime, 1, 600)) ||
    [f.yearFrom, f.yearTo].some((y) => y !== null && !integer(y, 1870, 2100)) ||
    (f.yearFrom !== null && f.yearTo !== null && f.yearFrom > f.yearTo)
  )
    throw Error('Invalid search filters');
  return {
    type: f.type,
    available: f.available,
    unwatched: f.unwatched,
    maxRuntime: f.maxRuntime,
    yearFrom: f.yearFrom,
    yearTo: f.yearTo,
    genres: [...new Set(f.genres)],
    ...(f.maxLetterboxdRating !== undefined
      ? { maxLetterboxdRating: f.maxLetterboxdRating }
      : {}),
    ...(f.minLetterboxdRating !== undefined
      ? { minLetterboxdRating: f.minLetterboxdRating }
      : {}),
  };
}
export function parseAiPlan(value: unknown): AiPlan {
  const p = value as AiPlan;
  const filters = parseAiFilters(p?.filters);
  if (
    !Array.isArray(p.suggestions) ||
    p.suggestions.length > 16 ||
    typeof p.note !== 'string' ||
    p.note.length > 300
  )
    throw Error('Invalid search plan');
  const suggestions = p.suggestions.map((s) => {
    if (
      !s ||
      typeof s.title !== 'string' ||
      !s.title.trim() ||
      s.title.length > 160 ||
      !integer(s.year, 1870, 2100) ||
      typeof s.reason !== 'string' ||
      s.reason.length > 140 ||
      s.reason.trim().split(/\s+/).length > 10
    )
      throw Error('Invalid search suggestion');
    return { title: s.title.trim(), year: s.year, reason: s.reason.trim() };
  });
  return { filters, suggestions, note: p.note };
}
export function matchesAiFilters(
  f: AiFilters,
  item: {
    available: boolean;
    watched: boolean;
    runtime: number | null;
    year: number;
    genres: number[];
  }
): boolean {
  return (
    (!f.available || item.available) &&
    (!f.unwatched || !item.watched) &&
    (f.maxRuntime === null ||
      (item.runtime !== null &&
        item.runtime > 0 &&
        item.runtime <= f.maxRuntime)) &&
    (f.yearFrom === null || item.year >= f.yearFrom) &&
    (f.yearTo === null || item.year <= f.yearTo) &&
    f.genres.every((g) => item.genres.includes(g))
  );
}
export function normalizedTitle(title: string) {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function letterboxdFilterLabel(filters: AiFilters): string {
  const { minLetterboxdRating: min, maxLetterboxdRating: max } = filters;
  if (min != null && max != null) return `LB ${min}–${max} ★`;
  if (min != null) return `LB ≥ ${min} ★`;
  if (max != null) return `LB ≤ ${max} ★`;
  return 'Any LB rating';
}
