import { appDataPath } from '@server/utils/appDataVolume';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { ListCandidate } from './weeklyListsPolicy';
export type WeeklyState = {
  startedAt?: number;
  completedAt?: number;
  discoveredAt?: number;
  pages: Record<
    string,
    { job?: string; rows?: ListCandidate[]; attempts: number; error?: string }
  >;
  queue: {
    url: string;
    job?: string;
    attempts: number;
    done?: boolean;
    error?: string;
  }[];
  seen: Record<string, number>;
  retired: string[];
  deferred?: string;
  lastDay?: string;
};
export function readWeeklyLists(): WeeklyState {
  const file = path.join(appDataPath(), 'weekly-lists.json');
  return fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : { pages: {}, queue: [], seen: {}, retired: [] };
}
export function updateWeeklyLists(fn: (state: WeeklyState) => void) {
  const state = readWeeklyLists();
  fn(state);
  const file = path.join(appDataPath(), 'weekly-lists.json'),
    tmp = file + '.' + randomUUID() + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(tmp, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}
// A short-lived grant is renewed only after runtime maintenance checks pass.
let permittedUntil = 0;
export function permitWeeklyLists(until: number) {
  permittedUntil = until;
}
export function weeklyListsPermitted(now = Date.now()) {
  return now < permittedUntil;
}

// Operator-only, expiring continuation grant. Does not change the schedule or
// bypass health checks. Written on the server by the maintenance operator.
export function weeklyManualUntil(now = Date.now()) {
  try {
    const grant = JSON.parse(
      fs.readFileSync(
        path.join(appDataPath(), 'weekly-lists-manual.json'),
        'utf8'
      )
    );
    return Number.isFinite(grant.startedAt) &&
      Number.isFinite(grant.until) &&
      grant.startedAt <= now &&
      grant.until > now &&
      grant.until - grant.startedAt <= 2 * 3600000
      ? grant.until
      : 0;
  } catch {
    return 0;
  }
}
