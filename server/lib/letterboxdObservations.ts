import { appDataPath } from '@server/utils/appDataVolume';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { letterboxdEntryIdentity } from './letterboxdImport';
import type { ReviewFields } from './letterboxdReconcile';

export type ObservationScope = {
  userId: number;
  account: string;
  film: string;
  entryId?: string;
  createNew?: boolean;
};
export type ReviewObservation = ReviewFields & {
  entryId?: string;
  observedAt: number;
  // Optional for older workers. Never default unknown evidence to false/empty.
  watched?: boolean;
  // Film-wide dated diary inventory, not merely reviews or one date/page.
  // True requires authenticated account/film identity, all pages exhausted,
  // and every dated entry resolved to its canonical entry URL.
  diaryEntriesComplete?: boolean;
  diaryEntryIds?: string[];
  // Optional complete date mapping for the enumerated IDs. Dates are read from
  // each dated diary entry, never publication timestamps or inferred from order.
  diaryEntryDates?: Record<string, string>;
};
export type ObservationRequest = ObservationScope & {
  id: string;
  requestedAt: number;
  state: 'queued' | 'claimed' | 'verified' | 'unknown' | 'ambiguous';
  claimToken?: string;
  claimedAt?: number;
  observation?: ReviewObservation;
  retryOf?: string;
  supersededBy?: string;
};
export type ObservationState = { version: 1; requests: ObservationRequest[] };
const MAX_AGE = 5 * 60 * 1000;
function validateScope(s: ObservationScope) {
  if (s.createNew !== undefined && (s.createNew !== true || s.entryId))
    throw Error('Invalid new-review observation');
  if (
    !Number.isSafeInteger(s.userId) ||
    s.userId < 1 ||
    typeof s.account !== 'string' ||
    !/^[a-z0-9_]{1,40}$/.test(s.account) ||
    typeof s.film !== 'string' ||
    s.film.length > 200 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.film)
  )
    throw Error('Invalid observation scope');
  if (
    s.entryId !== undefined &&
    (letterboxdEntryIdentity(s.entryId) !== s.entryId ||
      new URL(s.entryId).pathname.split('/')[1] !== s.account ||
      new URL(s.entryId).pathname.split('/')[3] !== s.film)
  )
    throw Error('Invalid observation entry identity');
}
const sameScope = (a: ObservationScope, b: ObservationScope) =>
  a.userId === b.userId &&
  a.account === b.account &&
  a.film === b.film &&
  a.entryId === b.entryId &&
  a.createNew === b.createNew;
