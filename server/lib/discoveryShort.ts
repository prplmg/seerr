// Cursor is the candidate position, not the number of matches. An empty page
// with a continuation must not hide suitable films further down the ranking.
export async function shortWatchPage<T>(
  candidates: T[],
  offset: number,
  maximum: number,
  runtime: (item: T) => Promise<number | null | undefined>,
  decorate?: (item: T, minutes: number) => T
) {
  const results: T[] = [];
  let cursor = offset;
  while (
    cursor < candidates.length &&
    cursor < offset + 60 &&
    results.length < 20
  ) {
    const item = candidates[cursor++];
    const minutes = await runtime(item);
    if (minutes && minutes <= maximum)
      results.push(decorate ? decorate(item, minutes) : item);
  }
  return { results, next: cursor < candidates.length ? cursor : null };
}
