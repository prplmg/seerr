import { appDataPath } from '@server/utils/appDataVolume';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { letterboxdEntryIdentity } from './letterboxdImport';

export type WriteKind = 'watchlist' | 'rating' | 'review' | 'watched' | 'diary';
export type WriteIntent = {
  id: string;
  userId: number;
  account: string;
  originId: string;
  kind: WriteKind;
  film: string;
  entryId?: string;
  createNew?: boolean;
  previousEntryId?: string;
  originEntityId?: string;
  expected: Record<string, unknown>;
  desired: Record<string, unknown>;
  created: number;
  verifiedAt?: number;
  recovery?: {
    observationId: string;
    requestedAt: number;
    status: 'checking' | 'mismatch' | 'unavailable' | 'verified';
    differingFields?: string[];
  };
  state:
    | 'queued'
    | 'dispatched'
    | 'verified'
    | 'conflict'
    | 'unknown'
    | 'cancelled';
};
export type WriteState = {
  version: 1;
  settledReviews?: Record<string, string>;
  preparationFailures?: {
    id: string;
    userId: number;
    account: string;
    phase: string;
    state: 'unknown';
    firstFailedAt?: number;
    attempts?: number;
  }[];
  settings: Record<
    string,
    { account: string; enabled: boolean; enabledSince?: number }
  >;
  intents: WriteIntent[];
};
// Operational failures are separate from write intents: they alert the admin,
// but can never be claimed as writes or trigger an automatic write retry.
export function setPreparationFailure(
  state: WriteState,
  userId: number,
  account: string,
  phase: string,
  failed: boolean,
  now = Date.now()
) {
  const id = `preparation:${userId}:${account}:${phase}`;
  const previous = state.preparationFailures?.find(i => i.id === id);
  state.preparationFailures = (state.preparationFailures || []).filter(
    (i) => i.id !== id
  );
  if (failed)
    state.preparationFailures.push({
      id,
      userId,
      account,
      phase,
      state: 'unknown',
      firstFailedAt: previous?.firstFailedAt ?? now,
      attempts: (previous?.attempts ?? 0) + 1,
    });
}
export const emptyWriteState = (): WriteState => ({
  version: 1,
  settings: {},
  intents: [],
});
export function setWriteEnabled(
  state: WriteState,
  userId: number,
  account: string,
  enabled: boolean
) {
  if (
    !Number.isSafeInteger(userId) ||
    userId < 1 ||
    !/^[a-z0-9_]{1,40}$/i.test(account) ||
    typeof enabled !== 'boolean'
  )
    throw Error('Invalid write setting');
  account = account.toLowerCase();
  if (
    enabled &&
    Object.entries(state.settings).some(
      ([id, setting]) =>
        Number(id) !== userId && setting.account === account && setting.enabled
    )
  )
    throw Error(
      'Letterboxd publishing account already assigned to another user'
    );
  const old = state.settings[userId];
  if (
    old &&
    old.account !== account &&
    state.intents.some(
      (i) =>
        i.userId === userId &&
        ['queued', 'dispatched', 'unknown'].includes(i.state)
    )
  )
    throw Error('Resolve previous account work before remapping');
  state.settings[userId] = {
    account,
    enabled,
    enabledSince: enabled
      ? old?.enabled && old.account === account
        ? (old.enabledSince ?? Date.now())
        : Date.now()
      : old?.enabledSince,
  };
  if (!enabled)
    for (const job of state.intents)
      if (job.userId === userId && job.state === 'queued')
        job.state = 'cancelled';
}
export function enqueueWrite(
  state: WriteState,
  input: Omit<WriteIntent, 'id' | 'created' | 'state'>,
  source: 'local' | 'letterboxd',
  now: number
) {
  if (source !== 'local')
    throw Error('Imported entries cannot create outbound writes');
  // Product boundary: the catalogue bookmark belongs to Plex. This cannot be
  // enabled by the general per-user publishing switch.
  if (input.kind === 'watchlist')
    throw Error('Letterboxd watchlist publishing is disabled');
  if (
    input.entryId &&
    (letterboxdEntryIdentity(input.entryId) !== input.entryId ||
      new URL(input.entryId).pathname.split('/')[1] !== input.account ||
      new URL(input.entryId).pathname.split('/')[3] !== input.film)
  )
    throw Error('Invalid remote entry identity');
  const setting = state.settings[input.userId];
  if (!setting?.enabled || setting.account !== input.account)
    throw Error('Writes disabled');
  if (
    !/^[a-z0-9-]{1,200}$/.test(input.film) ||
    !input.originId ||
    input.originId.length > 300 ||
    !['watchlist', 'rating', 'review', 'watched', 'diary'].includes(input.kind)
  )
    throw Error('Invalid write identity');
  const fields: Record<WriteKind, string[]> = {
    watchlist: ['member'],
    rating: ['rating'],
    review: ['rating', 'text', 'spoiler'],
    watched: ['watched'],
    diary: ['watchedDate', 'rewatch'],
  };
  if (input.kind === 'diary' && 'rating' in input.desired)
    fields.diary = ['watchedDate', 'rewatch', 'rating', 'text', 'spoiler'];
  if (
    input.createNew !== undefined &&
    (input.createNew !== true ||
      input.kind !== 'review' ||
      input.entryId ||
      !input.desired.text)
  )
    throw Error('Invalid new review request');
  if (
    input.previousEntryId &&
    (!input.createNew ||
      letterboxdEntryIdentity(input.previousEntryId) !==
        input.previousEntryId ||
      (new URL(input.previousEntryId).pathname !==
        `/${input.account}/film/${input.film}/` &&
        !new URL(input.previousEntryId).pathname.startsWith(
          `/${input.account}/film/${input.film}/`
        )))
  )
    throw Error('Invalid prior entry');
  for (const values of [input.expected, input.desired]) {
    if (
      !values ||
      Object.keys(values).sort().join(',') !==
        [...fields[input.kind]].sort().join(',')
    )
      throw Error('Incomplete write precondition');
    for (const [key, value] of Object.entries(values)) {
      if (
        ['member', 'spoiler', 'watched', 'rewatch'].includes(key) &&
        typeof value !== 'boolean'
      )
        throw Error('Invalid boolean');
      if (
        key === 'rating' &&
        value !== null &&
        (typeof value !== 'number' ||
          value < 0.5 ||
          value > 5 ||
          value * 2 !== Math.round(value * 2))
      )
        throw Error('Invalid rating');
      if (key === 'text' && (typeof value !== 'string' || value.length > 50000))
        throw Error('Invalid review');
      if (
        key === 'watchedDate' &&
        !(values === input.expected && value === null) &&
        (typeof value !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value)
      )
        throw Error('Diary requires real date');
    }
  }
  const existing = state.intents.find(
    (i) => i.userId === input.userId && i.originId === input.originId
  );
  if (existing) {
    for (const key of [
      'account',
      'kind',
      'film',
      'expected',
      'desired',
      'entryId',
      'createNew',
      'previousEntryId',
      'originEntityId',
    ] as const)
      if (JSON.stringify(existing[key]) !== JSON.stringify(input[key]))
        throw Error('Idempotency key reused for a different change');
    return existing;
  }
  const job: WriteIntent = {
    ...input,
    expected: { ...input.expected },
    desired: { ...input.desired },
    id: randomUUID(),
    created: now,
    state: 'queued',
  };
  state.intents.push(job);
  return job;
}
export function claimWrite(
  state: WriteState,
  userId: number,
  account: string,
  supported: (WriteKind | 'diary-content')[] = []
) {
  const setting = state.settings[userId];
  if (!setting?.enabled || setting.account !== account) return null;
  // Uncertain remote writes require reconciliation, not another dispatch.
  if (
    state.intents.some(
      (i) =>
        i.userId === userId &&
        ['dispatched', 'unknown', 'conflict'].includes(i.state)
    )
  )
    return null;
  const job = state.intents.find(
    (i) =>
      i.userId === userId &&
      i.account === account &&
      i.state === 'queued' &&
      i.kind !== 'watchlist' &&
      supported.includes(i.kind)
      && !(i.kind === 'diary' && 'rating' in i.desired && !supported.includes('diary-content'))
  );
  if (job) job.state = 'dispatched';
  return job || null;
}
export function finishWrite(
  state: WriteState,
  userId: number,
  account: string,
  report: {
    id: string;
    outcome: 'verified' | 'conflict' | 'unknown';
    identity?: string;
    values?: Record<string, unknown>;
    entryId?: string;
  }
) {
  const job = state.intents.find(
    (i) => i.id === report.id && i.userId === userId && i.account === account
  );
  if (!job) throw Error('Unknown write report');
  if (!['verified', 'conflict', 'unknown'].includes(report.outcome))
    throw Error('Invalid write result');
  if (
    report.outcome === 'verified' &&
    (report.identity !== account ||
      JSON.stringify(Object.entries(report.values || {}).sort()) !==
        JSON.stringify(Object.entries(job.desired).sort()))
  )
    throw Error('Write not verified');
  if (report.outcome === 'verified' && ['review', 'diary'].includes(job.kind)) {
    const entry = report.entryId && letterboxdEntryIdentity(report.entryId);
    if (
      !entry ||
      entry !== report.entryId ||
      new URL(entry).pathname.split('/')[1] !== account ||
      new URL(entry).pathname.split('/')[3] !== job.film ||
      (job.entryId && job.entryId !== entry) ||
      (job.createNew && job.previousEntryId === entry)
    )
      throw Error('Remote entry identity not verified');
  }
  // Delayed durable verification may follow a transport watchdog report.
  // The same identity/value/exact-entry checks above apply; never re-dispatch.
  const lateVerification =
    job.state === 'unknown' && report.outcome === 'verified';
  if (
    ['verified', 'conflict', 'unknown'].includes(job.state) &&
    !lateVerification
  ) {
    if (job.state !== report.outcome) throw Error('Conflicting write report');
    return false;
  }
  if (job.state !== 'dispatched' && !lateVerification)
    throw Error('Write not dispatched');
  job.state = report.outcome;
  if (report.outcome === 'verified') job.verifiedAt = Date.now();
  if (report.outcome === 'verified' && report.entryId)
    job.entryId = report.entryId;
  return true;
}
const filename = () => path.join(appDataPath(), 'letterboxd-write-queue.json');
export function readWriteState(): WriteState {
  try {
    const state = JSON.parse(fs.readFileSync(filename(), 'utf8'));
    if (state.version !== 1 || !state.settings || !Array.isArray(state.intents))
      throw Error('Invalid write store');
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return emptyWriteState();
    throw error;
  }
}
export function updateWriteState<T>(change: (state: WriteState) => T): T {
  const state = readWriteState(),
    result = change(state),
    file = filename(),
    temp = file + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
  try {
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return result;
}
