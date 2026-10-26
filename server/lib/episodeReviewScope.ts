export function episodeReviewScope(query: Record<string, unknown>) {
  if (query.seasonNumber === undefined && query.episodeNumber === undefined)
    return null;
  const seasonNumber = Number(query.seasonNumber),
    episodeNumber = Number(query.episodeNumber);
  if (
    query.mediaType !== 'tv' ||
    !/^\d+$/.test(String(query.seasonNumber)) ||
    !/^\d+$/.test(String(query.episodeNumber)) ||
    !Number.isSafeInteger(seasonNumber) ||
    seasonNumber < 0 ||
    !Number.isSafeInteger(episodeNumber) ||
    episodeNumber < 1
  )
    throw Error('Invalid episode');
  return { seasonNumber, episodeNumber };
}
