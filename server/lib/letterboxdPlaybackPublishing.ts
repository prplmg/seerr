import { appDataPath } from '@server/utils/appDataVolume';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  readPartyPlaybackEvents,
  type CompletedPlaybackEvent as PlaybackEvent,
} from './letterboxdPartyPlaybackEvents';
import { observeLetterboxdPlaybackEvent } from './letterboxdPlaybackObservations';
import { readSyncReceipts, type SyncReceipt } from './letterboxdSyncReceipts';
import {
  planWatchedPublication,
  type WatchedPublicationInput,
} from './letterboxdWatchedPlan';
import {
  enqueueWrite,
  readWriteState,
  updateWriteState,
  type WriteState,
} from './letterboxdWriteQueue';

export type PlaybackObservationRequirement = {
  eventId: string;
  userId: number;
  account: string;
  tmdbId: number;
  occurredAt: number;
  watchedDate: string;
  reason: string;
};
// Provider contract: verified exact film match AND event-level reconciliation.
// A film's watched flag or a same-day diary match alone is not sufficient.
export type PlaybackObservation = NonNullable<
  WatchedPublicationInput['baseline']
> & {
  eventId: string;
};
export type PlaybackPublicationReport = {
  queued: number;
  pendingObservations: PlaybackObservationRequirement[];
  issues: { eventId?: string; reason: string }[];
};
type Config = {
  timezone?: string;
  sourceId?: string;
  linked: boolean;
  allowed: boolean;
};
type Dependencies = {
  userId?: number;
  events: () => PlaybackEvent[];
  config: () => Promise<Config>;
  state: () => WriteState;
  receipts: () => SyncReceipt[];
  observe: (event: PlaybackEvent) => Promise<PlaybackObservation | null>;
  update: (change: (state: WriteState) => void) => void;
  now: () => number;
};
export const PLAYBACK_BASELINE_MAX_AGE_MS = 5 * 60 * 1000;

