import { supportsWriteIntent } from './letterboxdWriteCapabilities';
import type { WriteIntent } from './letterboxdWriteQueue';

export type WorkerRuntime =
  | 'unknown'
  | 'stale'
  | 'paused'
  | 'blocked'
  | 'ready';

export type WorkerHealth = {
  receivedAt: number;
  paused: boolean;
  pauseReason:
    | 'none'
    | 'read-check'
    | 'uncertain-write'
    | 'watchdog'
    | 'manual';
  supportedWriteKinds: string[];
  errors: {
    stage: 'publishing' | 'heartbeat' | 'lists';
    at: number;
    type: string;
    httpStatus?: number;
  }[];
};
export function parseWorkerHealth(
  value: unknown,
  now = Date.now()
): WorkerHealth | undefined {
  if (value === undefined) return undefined;
  const v = value as Omit<WorkerHealth, 'receivedAt'>;
  if (
    !v ||
    typeof v.paused !== 'boolean' ||
    !['none', 'read-check', 'uncertain-write', 'watchdog', 'manual'].includes(
      v.pauseReason
    ) ||
    !Array.isArray(v.supportedWriteKinds) ||
    v.supportedWriteKinds.length > 5 ||
    v.supportedWriteKinds.some(
      (k) =>
        !['rating', 'review', 'diary', 'diary-content', 'watched'].includes(k)
    ) ||
    !Array.isArray(v.errors) ||
    v.errors.length > 3 ||
    v.errors.some(
      (e) =>
        !e ||
        !['publishing', 'heartbeat', 'lists'].includes(e.stage) ||
        !Number.isFinite(e.at) ||
        e.at <= 0 ||
        typeof e.type !== 'string' ||
        !/^[A-Za-z0-9_]{1,80}$/.test(e.type) ||
        (e.httpStatus !== undefined &&
          (!Number.isInteger(e.httpStatus) ||
            e.httpStatus < 100 ||
            e.httpStatus > 599))
    )
  )
    throw Error('Invalid worker health');
  return {
    receivedAt: now,
    paused: v.paused,
    pauseReason: v.pauseReason,
    supportedWriteKinds: [...new Set(v.supportedWriteKinds)],
    errors: v.errors.map((e) => ({
      stage: e.stage,
      at: Math.min(e.at, now),
      type: e.type,
      ...(e.httpStatus === undefined ? {} : { httpStatus: e.httpStatus }),
    })),
  };
}
export function summarizeWorkerHealth(
  health: WorkerHealth | undefined,
  intents: Pick<WriteIntent, 'state' | 'kind' | 'created' | 'desired' | 'recovery'>[],
  now = Date.now()
) {
  const fresh = !!health && now - health.receivedAt <= 10 * 60 * 1000;
  const held = intents.filter(i => ['unknown','conflict'].includes(i.state));
  const recoveryTimes = held.map(i => i.recovery?.nextAttemptAt).filter((n): n is number => typeof n === 'number');
  const queued = intents.filter((i) => i.state === 'queued');
  const unsupportedQueued = fresh
    ? queued.filter(
        (intent) => !supportsWriteIntent(intent, health!.supportedWriteKinds)
      ).length
    : null;
  const runtime: WorkerRuntime = !health
    ? 'unknown'
    : !fresh
      ? 'stale'
      : health.paused
        ? 'paused'
        : unsupportedQueued || held.length
          ? 'blocked'
          : 'ready';
  return {
    runtime,
    pauseReason: health?.pauseReason,
    unsupportedQueued,
    heldWrites: held.length,
    nextRecoveryAt: recoveryTimes.length ? Math.min(...recoveryTimes) : null,
    oldestQueuedAt: queued.length
      ? Math.min(...queued.map((i) => i.created))
      : null,
    recentErrors: fresh
      ? health!.errors.filter((e) => now - e.at <= 10 * 60 * 1000)
      : [],
  };
}
