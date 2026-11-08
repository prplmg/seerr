// Keep drafts/results only for this tab's mounted document and history entry.
// Fresh links get a new entry; Back (including router.back) gets its old one.
const screens = new Map<string, unknown>();
export function searchEntry(history: History): string {
  // Next preserves this key when revisiting an entry with router.back().
  const existing = history.state?.key ?? history.state?.aiSearchEntry;
  if (typeof existing === 'string') return existing;
  const entry = crypto.randomUUID();
  history.replaceState({ ...history.state, aiSearchEntry: entry }, '');
  return entry;
}
export function readSearchScreen<T>(
  userId: number,
  entry: string
): T | undefined {
  return screens.get(`${userId}:${entry}`) as T | undefined;
}
export function saveSearchScreen<T>(userId: number, entry: string, screen: T) {
  const key = `${userId}:${entry}`;
  screens.delete(key);
  screens.set(key, screen);
  // Navigation convenience, not the persistent seven-day search history.
  if (screens.size > 50) screens.delete(screens.keys().next().value!);
}
