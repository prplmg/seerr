import { appDataPath } from '@server/utils/appDataVolume';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { CompletedPlaybackEvent as PlaybackEvent } from './letterboxdPartyPlaybackEvents';
import { observeLetterboxdPlaybackEvent } from './letterboxdPlaybackObservations';
import { prepareLetterboxdPlaybackPublications as prepare } from './letterboxdPlaybackPublishing';
import { readSyncReceipts } from './letterboxdSyncReceipts';
import {
  readWriteState,
  setPreparationFailure,
  updateWriteState,
} from './letterboxdWriteQueue';

type Batch = {
  version: 1;
  enabledSince?: number;
  config: string;
  events: PlaybackEvent[];
};
const filename = (userId: number) =>
  path.join(
    appDataPath(),
    userId === 1
      ? 'letterboxd-playback-continuation.json'
      : `letterboxd-playback-continuation-${userId}.json`
  );
function config() {
  const policy = JSON.parse(
    fs
      .readFileSync(path.join(appDataPath(), 'social.json'), 'utf8')
      .replace(/^\uFEFF/, '')
  );
  return JSON.stringify([
    policy.letterboxdPlayback?.sourceId,
    policy.letterboxdPlayback?.timezone,
  ]);
}
function readBatch(userId: number): Batch {
  try {
    const batch = JSON.parse(
      fs.readFileSync(filename(userId), 'utf8')
    ) as Batch;
    if (
      batch.version !== 1 ||
      !Array.isArray(batch.events) ||
      batch.events.length > 2 ||
      typeof batch.config !== 'string'
    )
      throw Error('Invalid playback continuation');
    return batch;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, config: '', events: [] };
    throw error;
  }
}
function saveBatch(userId: number, batch: Batch) {
  const file = filename(userId),
    temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(batch), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
const idle = () => ({ queued: 0, pendingObservations: [], issues: [] });
let running = false;

/** Durable bounded admission for the scheduler and immediate worker polls. */
async function prepareForUser(userId: number) {
  if (running) return idle();
  running = true;
  try {
    if (readBatch(userId).events.length) return idle();
    const setting = readWriteState().settings[userId];
    const batch: Batch = {
      version: 1,
      enabledSince: setting?.enabledSince,
      config: '',
      events: [],
    };
    saveBatch(userId, batch);
    if (!setting?.enabled || !setting.account) return idle();
    batch.config = config();
    const snapshots = new Map<string, PlaybackEvent>();
    const report = await prepare(async (event) => {
      snapshots.set(event.id, { ...event });
      return observeLetterboxdPlaybackEvent(event);
    }, userId);
    batch.events = report.pendingObservations
      .map((pending) => snapshots.get(pending.eventId))
      .filter((event): event is PlaybackEvent => !!event)
      .slice(0, Math.max(0, 2 - report.queued));
    saveBatch(userId, batch);
    return report;
  } finally {
    running = false;
  }
}

async function continueForUser(userId: number) {
  if (running) return;
  running = true;
  try {
    const batch = readBatch(userId);
    if (!batch.events.length) return;
    const valid = () => {
      const setting = readWriteState().settings[userId];
      return (
        setting?.enabled &&
        batch.events.every(
          (e) => e.userId === userId && e.account === setting.account
        ) &&
        setting.enabledSince === batch.enabledSince &&
        config() === batch.config
      );
    };
    if (!valid()) {
      saveBatch(userId, { ...batch, events: [] });
      return;
    }
    // The planner keeps its own lock, policy/mapping checks, freshness checks,
    // and idempotency. Its provider sees ONLY admitted immutable event snapshots.
    // Returning null for other events cannot request observations or queue writes.
    await prepare(async (event) => {
      const admitted = batch.events.find((e) => e.id === event.id);
      if (
        !admitted ||
        JSON.stringify(admitted) !== JSON.stringify(event) ||
        !valid()
      )
        return null;
      const observation = await observeLetterboxdPlaybackEvent(event);
      return valid() ? observation : null;
    }, userId);
    const state = readWriteState();
    const receipts = readSyncReceipts();
    batch.events = batch.events.filter(
      (event) =>
        !state.intents.some(
          (i) => i.userId === userId && i.originEntityId === event.id
        ) &&
        !receipts.some((r) => r.userId === userId && r.originId === event.id)
    );
    saveBatch(userId, batch);
  } finally {
    running = false;
  }
}

export async function prepareLetterboxdPlaybackPublications() {
  const reports = [];
  for (const [id, setting] of Object.entries(readWriteState().settings)) {
    const userId = Number(id);
    if (!Number.isSafeInteger(userId) || userId < 1 || !setting.enabled)
      continue;
    try {
      const report = await prepareForUser(userId);
      reports.push(report);
      updateWriteState((s) =>
        setPreparationFailure(
          s,
          userId,
          setting.account,
          'playback-admission',
          report.issues.some((i) => i.reason !== 'already-running')
        )
      );
    } catch {
      updateWriteState((s) =>
        setPreparationFailure(
          s,
          userId,
          setting.account,
          'playback-admission',
          true
        )
      );
    }
  }
  return {
    queued: reports.reduce((n, r) => n + r.queued, 0),
    pendingObservations: reports.flatMap((r) => r.pendingObservations),
    issues: reports.flatMap((r) => r.issues),
  };
}
export async function continueLetterboxdPlaybackPublications() {
  for (const id of Object.keys(readWriteState().settings)) {
    const userId = Number(id);
    if (!Number.isSafeInteger(userId) || userId < 1) continue;
    const account = readWriteState().settings[userId]?.account;
    if (!account) continue;
    try {
      await continueForUser(userId);
      updateWriteState((s) =>
        setPreparationFailure(
          s,
          userId,
          account,
          'playback-continuation',
          false
        )
      );
    } catch {
      updateWriteState((s) =>
        setPreparationFailure(s, userId, account, 'playback-continuation', true)
      );
    }
  }
}
