import { appDataPath } from '@server/utils/appDataVolume';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
export type HistoryHealth = {
  firstFailedAt?: number;
  lastFailedAt?: number;
  attempts: number;
  lastSuccess?: number;
  nextAttemptAt: number;
  notified?: boolean;
  error?: { stage: string; code: string; status?: number };
};
const file = () => path.join(appDataPath(), 'letterboxd-history-health.json');
export function readHistoryHealth(): HistoryHealth {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    return { attempts: 0, nextAttemptAt: 0 };
  }
}
export function saveHistoryHealth(state: HistoryHealth) {
  const temp = file() + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(state));
  fs.renameSync(temp, file());
}
export function historyResult(
  old: HistoryHealth,
  error?: unknown,
  stage = 'history-fetch',
  now = Date.now()
): HistoryHealth {
  if (!error)
    return { attempts: 0, nextAttemptAt: now + 25000, lastSuccess: now };
  const e = error as { code?: unknown; response?: { status?: unknown } };
  const code =
    typeof e.code === 'string' && /^[A-Z_0-9]{1,50}$/.test(e.code)
      ? e.code
      : 'HISTORY_CHECK_FAILED';
  const status =
    typeof e.response?.status === 'number' ? e.response.status : undefined;
  const attempts = old.attempts + 1;
  return {
    ...old,
    firstFailedAt: old.firstFailedAt ?? now,
    lastFailedAt: now,
    attempts,
    nextAttemptAt: now + Math.min(300000, 30000 * 2 ** Math.min(attempts, 4)),
    error: { stage, code, ...(status ? { status } : {}) },
  };
}
export function historyNeedsAlert(state: HistoryHealth, now = Date.now()) {
  return (
    !state.notified &&
    state.attempts >= 3 &&
    state.firstFailedAt !== undefined &&
    now - state.firstFailedAt >= 15 * 60 * 1000
  );
}
