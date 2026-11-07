import { appDataPath } from '@server/utils/appDataVolume';
import { createHash, randomUUID } from 'crypto';
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
  inheritedFrom?: string;
  continuityBlocked?: true;
};
export type AttributionAction = 'claim' | 'unclaim' | 'join' | 'leave';
export function canAssignViewer(
  isAdmin: boolean,
  action: string,
  target: unknown
): boolean {
  return (
    isAdmin &&
    action === 'join' &&
    typeof target === 'number' &&
    Number.isSafeInteger(target) &&
    target > 0
  );
}
export type AttributionStore = Record<string, Attribution>;
type Store = AttributionStore;
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
export function isPlaybackViewer(
  userId: number,
  defaultId: number | undefined,
  entry?: Attribution
): boolean {
  const base = entry?.replacement === undefined ? defaultId : entry.replacement;
  return base === userId && !entry?.excluded.includes(userId);
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
  // Any explicit action makes the destination authoritative, even an empty leave.
  delete next.inheritedFrom;
  delete next.continuityBlocked;
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
  writeAttributions(store);
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

// Only feed unfiltered chronological-source snapshots into reconciliation.
// Filtered title/movie history cannot prove the absence of intervening playback.
export type ContinuityRow = {
  user_id?: unknown;
  rating_key?: unknown;
  machine_id?: unknown;
  started?: unknown;
  stopped?: unknown;
  media_type?: unknown;
  grandparent_rating_key?: unknown;
  parent_media_index?: unknown;
  media_index?: unknown;
};
const keyPart = (value: unknown): string | undefined =>
  (typeof value === 'string' || typeof value === 'number') &&
  String(value).trim() &&
  !['undefined', 'null', 'NaN'].includes(String(value))
    ? String(value)
    : undefined;
const positiveInteger = (value: unknown) =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  Number.isSafeInteger(Number(value)) &&
  Number(value) > 0;
function continues(previous: ContinuityRow, current: ContinuityRow) {
  if (
    keyPart(previous.user_id) !== keyPart(current.user_id) ||
    !positiveInteger(previous.stopped) ||
    !positiveInteger(previous.started) ||
    !positiveInteger(current.started) ||
    Number(previous.stopped) < Number(previous.started)
  )
    return false;
  const gap = Number(current.started) - Number(previous.stopped);
  if (gap < 0 || gap > 1200 || previous.media_type !== current.media_type)
    return false;
  const from = keyPart(previous.rating_key),
    to = keyPart(current.rating_key);
  if (!from || !to) return false;
  if (current.media_type === 'movie') return from === to;
  const validSeason = (value: unknown) =>
    value === 0 || value === '0' || positiveInteger(value);
  // Next PLAYED episode, including selections and season boundaries. Identity
  // comes from the Plex series key and explicit episode metadata, never titles.
  return (
    current.media_type === 'episode' &&
    !!keyPart(previous.grandparent_rating_key) &&
    keyPart(previous.grandparent_rating_key) ===
      keyPart(current.grandparent_rating_key) &&
    validSeason(previous.parent_media_index) &&
    validSeason(current.parent_media_index) &&
    positiveInteger(previous.media_index) &&
    positiveInteger(current.media_index)
  );
}

/** Pure chronological pass. Legacy/explicit entries win; inherited entries alone
 * may be refreshed. Every raw row is a barrier, including unsupported media. */
export function reconcileViewingAttributions(
  store: Store,
  rows: readonly ContinuityRow[]
): Store {
  let result = store;
  let unsafeAll = false;
  const unsafeAccounts = new Set<string>(),
    unsafeDevices = new Set<string>();
  type Event = {
    row: ContinuityRow;
    account?: string;
    device?: string;
    id?: string;
    start: number;
  };
  const events: Event[] = [];
  for (const value of rows) {
    const row = value && typeof value === 'object' ? value : {};
    const account = keyPart(row.user_id),
      device = keyPart(row.machine_id);
    if (!positiveInteger(row.started)) {
      // Without a start we cannot place a barrier. Do not fabricate one from
      // dates/durations; only this genuinely unplaceable evidence poisons scope.
      if (device) unsafeDevices.add(device);
      else if (account) unsafeAccounts.add(account);
      else unsafeAll = true;
      continue;
    }
    const rating = keyPart(row.rating_key);
    events.push({
      row,
      account,
      device,
      start: Number(row.started),
      id:
        account && device && rating
          ? sessionIdentity({
              user_id: account,
              machine_id: device,
              rating_key: rating,
              started: Number(row.started),
            })
          : undefined,
    });
  }
  events.sort((a, b) => a.start - b.start);
  const signatures = new Map<string, string>(),
    ambiguous = new Set<string>();
  for (const event of events) {
    if (!event.device) continue;
    const key = JSON.stringify([event.device, event.start]);
    const signature = JSON.stringify([
      event.account,
      event.row.rating_key,
      event.row.media_type,
      event.row.grandparent_rating_key,
      event.row.parent_media_index,
      event.row.media_index,
      event.row.stopped,
    ]);
    if (signatures.has(key) && signatures.get(key) !== signature)
      ambiguous.add(key);
    signatures.set(key, signature);
  }
  const present = new Set(events.map((e) => e.id).filter(Boolean));
  const previous = new Map<string, Event>();
  const candidates = new Map<string, Event>();
  const accountBarriers = new Map<string, number>();
  let globalBarrier = -Infinity;
  const family = (e: Event) => {
    const media =
      e.row.media_type === 'episode'
        ? keyPart(e.row.grandparent_rating_key)
        : e.row.media_type === 'movie'
          ? keyPart(e.row.rating_key)
          : undefined;
    return e.device && e.account && media
      ? JSON.stringify([e.device, e.account, e.row.media_type, media])
      : undefined;
  };
  const hasIntent = (entry?: Attribution) =>
    entry &&
    !entry.continuityBlocked &&
    (entry.replacement !== undefined ||
      entry.added.length > 0 ||
      entry.excluded.length > 0);
  const block = (id: string) => {
    if (result === store) result = { ...store };
    result[id] = {
      added: [],
      excluded: [],
      completed: [],
      continuityBlocked: true,
    };
  };
  for (const event of events) {
    if (!event.device) {
      if (event.account) accountBarriers.set(event.account, event.start);
      else globalBarrier = event.start;
      continue;
    }
    const prior = previous.get(event.device);
    if (
      prior?.id &&
      prior.id === event.id &&
      !ambiguous.has(JSON.stringify([event.device, event.start]))
    )
      continue;
    previous.set(event.device, event);
    if (!event.id) continue;
    const destination = result[event.id];
    const familyKey = family(event);
    const candidate = familyKey ? candidates.get(familyKey) : undefined;
    const unsafe =
      unsafeAll ||
      unsafeDevices.has(event.device) ||
      unsafeAccounts.has(event.account!);
    const isAmbiguous =
      ambiguous.has(JSON.stringify([event.device, event.start])) ||
      (prior && ambiguous.has(JSON.stringify([prior.device, prior.start])));
    const barrier = Math.max(
      globalBarrier,
      accountBarriers.get(event.account!) ?? -Infinity
    );
    if (!destination || destination.inheritedFrom) {
      const source = prior?.id ? result[prior.id] : undefined;
      if (
        !unsafe &&
        !isAmbiguous &&
        prior?.id &&
        source &&
        !source.continuityBlocked &&
        barrier < prior.start &&
        continues(prior.row, event.row)
      ) {
        const next: Attribution = {
          ...(source.replacement === undefined
            ? {}
            : { replacement: source.replacement }),
          added: [...source.added],
          excluded: [...source.excluded],
          completed: [],
          inheritedFrom: prior.id,
        };
        if (JSON.stringify(destination) !== JSON.stringify(next)) {
          if (result === store) result = { ...store };
          result[event.id] = next;
        }
      } else if (
        (destination?.inheritedFrom &&
          (unsafe || present.has(destination.inheritedFrom))) ||
        (candidate && continues(candidate.row, event.row))
      ) {
        // Record negative evidence only near a real attributed candidate. An
        // older cached subset cannot later bridge the barrier we observed here.
        block(event.id);
      }
    }
    if (familyKey && hasIntent(result[event.id]))
      candidates.set(familyKey, event);
  }
  return result;
}

function writeAttributions(store: Store) {
  const temporary = `${file()}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(store), {
      mode: 0o600,
      flag: 'wx',
    });
    fs.renameSync(temporary, file());
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
// Weak keys retain no old snapshots; atomic rename/stat changes invalidate cached
// decisions after explicit actions or another process updates the attribution file.
const reconciledSnapshots = new WeakMap<
  readonly ContinuityRow[],
  { stamp: string; store: Store }
>();
function attributionStamp() {
  try {
    const stat = fs.statSync(file(), { bigint: true });
    return `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  } catch (error) {
    if (error.code === 'ENOENT') return 'absent';
    throw error;
  }
}
export function reconcileAttributions(rows: readonly ContinuityRow[]): Store {
  const stamp = attributionStamp();
  const cached = reconciledSnapshots.get(rows);
  if (cached?.stamp === stamp) return cached.store;
  // No await between reading current explicit assignments and atomic replacement.
  const previous = readAttributions();
  const next = reconcileViewingAttributions(previous, rows);
  if (next !== previous) writeAttributions(next);
  reconciledSnapshots.set(rows, { stamp: attributionStamp(), store: next });
  return next;
}
