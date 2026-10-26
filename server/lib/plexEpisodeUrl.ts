// Use only after the local episode has been unambiguously matched.
export function plexEpisodeUrl(
  showUrl: string | null,
  season: number,
  episode: number
): string | null {
  if (
    !showUrl ||
    !Number.isSafeInteger(season) ||
    season < 0 ||
    !Number.isSafeInteger(episode) ||
    episode < 1
  )
    return null;
  const match =
    /^https:\/\/watch\.plex\.tv\/show\/([a-z0-9-]+)(?:\?autoPlay=1)?$/i.exec(
      showUrl
    );
  return match
    ? `https://watch.plex.tv/show/${match[1]}/season/${season}/episode/${episode}?autoPlay=1`
    : null;
}
