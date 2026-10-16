import { appDataPath } from '@server/utils/appDataVolume';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

export type SessionIdentity = {
  user_id: string | number;
  rating_key: string | number;
  machine_id?: string;
  started?: number;
  watched_status?: number;
};
export type Attribution = {
  replacement?: number | null;
  added: number[];
  excluded: number[];
  completed: number[];
};
export type AttributionAction = 'claim' | 'unclaim' | 'join' | 'leave';
type Store = Record<string, Attribution>;
const file = () => path.join(appDataPath(), 'viewing-attribution.json');

// Start time comes from Tautulli's include_activity history rows, not a guessed
// observation time. This identity survives catalogue restarts and history import.
export function sessionIdentity(row: SessionIdentity): string | undefined {
  if (
    !row.machine_id ||
    !Number.isSafeInteger(Number(row.started)) ||
    Number(row.started) <= 0
  )
    return undefined;
  return createHash('sha256')
    .update(
      JSON.stringify([
        String(row.user_id),
        String(row.rating_key),
        row.machine_id,
        Number(row.started),
      ])
    )
    .digest('hex');
}
export function readAttributions(): Store {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}
export function attributedViewers(
  defaultId: number | undefined,
  entry?: Attribution
): number[] {
  const base = entry?.replacement === undefined ? defaultId : entry.replacement;
  return [
    ...new Set([...(base ? [base] : []), ...(entry?.added || [])]),
  ].filter((id) => !entry?.excluded.includes(id));
}
export function changeAttribution(
  entry: Attribution | undefined,
  action: AttributionAction,
  userId: number,
  defaultId: number | undefined,
  completed: boolean
): Attribution {
  const next: Attribution = structuredClone(
    entry || { added: [], excluded: [], completed: [] }
  );
  if (completed)
    next.completed = [
      ...new Set([...next.completed, ...attributedViewers(defaultId, next)]),
    ];
  if (action === 'claim') {
    const previous =
      next.replacement === undefined ? defaultId : next.replacement;
    next.replacement = userId;
    next.completed = next.completed.filter(
      (id) => id !== previous || next.added.includes(id)
    );
  }
  if (action === 'unclaim') {
    if (
      next.replacement === userId ||
      (next.replacement === undefined && defaultId === userId)
    )
      next.replacement = null;
    next.completed = next.completed.filter((id) => id !== userId);
  }
  if (action === 'join') next.added = [...new Set([...next.added, userId])];
  if (action === 'leave' || action === 'unclaim') {
    next.added = next.added.filter((id) => id !== userId);
    next.excluded = [...new Set([...next.excluded, userId])];
  } else next.excluded = next.excluded.filter((id) => id !== userId);
  if (completed && (action === 'claim' || action === 'join'))
    next.completed = [...new Set([...next.completed, userId])];
  return next;
}
export function saveAttribution(
  id: string,
  action: AttributionAction,
  userId: number,
  defaultId: number | undefined,
  completed: boolean
) {
  // Synchronous read/modify/atomic rename: concurrent requests cannot lose updates.
  const store = readAttributions();
  store[id] = changeAttribution(
    store[id],
    action,
    userId,
    defaultId,
    completed
  );
  fs.writeFileSync(file() + '.tmp', JSON.stringify(store));
  fs.renameSync(file() + '.tmp', file());
}
export function historyViewers(
  row: SessionIdentity,
  defaultId: number | undefined,
  store: Store
): number[] {
  const id = sessionIdentity(row),
    entry = id ? store[id] : undefined;
  return [
    ...new Set([
      ...(entry?.completed || []),
      ...(Number(row.watched_status) === 1
        ? attributedViewers(defaultId, entry)
        : []),
    ]),
  ];
}