// Retry a failed read once, never a write. Preserve original evidence and tokens.
// A different entry or create-new read cannot retire this scope.
export function maintainObservationHealth(state: ObservationState, now = Date.now()) {
  for (const request of [...state.requests]) {
    if (request.supersededBy || !['claimed', 'unknown', 'ambiguous'].includes(request.state)) continue;
    const newer = state.requests.filter(r => sameScope(r, request) && r.requestedAt > request.requestedAt);
    const verified = newer.find(r => r.state === 'verified' && r.observation);
    if (verified) { request.supersededBy = verified.id; continue; }
    if (newer.length || request.retryOf || now-request.requestedAt < 15*60*1000) continue;
    const retry = requestObservation(state, {
      userId: request.userId, account: request.account, film: request.film,
      ...(request.entryId ? {entryId: request.entryId} : {}),
      ...(request.createNew ? {createNew: true} : {}),
    }, now);
    if (retry.id !== request.id) retry.retryOf = request.id;
  }
}
export function requestObservation(
  state: ObservationState,
  scope: ObservationScope,
  now = Date.now()
) {
  validateScope(scope);
  const existing = state.requests.find(
    (r) =>
      sameScope(r, scope) &&
      (r.state === 'queued' ||
        (r.state === 'claimed' && now - r.claimedAt! < MAX_AGE))
  );
  if (existing) return existing;
  const request: ObservationRequest = {
    ...scope,
    id: randomUUID(),
    requestedAt: now,
    state: 'queued',
  };
  state.requests.push(request);
  return request;
}
export function claimObservation(
  state: ObservationState,
  identity: { userId: number; account: string },
  now = Date.now()
) {
  if (
    !Number.isSafeInteger(identity.userId) ||
    identity.userId < 1 ||
    typeof identity.account !== 'string' ||
    !/^[a-z0-9_]{1,40}$/.test(identity.account)
  )
    throw Error('Invalid observation identity');
  const request = state.requests.find(
    (r) =>
      r.state === 'queued' &&
      r.userId === identity.userId &&
      r.account === identity.account
  );
  if (!request) return null;
  request.state = 'claimed';
  request.claimedAt = now;
  request.claimToken = randomUUID();
  return request;
}
export type ObservationReport = ObservationScope & {
  id: string;
  claimToken: string;
  status: 'verified' | 'unknown' | 'ambiguous';
  identityVerified: boolean;
  complete: boolean;
  observation?: ReviewObservation;
};
export function reportObservation(
  state: ObservationState,
  input: ObservationReport,
  now = Date.now()
) {
  validateScope(input);
  const request = state.requests.find((r) => r.id === input.id);
  if (
    request &&
    ['unknown', 'ambiguous'].includes(request.state) &&
    request.state === input.status &&
    request.claimToken === input.claimToken &&
    sameScope(request, input)
  )
    return request;
  // Delivery acknowledgements may be lost after the durable result was saved.
  // Accept only an identical authenticated replay, never replace a baseline.
  if (
    request?.state === 'verified' &&
    input.status === 'verified' &&
    request.claimToken === input.claimToken &&
    sameScope(request, input)
  ) {
    const copy: ObservationState = {
      version: 1,
      requests: [{ ...request, state: 'claimed' }],
    };
    const replay = reportObservation(
      copy,
      input,
      request.observation!.observedAt
    );
    if (
      JSON.stringify(replay.observation) !== JSON.stringify(request.observation)
    )
      throw Error('Observation replay conflict');
    return request;
  }
  if (
    !request ||
    request.state !== 'claimed' ||
    request.claimToken !== input.claimToken ||
    !sameScope(request, input)
  )
    throw Error('Invalid or expired observation claim');
  if (!['verified', 'unknown', 'ambiguous'].includes(input.status))
    throw Error('Invalid observation status');
  if (input.status !== 'verified') {
    request.state = input.status;
    return request;
  }
  const o = input.observation;
  if (
    input.identityVerified !== true ||
    input.complete !== true ||
    !o ||
    typeof o.text !== 'string' ||
    o.text.length > 50000 ||
    typeof o.spoiler !== 'boolean' ||
    (o.rating !== null &&
      (typeof o.rating !== 'number' ||
        o.rating < 0.5 ||
        o.rating > 5 ||
        !Number.isInteger(o.rating * 2))) ||
    !Number.isFinite(o.observedAt) ||
    o.observedAt < request.claimedAt! ||
    o.observedAt - request.claimedAt! > MAX_AGE ||
    o.observedAt > now ||
    (request.entryId && o.entryId !== request.entryId) ||
    (o.text && !o.entryId) ||
    (request.createNew && (o.entryId || o.text || o.spoiler))
  )
    throw Error('Incomplete observation');
  validateScope({ ...request, entryId: o.entryId });
  if (o.watched !== undefined && typeof o.watched !== 'boolean')
    throw Error('Invalid watched observation');
  const hasInventory =
    o.diaryEntriesComplete !== undefined || o.diaryEntryIds !== undefined;
  if (hasInventory) {
    if (
      typeof o.diaryEntriesComplete !== 'boolean' ||
      !Array.isArray(o.diaryEntryIds) ||
      o.diaryEntryIds.length > 1000 ||
      new Set(o.diaryEntryIds).size !== o.diaryEntryIds.length
    )
      throw Error('Invalid diary inventory');
    for (const entryId of o.diaryEntryIds) {
      if (typeof entryId !== 'string' || entryId.length > 500)
        throw Error('Invalid diary entry');
      validateScope({ ...request, createNew: undefined, entryId });
    }
  }
  if (o.diaryEntryDates !== undefined) {
    const dates = o.diaryEntryDates;
    if (
      !hasInventory ||
      !dates ||
      typeof dates !== 'object' ||
      Array.isArray(dates) ||
      Object.keys(dates).length !== o.diaryEntryIds!.length ||
      Object.keys(dates).some((id) => !o.diaryEntryIds!.includes(id)) ||
      o.diaryEntryIds!.some((id) => {
        const date = dates[id];
        return (
          !Object.prototype.hasOwnProperty.call(dates, id) ||
          typeof date !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          date.startsWith('0000-') ||
          !Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date
        );
      })
    )
      throw Error('Invalid diary entry dates');
  }
  request.observation = {
    rating: o.rating,
    text: o.text,
    spoiler: o.spoiler,
    observedAt: o.observedAt,
    entryId: o.entryId,
    ...(o.watched !== undefined ? { watched: o.watched } : {}),
    ...(hasInventory
      ? {
          diaryEntriesComplete: o.diaryEntriesComplete,
          diaryEntryIds: [...o.diaryEntryIds!],
        }
      : {}),
    ...(o.diaryEntryDates !== undefined
      ? { diaryEntryDates: { ...o.diaryEntryDates } }
      : {}),
  };
  request.state = 'verified';
  return request;
}
export function findObservation(
  state: ObservationState,
  scope: ObservationScope,
  after = 0,
  now = Date.now()
): ReviewObservation | null {
  validateScope(scope);
  const latest = state.requests
    .filter((r) => sameScope(r, scope))
    .sort((a, b) => b.requestedAt - a.requestedAt)[0];
  const o = latest?.observation;
  return latest?.state === 'verified' &&
    o &&
    o.observedAt >= after &&
    o.observedAt <= now &&
    now - o.observedAt < MAX_AGE
    ? o
    : null;
}
export function readObservations(): ObservationState {
  try {
    const state: ObservationState = JSON.parse(
      fs.readFileSync(
        path.join(appDataPath(), 'letterboxd-observations.json'),
        'utf8'
      )
    );
    if (state.version !== 1 || !Array.isArray(state.requests))
      throw Error('Invalid observation store');
    for (const r of state.requests) {
      validateScope(r);
      if (
        !r.id ||
        !Number.isFinite(r.requestedAt) ||
        !['queued', 'claimed', 'verified', 'unknown', 'ambiguous'].includes(
          r.state
        )
      )
        throw Error('Invalid persisted observation');
      if (
        r.state !== 'queued' &&
        (!r.claimToken || !Number.isFinite(r.claimedAt))
      )
        throw Error('Invalid persisted observation claim');
      if (r.state === 'verified') {
        const check: ObservationState = {
          version: 1,
          requests: [{ ...r, state: 'claimed' }],
        };
        reportObservation(
          check,
          {
            ...r,
            claimToken: r.claimToken!,
            status: 'verified',
            complete: true,
            identityVerified: true,
          },
          r.observation?.observedAt
        );
      }
    }
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, requests: [] };
    throw error;
  }
}
// Synchronous read/modify/rename: callers must not await inside the callback.
export function updateObservations<T>(fn: (state: ObservationState) => T): T {
  const state = readObservations();
  const result = fn(state);
  const file = path.join(appDataPath(), 'letterboxd-observations.json');
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return result;
}
