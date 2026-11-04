import { reviewSessionId } from './earlyReviewViewing';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';

export type PlaybackRow = {
  type: string;
  watched_status?: number;
  row_id?: unknown;
  reference_id?: unknown;
  stopped?: number;
  started?: number;
  machine_id?: string;
  user_id: string | number;
  rating_key: string | number;
  viewers: number[];
  tmdbId?: number;
};
export type PlaybackEvent = {
  id: string;
  source: 'tautulli';
  userId: number;
  account: string;
  tmdbId: number;
  occurredAt: number;
  watchedDate: string;
  timezone: string;
  rowId: string;
  referenceId?: string;
  sessionId?: string;
};
export type PlaybackStore = { version: 1; events: PlaybackEvent[] };
export type PlaybackIssue = { reason: string; rowId?: string };
const realId = (value: unknown): string | undefined =>
  /^[1-9]\d*$/.test(String(value)) ? String(value) : undefined;

/** Collect only; deliberately has no dependency on write queue enqueue/dispatch. */
export function collectPlaybackEvents(
  store: PlaybackStore,
  rows: readonly PlaybackRow[],
  config: {
    enabled: boolean;
    userId: number;
    account: string;
    enabledSince?: number;
    timezone?: string;
    sourceId?: string;
    now: number;
    limit?: number;
  }
): { added: number; issues: PlaybackIssue[] } {
  const issues: PlaybackIssue[] = [];
  const result = { added: 0, issues };
  if (
    !config.enabled ||
    !Number.isSafeInteger(config.userId) ||
    config.userId < 1 ||
    !/^[a-z0-9_]{1,40}$/.test(config.account)
  )
    return result;
  if (!Number.isFinite(config.enabledSince) || config.enabledSince! <= 0) {
    issues.push({ reason: 'missing-enable-time' });
    return result;
  }
  if (!config.sourceId?.trim()) {
    issues.push({ reason: 'missing-stable-source-id' });
    return result;
  }
  let formatter: Intl.DateTimeFormat;
  try {
    if (!config.timezone) throw Error('Missing timezone');
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: config.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    issues.push({ reason: 'missing-or-invalid-timezone' });
    return result;
  }
  const limit = config.limit ?? 1000;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000 ||
    !Number.isFinite(config.now)
  )
    throw Error('Invalid collection bounds');
  for (const row of rows) {
    if (
      row.type !== 'movie' ||
      row.watched_status !== 1 ||
      !row.viewers.includes(config.userId)
    )
      continue;
    const rowId = realId(row.row_id);
    const referenceId = realId(row.reference_id);
    // Never fall back to scan time, history date, or session start for completion.
    const occurredAt = Number(row.stopped) * 1000;
    if (
      !Number.isSafeInteger(occurredAt) ||
      occurredAt <= 0 ||
      occurredAt > config.now ||
      !Number.isFinite(row.started) ||
      row.started! <= 0 ||
      row.started! * 1000 > occurredAt
    ) {
      issues.push({ reason: 'missing-or-invalid-completion-time', rowId });
      continue;
    }
    if (occurredAt < config.enabledSince!) continue;
    if (!rowId) {
      issues.push({ reason: 'missing-history-row-id' });
      continue;
    }
    if (!Number.isSafeInteger(row.tmdbId) || row.tmdbId! <= 0) {
      issues.push({ reason: 'unresolved-movie', rowId });
      continue;
    }
    // Reference groups resumed sessions; retain row id as evidence. Distinct
    // reference groups on the same day remain distinct real watches.
    const id =
      'tautulli:' +
      createHash('sha256')
        .update(
          JSON.stringify([
            config.sourceId,
            String(row.user_id),
            referenceId ?? rowId,
            config.userId,
          ])
        )
        .digest('hex');
    const existing = store.events.find((event) => event.id === id);
    if (existing) {
      if (existing.tmdbId !== row.tmdbId)
        issues.push({ reason: 'identity-conflict', rowId });
      continue;
    }
    if (store.events.length >= limit) {
      issues.push({ reason: 'pending-store-full', rowId });
      continue;
    }
    const parts = formatter.formatToParts(new Date(occurredAt));
    const part = (name: string) => parts.find((p) => p.type === name)!.value;
    store.events.push({
      id,
      source: 'tautulli',
      userId: config.userId,
      account: config.account,
      tmdbId: row.tmdbId!,
      occurredAt,
      watchedDate: `${part('year')}-${part('month')}-${part('day')}`,
      timezone: config.timezone!,
      rowId,
      referenceId,
      sessionId: reviewSessionId(row, config.sourceId, config.userId),
    });
    result.added++;
  }
  return result;
}

/** Synchronous atomic replacement serializes same-process collectors. Fail closed
 * on corruption; never evict pending evidence to accommodate new events. */
export function persistPlaybackEvents(
  filename: string,
  rows: readonly PlaybackRow[],
  config: Parameters<typeof collectPlaybackEvents>[2]
) {
  let store: PlaybackStore = { version: 1, events: [] };
  try {
    store = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (
      store.version !== 1 ||
      !Array.isArray(store.events) ||
      store.events.length > 1000 ||
      store.events.some(
        (e) =>
          typeof e.id !== 'string' ||
          !Number.isSafeInteger(e.userId) ||
          e.userId < 1 ||
          typeof e.account !== 'string' ||
          !/^[a-z0-9_]{1,40}$/.test(e.account)
      )
    )
      throw Error('Invalid playback event store');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const result = collectPlaybackEvents(store, rows, config);
  if (result.added) {
    const temporary = filename + '.' + randomUUID() + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(store), {
      flag: 'wx',
      mode: 0o600,
    });
    try {
      fs.renameSync(temporary, filename);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  return result;
}
