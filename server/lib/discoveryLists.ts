import { appDataPath } from '@server/utils/appDataVolume';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { curatedLists } from './curatedLists';
import type { ForYouRow } from './forYouLayout';

export type ListFilm = { type: 'movie' | 'tv'; tmdbId: number; note?: string };
export type UnmatchedListFilm = {
  url: string;
  title: string;
  year: string;
  note: string;
  position: number;
};
export type DiscoveryList = {
  id: string;
  title: string;
  description: string;
  creator: string;
  source: 'curated' | 'letterboxd' | 'catalogue';
  url?: string;
  ownerId?: number;
  visibility: 'public' | 'private' | 'unknown';
  checkedAt: number;
  unavailable?: boolean;
  deletedAt?: number;
  items: ListFilm[];
  unmatched?: UnmatchedListFilm[];
  history: { at: number; items: ListFilm[] }[];
};
export type ListStore = {
  version: 1;
  lists: DiscoveryList[];
  saved: Record<string, string[]>;
  liked: Record<string, string[]>;
  availability: Record<string, { available: boolean; since: number }>;
  refreshCursor?: number;
  exportTimes?: Record<string, number>;
  forYouLayouts?: Record<string, ForYouRow[]>;
};
export const filmKey = (f: ListFilm) => `${f.type}:${f.tmdbId}`;
export const listId = (url: string) =>
  'lb-' + createHash('sha256').update(url).digest('hex').slice(0, 32);
export function discoveryEnabled(userId: number) {
  return Number.isSafeInteger(userId) && userId > 0;
}
export function visibleList(
  list: DiscoveryList,
  userId: number,
  now = Date.now()
) {
  return (
    !list.unavailable &&
    !list.deletedAt &&
    (list.ownerId === userId ||
      (list.visibility === 'public' &&
        (list.source === 'curated' ||
          list.source === 'catalogue' ||
          now - list.checkedAt < 24 * 60 * 60 * 1000)))
  );
}
export function cleanFilms(items: ListFilm[]) {
  if (!Array.isArray(items) || items.length > 10000)
    throw Error('List too large');
  const seen = new Set<string>();
  return items
    .filter((f) => {
      if (
        !['movie', 'tv'].includes(f.type) ||
        !Number.isSafeInteger(f.tmdbId) ||
        f.tmdbId < 1
      )
        throw Error('Invalid list film');
      const key = filmKey(f);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((f) => ({
      type: f.type,
      tmdbId: f.tmdbId,
      ...(f.note ? { note: f.note.slice(0, 20000) } : {}),
    }));
}
export function replaceList(
  store: ListStore,
  next: DiscoveryList,
  now: number
) {
  if (!Number.isFinite(now) || now <= 0)
    throw Error('Invalid list snapshot time');
  next.checkedAt = now;
  next.items = cleanFilms(next.items);
  const old = store.lists.find((l) => l.id === next.id);
  if (old && now < old.checkedAt) return;
  const changed =
    !old ||
    JSON.stringify(old.items.map(filmKey)) !==
      JSON.stringify(next.items.map(filmKey));
  const history = old?.history || [];
  next.history = changed
    ? [
        ...history,
        {
          at: now,
          items: next.items.map(({ type, tmdbId }) => ({ type, tmdbId })),
        },
      ].slice(-60)
    : history;
  const index = store.lists.findIndex((l) => l.id === next.id);
  if (index < 0) {
    if (store.lists.length >= 2000) throw Error('List capacity reached');
    store.lists.push(next);
  } else store.lists[index] = next;
}
const filename = () => path.join(appDataPath(), 'discovery-lists.json');
export function readListStore(): ListStore {
  try {
    const s = JSON.parse(fs.readFileSync(filename(), 'utf8'));
    if (
      s.version !== 1 ||
      !Array.isArray(s.lists) ||
      !s.saved ||
      !s.liked ||
      !s.availability
    )
      throw Error('Invalid list store');
    return s;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return { version: 1, lists: [], saved: {}, liked: {}, availability: {} };
  }
}
export function updateListStore<T>(change: (store: ListStore) => T): T {
  const store = readListStore(),
    before = JSON.stringify(store),
    result = change(store),
    file = filename(),
    temp = file + '.' + randomUUID() + '.tmp';
  const serialized = JSON.stringify(store);
  if (serialized === before) return result;
  if (Buffer.byteLength(serialized) > 32 * 1024 * 1024)
    throw Error('Discovery store capacity reached');
  try {
    fs.writeFileSync(temp, serialized, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return result;
}
export function allLists(store: ListStore): DiscoveryList[] {
  return [
    ...curatedLists.map((l) => ({
      id: 'curated-' + l.id,
      title: l.title.en,
      description: l.description.en,
      creator: 'Multimeldia',
      source: 'curated' as const,
      visibility: 'public' as const,
      checkedAt: 0,
      items: l.items,
      history: [],
    })),
    ...store.lists,
  ];
}
export function setListSaved(
  store: ListStore,
  userId: number,
  id: string,
  saved: boolean,
  now = Date.now()
) {
  const list = allLists(store).find((l) => l.id === id);
  // Removing an unavailable bookmark must remain possible.
  if (saved && (!list || !visibleList(list, userId, now)))
    throw Error('List unavailable');
  const next = new Set(store.saved[userId] || []);
  if (saved) next.add(id);
  else next.delete(id);
  if (next.size > 200) throw Error('Saved list limit reached');
  store.saved[userId] = [...next];
}
