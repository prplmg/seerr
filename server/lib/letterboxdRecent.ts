type Identity = {
  id: number;
  tmdbId: number;
  tvdbId?: number;
  mediaType: string;
};
type Entry = {
  userId: number;
  tmdbId: number;
  mediaType: string;
  watchedDate: string | null;
  publishedAt?: string | null;
  watched: boolean;
};
// Date-only fallback. This is an ordering key, never an exact playback time.
export function datedWatchStamp(date: string | null): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date
    ? ms / 1000
    : null;
}
const meridaDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Merida',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export function letterboxdRecentStamp(entry: Pick<Entry, 'watchedDate' | 'publishedAt'>): number | null {
  const fallback = datedWatchStamp(entry.watchedDate);
  if (fallback === null) return null;
  const published = entry.publishedAt;
  // Require a timestamp with an explicit offset, not an undated or date-only row.
  if (!published || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(published)) return fallback;
  const ms = Date.parse(published);
  if (!Number.isFinite(ms)) return fallback;
  const parts = meridaDate.formatToParts(ms);
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  const day = `${part('year')}-${part('month')}-${part('day')}`;
  // RSS publication is only an approximate ordering time for a same-day diary.
  // Backdated entries retain their watched date; import/update time is never used.
  return day === entry.watchedDate ? ms / 1000 : fallback;
}
export function mergeLetterboxdRecent(
  existing: { item: Identity; stamp: number }[],
  entries: Entry[],
  media: Identity[],
  visibleUsers: Set<number>,
  hiddenUsers: number[],
  blocked: Set<string>,
  profileId?: number,
  type = 'all'
) {
  const key = (m: { mediaType: string; tmdbId: number }) =>
    `${m.mediaType}:${m.tmdbId}`;
  const found = new Map(existing.map((row) => [key(row.item), row]));
  const known = new Map(media.map((m) => [key(m), m]));
  for (const entry of entries) {
    const stamp = letterboxdRecentStamp(entry);
    if (
      !entry.watched ||
      stamp === null ||
      !Number.isSafeInteger(entry.tmdbId) ||
      entry.tmdbId < 1 ||
      !['movie', 'tv'].includes(entry.mediaType) ||
      !visibleUsers.has(entry.userId) ||
      hiddenUsers.includes(entry.userId) ||
      (profileId !== undefined && entry.userId !== profileId) ||
      (type !== 'all' && entry.mediaType !== type) ||
      blocked.has(key(entry))
    )
      continue;
    if (stamp <= (found.get(key(entry))?.stamp ?? 0)) continue;
    // Virtual negative IDs are presentation keys only; no fake Media rows are saved.
    const item = known.get(key(entry)) ?? {
      id: -(entry.tmdbId * 2 + (entry.mediaType === 'tv' ? 1 : 0)),
      tmdbId: entry.tmdbId,
      mediaType: entry.mediaType,
    };
    found.set(key(entry), { item, stamp });
  }
  return [...found.values()].sort(
    (a, b) =>
      b.stamp - a.stamp ||
      a.item.mediaType.localeCompare(b.item.mediaType) ||
      b.item.tmdbId - a.item.tmdbId
  );
}
