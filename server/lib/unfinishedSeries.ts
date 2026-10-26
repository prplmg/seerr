import type { ListFilm } from './discoveryLists';

export type CompletedEpisode = {
  tmdbId: number;
  userId: number;
  season?: number;
  episode?: number;
  at: number;
};
export type EpisodeNumber = { season: number; episode: number };
export function validEpisode(
  e: Partial<EpisodeNumber>,
  includeSpecials = false
): e is EpisodeNumber {
  return (
    Number.isSafeInteger(e.season) &&
    Number(e.season) >= (includeSpecials ? 0 : 1) &&
    Number.isSafeInteger(e.episode) &&
    Number(e.episode) > 0
  );
}
export function unfinishedSeries(
  userId: number,
  history: CompletedEpisode[],
  latest: ReadonlyMap<number, EpisodeNumber>
): ListFilm[] {
  const watched = history.filter((e) => e.userId === userId && validEpisode(e));
  const ids = [
    ...new Set([...watched].sort((a, b) => b.at - a.at).map((e) => e.tmdbId)),
  ];
  return ids
    .filter((id) => {
      const final = latest.get(id);
      return (
        final &&
        !watched.some(
          (e) =>
            e.tmdbId === id &&
            e.season === final.season &&
            e.episode === final.episode
        )
      );
    })
    .map((tmdbId) => ({ type: 'tv', tmdbId }));
}
