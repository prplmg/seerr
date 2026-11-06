import type { Library, PlexSettings } from '@server/lib/settings';
import { appDataPath } from '@server/utils/appDataVolume';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

export const RETRY_LIMIT = 25;
export const RETRY_CAPACITY = 2000;
const INITIAL_DELAY = 5 * 60 * 1000;
const MAX_DELAY = 24 * 60 * 60 * 1000;
export type RetryEntry = {
  server: string;
  libraryId: string;
  ratingKey: string;
  attempts: number;
  nextAttempt: number;
  refreshAttempted?: boolean;
  missingGuid?: boolean;
  repairNeeded?: boolean;
};
export function plexRetryServer(settings: PlexSettings) {
  return createHash('sha256')
    .update(
      settings.machineId || `${settings.useSsl}:${settings.ip}:${settings.port}`
    )
    .digest('hex');
}
export function plexRetryKey(item: {
  ratingKey: string;
  parentRatingKey?: string;
  grandparentRatingKey?: string;
}) {
  return item.grandparentRatingKey ?? item.parentRatingKey ?? item.ratingKey;
}
const same = (
  a: RetryEntry,
  b: Pick<RetryEntry, 'server' | 'libraryId' | 'ratingKey'>
) =>
  a.server === b.server &&
  a.libraryId === b.libraryId &&
  a.ratingKey === b.ratingKey;

/** Atomic, bounded, credential-free state. Re-read on mutation so scanner instances
 * never overwrite each other's completed entries. A corrupt/unwritable queue fails
 * the scan rather than advancing the watermark without preserving its failures. */
export class PlexRetryQueue {
  constructor(
    private file = path.join(appDataPath(), 'plex-scanner-retries.json')
  ) {}

  private read(): RetryEntry[] {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    if (
      data.version !== 1 ||
      !Array.isArray(data.entries) ||
      data.entries.length > RETRY_CAPACITY ||
      !data.entries.every(
        (e: RetryEntry) =>
          e &&
          typeof e.server === 'string' &&
          typeof e.libraryId === 'string' &&
          typeof e.ratingKey === 'string' &&
          Number.isSafeInteger(e.attempts) &&
          e.attempts > 0 &&
          Number.isSafeInteger(e.nextAttempt) &&
          e.nextAttempt >= 0
      )
    ) {
      throw Error('Invalid Plex scanner retry state');
    }
    return data.entries;
  }

  private write(entries: RetryEntry[]) {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, entries }), {
        mode: 0o600,
        flag: 'wx',
      });
      fs.renameSync(temporary, this.file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  public has(entry: Pick<RetryEntry, 'server' | 'libraryId' | 'ratingKey'>) {
    return this.read().some((e) => same(e, entry));
  }

  public fail(
    entry: Pick<RetryEntry, 'server' | 'libraryId' | 'ratingKey'>,
    now = Date.now(),
    missingGuid?: boolean
  ) {
    const entries = this.read();
    const old = entries.find((e) => same(e, entry));
    if (!old && entries.length >= RETRY_CAPACITY)
      throw Error('Plex scanner retry queue is full');
    const attempts = Math.min((old?.attempts ?? 0) + 1, 32);
    const next = {
      ...old,
      ...entry,
      missingGuid: missingGuid ?? old?.missingGuid ?? false,
      repairNeeded:
        attempts >= 10 && (missingGuid ?? old?.missingGuid ?? false),
      attempts,
      nextAttempt:
        now + Math.min(INITIAL_DELAY * 2 ** (attempts - 1), MAX_DELAY),
    };
    if (old) Object.assign(old, next);
    else entries.push(next);
    this.write(entries);
    return next;
  }

  public clear(entry: Pick<RetryEntry, 'server' | 'libraryId' | 'ratingKey'>) {
    const entries = this.read();
    const remaining = entries.filter((e) => !same(e, entry));
    if (remaining.length !== entries.length) this.write(remaining);
  }

  public due(server: string, libraries: Library[], now = Date.now()) {
    const entries = this.read();
    // Disabled/removed libraries and other servers remain durable but paused.
    // Only a successful import or confirmed Plex deletion removes an incident.
    const retained = entries.filter((e) => e.server === server);
    return retained
      .filter(
        (e) =>
          e.nextAttempt <= now &&
          libraries.some((l) => l.id === e.libraryId && l.enabled)
      )
      .sort((a, b) => a.nextAttempt - b.nextAttempt)
      .slice(0, RETRY_LIMIT);
  }

  public claimRefresh(
    entry: Pick<RetryEntry, 'server' | 'libraryId' | 'ratingKey'>
  ) {
    const entries = this.read();
    const current = entries.find((e) => same(e, entry));
    if (!current || current.refreshAttempted) return false;
    // Persist BEFORE sending PUT. A crash or uncertain response cannot repeat it.
    current.refreshAttempted = true;
    this.write(entries);
    return true;
  }

  public summary() {
    const entries = this.read();
    return {
      pending: entries.length,
      repairNeeded: entries.filter((e) => e.repairNeeded).length,
    };
  }

  public claim(entry: RetryEntry, now = Date.now()) {
    const entries = this.read();
    const current = entries.find((e) => same(e, entry));
    if (!current || current.nextAttempt > now) return false;
    // A restart in the middle of an attempt must not produce a hot retry loop.
    current.nextAttempt = now + INITIAL_DELAY;
    this.write(entries);
    return true;
  }
}