export async function planPendingPlaybackPublications(
  deps: Dependencies
): Promise<PlaybackPublicationReport> {
  const report: PlaybackPublicationReport = {
    queued: 0,
    pendingObservations: [],
    issues: [],
  };
  const userId = deps.userId ?? 1;
  const settings = { ...deps.state().settings[userId] };
  const accountName = settings.account;
  if (!settings?.enabled || !accountName) return report;
  const config = { ...(await deps.config()) };
  if (!config.linked || !config.allowed) return report;
  try {
    if (!config.timezone || !config.sourceId?.trim()) throw Error();
    new Intl.DateTimeFormat('en-US', { timeZone: config.timezone });
  } catch {
    report.issues.push({ reason: 'explicit-timezone-and-source-required' });
    return report;
  }
  if (!Number.isFinite(settings.enabledSince) || settings.enabledSince! <= 0) {
    report.issues.push({ reason: 'missing-enable-time' });
    return report;
  }
  const events = deps.events().map((event) => ({ ...event }));
  if (events.length > 2000) throw Error('Playback store exceeds bound');
  for (const event of events) {
    if (report.queued >= 2) break;
    if (
      !['tautulli', 'party'].includes(event.source) ||
      event.userId !== userId ||
      event.account !== accountName ||
      event.occurredAt < settings.enabledSince!
    )
      continue;
    if (
      !new RegExp(`^${event.source}:[a-f0-9]{64}$`).test(event.id) ||
      (event.source === 'party' && event.sourceId !== config.sourceId) ||
      !Number.isSafeInteger(event.tmdbId) ||
      event.tmdbId <= 0 ||
      !Number.isFinite(event.occurredAt) ||
      event.occurredAt > deps.now() ||
      event.timezone !== config.timezone
    ) {
      report.issues.push({
        eventId: event.id,
        reason: 'invalid-event-or-timezone-changed',
      });
      continue;
    }
    const dateParts = new Intl.DateTimeFormat('en-US', {
      timeZone: config.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(event.occurredAt));
    const part = (name: string) =>
      dateParts.find((p) => p.type === name)!.value;
    if (
      event.watchedDate !== `${part('year')}-${part('month')}-${part('day')}`
    ) {
      report.issues.push({
        eventId: event.id,
        reason: 'recorded-date-mismatch',
      });
      continue;
    }
    const input = (
      baseline: PlaybackObservation | null,
      state: WriteState
    ): WatchedPublicationInput => ({
      event: {
        ...event,
        source: 'local',
        film: baseline?.film ?? 'pending-observation',
        rewatch: false,
      },
      enabledSince: state.settings[userId]?.enabledSince ?? null,
      receipts: deps.receipts(),
      recordedIntents: state.intents,
      baseline,
    });
    // Check receipts and every queue state before requesting more browser work.
    const previous = planWatchedPublication(input(null, deps.state()));
    if (previous.state === 'recorded' || previous.state === 'ignored') continue;
    if (
      previous.state === 'held' &&
      previous.reason !== 'needs-verified-baseline'
    ) {
      report.issues.push({ eventId: event.id, reason: previous.reason });
      continue;
    }
    const baseline = await deps.observe(event);
    const currentConfig = await deps.config();
    // Recheck all mutable inputs after asynchronous browser/mapping work.
    const fresh = deps.state().settings[userId];
    if (
      !fresh?.enabled ||
      fresh.account !== accountName ||
      fresh.enabledSince !== settings.enabledSince ||
      JSON.stringify(currentConfig) !== JSON.stringify(config)
    )
      break;
    if (
      !deps.events().some((e) => JSON.stringify(e) === JSON.stringify(event))
    ) {
      report.issues.push({ eventId: event.id, reason: 'event-changed' });
      continue;
    }
    if (
      !baseline ||
      baseline.eventId !== event.id ||
      !baseline.verified ||
      !Number.isFinite(baseline.observedAt) ||
      baseline.observedAt > deps.now() ||
      deps.now() - baseline.observedAt > PLAYBACK_BASELINE_MAX_AGE_MS ||
      baseline.observedAt < Math.max(event.occurredAt, fresh.enabledSince!)
    ) {
      report.pendingObservations.push({
        eventId: event.id,
        userId,
        account: accountName,
        tmdbId: event.tmdbId,
        occurredAt: event.occurredAt,
        watchedDate: event.watchedDate,
        reason: 'needs-fresh-event-baseline',
      });
      continue;
    }
    deps.update((state) => {
      const setting = state.settings[userId];
      if (
        !setting?.enabled ||
        setting.account !== accountName ||
        setting.enabledSince !== fresh.enabledSince
      )
        return;
      const plan = planWatchedPublication(input(baseline, state));
      if (plan.state === 'publish') {
        enqueueWrite(state, plan.intent, 'local', deps.now());
        report.queued++;
      } else if (plan.state === 'held')
        report.issues.push({ eventId: event.id, reason: plan.reason });
    });
  }
  return report;
}

let running = false;
/** Queue only publications supported by fresh authenticated observation evidence. */
async function prepareForUser(
  userId: number,
  observe: Dependencies['observe'] = observeLetterboxdPlaybackEvent
): Promise<PlaybackPublicationReport> {
  if (running)
    return {
      queued: 0,
      pendingObservations: [],
      issues: [{ reason: 'already-running' }],
    };
  running = true;
  try {
    const accountName = readWriteState().settings[userId]?.account;
    const { withReviewLock } = await import('./reviews');
    return await withReviewLock(userId, async () => {
      const { getRepository } = await import('@server/datasource');
      const { MovieReview } = await import('@server/entity/MovieReview');
      const claimed = new Set(
        (
          await getRepository(MovieReview).findBy({
            userId,
            source: 'local',
            syncToLetterboxd: true,
          })
        )
          .map((r) => r.viewingEventId)
          .filter(Boolean)
      );
      const report = await planPendingPlaybackPublications({
        userId,
        events: () => {
          const party = readPartyPlaybackEvents();
          try {
            const store = JSON.parse(
              fs.readFileSync(
                path.join(appDataPath(), 'letterboxd-playback-events.json'),
                'utf8'
              )
            );
            if (
              store.version !== 1 ||
              !Array.isArray(store.events) ||
              store.events.length > 1000
            )
              throw Error('Invalid playback store');
            return [...store.events, ...party]
              .filter((e) => !claimed.has(e.id))
              .sort((a, b) => a.occurredAt - b.occurredAt);
          } catch (error) {
            if (error.code === 'ENOENT')
              return party.filter((e) => !claimed.has(e.id));
            throw error;
          }
        },
        config: async () => {
          const { getRepository } = await import('@server/datasource');
          const { LetterboxdAccount } =
            await import('@server/entity/MovieReview');
          const account = await getRepository(LetterboxdAccount).findOne({
            where: { userId },
          });
          const policy = JSON.parse(
            fs
              .readFileSync(path.join(appDataPath(), 'social.json'), 'utf8')
              .replace(/^\uFEFF/, '')
          );
          return {
            timezone: policy.letterboxdPlayback?.timezone,
            sourceId: policy.letterboxdPlayback?.sourceId,
            linked: !!account?.enabled && account.username === accountName,
            allowed:
              policy.enabled === true &&
              Array.isArray(policy.hiddenWatchers) &&
              !policy.hiddenWatchers.includes(userId),
          };
        },
        state: readWriteState,
        receipts: readSyncReceipts,
        observe,
        update: updateWriteState,
        now: Date.now,
      });
      const file = path.join(
        appDataPath(),
        userId === 1
          ? 'letterboxd-playback-publication-status.json'
          : `letterboxd-playback-publication-status-${userId}.json`
      );
      const temporary = file + '.' + randomUUID() + '.tmp';
      fs.writeFileSync(
        temporary,
        JSON.stringify({ version: 1, checkedAt: Date.now(), ...report }),
        { flag: 'wx', mode: 0o600 }
      );
      try {
        fs.renameSync(temporary, file);
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
      return report;
    });
  } finally {
    running = false;
  }
}

export async function prepareLetterboxdPlaybackPublications(
  observe: Dependencies['observe'] = observeLetterboxdPlaybackEvent,
  onlyUserId?: number
): Promise<PlaybackPublicationReport> {
  const report: PlaybackPublicationReport = {
    queued: 0,
    pendingObservations: [],
    issues: [],
  };
  for (const [id, setting] of Object.entries(readWriteState().settings)) {
    const userId = Number(id);
    if (
      !Number.isSafeInteger(userId) ||
      userId < 1 ||
      !setting.enabled ||
      (onlyUserId !== undefined && userId !== onlyUserId)
    )
      continue;
    const result = await prepareForUser(userId, observe);
    report.queued += result.queued;
    report.pendingObservations.push(...result.pendingObservations);
    report.issues.push(...result.issues);
  }
  return report;
}
