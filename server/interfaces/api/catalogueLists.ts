export type MovieChoice = {
  id: number;
  title: string;
  year: string;
  poster: string | null;
};
export type EditableCatalogueList = {
  id: string;
  title: string;
  description: string;
  revision: number;
  visibility: 'public' | 'private';
  movies: MovieChoice[];
};

export function parseMovieLine(line: string) {
  const text = line.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '');
  const match = text.match(/^(.*?)\s+(?:\((\d{4})\)|(\d{4}))$/);
  return {
    title: (match ? match[1] : text).trim(),
    year: match ? match[2] || match[3] : '',
  };
}

// Only a unique exact title (and year when supplied) is selected automatically.
// Fuzzy results always require the user to choose, even if only one is returned.
export function exactMovieChoice(
  query: string,
  results: MovieChoice[],
  total: number
) {
  const parsed = parseMovieLine(query);
  const normalize = (s: string) =>
    s.normalize('NFKC').trim().toLocaleLowerCase();
  const exact = results.filter(
    (movie) =>
      normalize(movie.title) === normalize(parsed.title) &&
      (!parsed.year || movie.year === parsed.year)
  );
  return total <= results.length && exact.length === 1 ? exact[0] : undefined;
}
