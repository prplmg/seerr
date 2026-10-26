import { randomUUID } from 'crypto';
import type { ListStore } from './discoveryLists';
import { replaceList } from './discoveryLists';

export class CatalogueListError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
export function ownedCatalogueList(
  store: ListStore,
  userId: number,
  id: string
) {
  const list = store.lists.find((list) => list.id === id);
  if (
    !list ||
    list.deletedAt ||
    list.ownerId !== userId ||
    list.source !== 'catalogue'
  )
    throw new CatalogueListError(404, 'Editable list not found.');
  return list;
}
export function validateCatalogueList(body: unknown) {
  const value = body as {
    title?: unknown;
    description?: unknown;
    movieIds?: unknown;
    revision?: unknown;
    visibility?: unknown;
  } | null;
  if (
    !value ||
    (value.visibility !== undefined &&
      !['public', 'private'].includes(value.visibility as string)) ||
    typeof value.title !== 'string' ||
    !value.title.trim() ||
    value.title.length > 200 ||
    typeof value.description !== 'string' ||
    value.description.length > 5000 ||
    !Array.isArray(value.movieIds) ||
    !value.movieIds.length ||
    value.movieIds.length > 200 ||
    value.movieIds.some((id) => !Number.isSafeInteger(id) || id < 1) ||
    new Set(value.movieIds).size !== value.movieIds.length
  )
    throw new CatalogueListError(400, 'Use a name and 1–200 distinct movies.');
  return {
    title: value.title.trim(),
    description: value.description.trim(),
    movieIds: value.movieIds as number[],
    revision: value.revision,
    visibility: value.visibility as 'public' | 'private' | undefined,
  };
}
export function saveCatalogueList(
  store: ListStore,
  userId: number,
  creator: string,
  body: unknown,
  id?: string,
  now = Date.now()
) {
  const value = validateCatalogueList(body);
  const old = id ? ownedCatalogueList(store, userId, id) : undefined;
  if (old && value.revision !== old.checkedAt)
    throw new CatalogueListError(
      409,
      'This list changed in another tab. Reopen it before saving.'
    );
  if (
    !old &&
    store.lists.filter(
      (l) => !l.deletedAt && l.source === 'catalogue' && l.ownerId === userId
    ).length >= 200
  )
    throw new CatalogueListError(
      409,
      'You have reached the limit of 200 created lists.'
    );
  const list = {
    id: old?.id || 'catalogue-' + randomUUID(),
    title: value.title,
    description: value.description,
    creator,
    source: 'catalogue' as const,
    ownerId: userId,
    visibility:
      value.visibility ??
      (old?.visibility === 'private'
        ? ('private' as const)
        : ('public' as const)),
    checkedAt: Math.max(now, (old?.checkedAt || 0) + 1),
    items: value.movieIds.map((tmdbId) => ({ type: 'movie' as const, tmdbId })),
    history: old?.history || [],
  };
  replaceList(store, list, list.checkedAt);
  return list;
}

export function deleteCatalogueList(
  store: ListStore,
  userId: number,
  id: string,
  revision: unknown,
  now = Date.now()
) {
  const list = ownedCatalogueList(store, userId, id);
  if (revision !== list.checkedAt)
    throw new CatalogueListError(
      409,
      'This list changed in another tab. Reopen it before deleting.'
    );
  // Recoverable tombstone: retain contents/history, remove public access and bookmarks.
  list.deletedAt = now;
  list.checkedAt = Math.max(now, list.checkedAt + 1);
  for (const user of Object.keys(store.saved))
    store.saved[user] = store.saved[user].filter((saved) => saved !== id);
}
