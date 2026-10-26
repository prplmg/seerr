export type EpisodeProgress = {
  season: number;
  episode: number;
  stamp: number;
};
export function latestEpisode(
  previous: EpisodeProgress | undefined,
  row: {
    season?: number;
    episode?: number;
    stamp: number;
    watched_status?: number;
  }
): EpisodeProgress | undefined {
  if (
    row.watched_status !== 1 ||
    !Number.isSafeInteger(row.season) ||
    row.season! < 0 ||
    !Number.isSafeInteger(row.episode) ||
    row.episode! < 1 ||
    !Number.isFinite(row.stamp) ||
    row.stamp <= (previous?.stamp || 0)
  )
    return previous;
  return { season: row.season!, episode: row.episode!, stamp: row.stamp };
}
