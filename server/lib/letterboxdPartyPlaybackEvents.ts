import { appDataPath } from '@server/utils/appDataVolume';
import axios from 'axios';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { PlaybackEvent } from './letterboxdPlaybackEvents';
import {
  readWriteState,
  setPreparationFailure,
  updateWriteState,
} from './letterboxdWriteQueue';

export type PartyPlaybackEvent = Omit<PlaybackEvent, 'source'> & {
  source: 'party';
  sourceId: string;
};
export type CompletedPlaybackEvent = PlaybackEvent | PartyPlaybackEvent;
export type PartyCompletion = {
  eventId: string;
  sequence: number;
  userId: number;
  tmdbId: number;
  completedAt: number;
};
type Store = { version: 1; events: PartyPlaybackEvent[] };
type Config = {
  userId: number;
  enabled: boolean;
  account: string;
  enabledSince?: number;
  timezone?: string;
  sourceId?: string;
  now: number;
};
export const partyPlaybackFilename = () =>
  path.join(appDataPath(), 'letterboxd-party-playback-events.json');
export function readPartyPlaybackEvents(
  filename = partyPlaybackFilename()
): PartyPlaybackEvent[] {
  try {
    const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (
      data.version !== 1 ||
      !Array.isArray(data.events) ||
      data.events.length > 1000 ||
      data.events.some(
        (e: PartyPlaybackEvent) =>
          e.source !== 'party' ||
          !Number.isSafeInteger(e.userId) ||
          e.userId < 1 ||
          !/^[a-z0-9_]{1,40}$/.test(e.account)
      )
    )
      throw Error('Invalid party playback store');
    return data.events;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
export function collectPartyPlaybackEvents(
  store: Store,
  rows: readonly PartyCompletion[],
  config: Config
) {
  const report = { added: 0, issues: [] as string[] };
  if (
    !config.enabled ||
    !Number.isSafeInteger(config.userId) ||
    config.userId < 1 ||
    !/^[a-z0-9_]{1,40}$/.test(config.account)
  )
    return report;
  let format: Intl.DateTimeFormat;
  try {
    if (
      !config.sourceId?.trim() ||
      !config.timezone ||
      !Number.isSafeInteger(config.enabledSince) ||
      config.enabledSince! <= 0
    )
      throw Error();
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: config.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    report.issues.push('explicit-source-timezone-and-enable-time-required');
    return report;
  }
  for (const row of rows) {
    if (row.userId !== config.userId) continue;
    if (
      !/^[a-f0-9]{64}$/.test(row.eventId) ||
      !Number.isSafeInteger(row.sequence) ||
      row.sequence <= 0 ||
      !Number.isSafeInteger(row.tmdbId) ||
      row.tmdbId <= 0 ||
      !Number.isSafeInteger(row.completedAt) ||
      row.completedAt <= 0 ||
      row.completedAt > config.now
    ) {
      report.issues.push('invalid-completion-evidence');
      continue;
    }
    if (row.completedAt < config.enabledSince!) continue;
    const id =
      'party:' +
      createHash('sha256')
        .update(JSON.stringify([config.sourceId, row.eventId, config.userId]))
        .digest('hex');
    const old = store.events.find((e) => e.id === id);
    if (old) {
      if (old.tmdbId !== row.tmdbId || old.occurredAt !== row.completedAt)
        report.issues.push('party-event-conflict');
      continue;
    }
    if (store.events.length >= 1000) {
      report.issues.push('pending-store-full');
      continue;
    }
    const parts = format.formatToParts(new Date(row.completedAt));
    const part = (name: string) => parts.find((p) => p.type === name)!.value;
    store.events.push({
      id,
      source: 'party',
      sourceId: config.sourceId!,
      userId: config.userId,
      account: config.account,
      tmdbId: row.tmdbId,
      occurredAt: row.completedAt,
      watchedDate: `${part('year')}-${part('month')}-${part('day')}`,
      timezone: config.timezone!,
      rowId: row.eventId,
    });
    report.added++;
  }
  return report;
}
export function persistPartyPlaybackEvents(
  filename: string,
  rows: readonly PartyCompletion[],
  config: Config
) {
  const store: Store = {
    version: 1,
    events: readPartyPlaybackEvents(filename),
  };
  const report = collectPartyPlaybackEvents(store, rows, config);
  if (report.added) {
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
  return report;
}

let running = false;
async function refreshForUser(userId: number) {
  const report = { added: 0, issues: [] as string[] };
  if (running) return report;
  running = true;
  try {
    const initial = readWriteState().settings[userId];
    if (!initial?.enabled || !initial.account) return report;
    const readConfig = () => {
      const p = JSON.parse(
        fs
          .readFileSync(path.join(appDataPath(), 'social.json'), 'utf8')
          .replace(/^\uFEFF/, '')
      );
      const relay = JSON.parse(
        fs
          .readFileSync(path.join(appDataPath(), 'watch-party.json'), 'utf8')
          .replace(/^\uFEFF/, '')
      );
      return { p, relay };
    };
    const { p, relay } = readConfig();
    if (
      !p.enabled ||
      !Array.isArray(p.hiddenWatchers) ||
      p.hiddenWatchers.includes(userId) ||
      !relay.enabled
    )
      return report;
    const config = {
      ...initial,
      userId,
      timezone: p.letterboxdPlayback?.timezone,
      sourceId: p.letterboxdPlayback?.sourceId,
      now: Date.now(),
    };
    const validation = collectPartyPlaybackEvents(
      { version: 1, events: [] },
      [],
      config
    );
    if (validation.issues.length) return validation;
    const { getRepository } = await import('@server/datasource');
    const { LetterboxdAccount } = await import('@server/entity/MovieReview');
    const { User } = await import('@server/entity/User');
    const { default: Media } = await import('@server/entity/Media');
    const { MediaStatus } = await import('@server/constants/media');
    for (let after = 0, page = 0; page < 10; page++) {
      const response = await axios.get(
        `${relay.relayUrl.replace(/\/$/, '')}/catalogue/watched-events`,
        {
          timeout: 5000,
          maxRedirects: 0,
          headers: { Authorization: `Bearer ${relay.secret}` },
          params: { userId, since: initial.enabledSince, after },
        }
      );
      const data = response.data;
      if (
        data?.version !== 1 ||
        !Array.isArray(data.events) ||
        data.events.length > 200 ||
        (data.next !== null &&
          (!Number.isSafeInteger(data.next) || data.next <= after))
      )
        throw Error('Invalid party page');
      const account = await getRepository(LetterboxdAccount).findOne({
        where: { userId },
      });
      const user = await getRepository(User).findOne({ where: { id: userId } });
      const media = await getRepository(Media).find();
      const current = readConfig();
      const fresh = readWriteState().settings[userId];
      if (
        !user ||
        !account?.enabled ||
        account.username !== initial.account ||
        !fresh?.enabled ||
        fresh.account !== initial.account ||
        fresh.enabledSince !== initial.enabledSince ||
        JSON.stringify(current) !== JSON.stringify({ p, relay })
      )
        break;
      const blocked = new Set(
        media
          .filter(
            (m) =>
              m.mediaType === 'movie' &&
              (m.status === MediaStatus.BLOCKLISTED ||
                m.status4k === MediaStatus.BLOCKLISTED)
          )
          .map((m) => m.tmdbId)
      );
      const result = persistPartyPlaybackEvents(
        partyPlaybackFilename(),
        data.events.filter((e: PartyCompletion) => !blocked.has(e.tmdbId)),
        { ...config, now: Date.now() }
      );
      report.added += result.added;
      report.issues.push(...result.issues);
      if (data.next === null) return report;
      after = data.next;
    }
    report.issues.push('collection-incomplete');
  } catch {
    // An old relay must never fall back to its lossy latest-watched snapshot.
    report.issues.push('party-completion-feed-unavailable');
  } finally {
    running = false;
  }
  return report;
}

export async function refreshLetterboxdPartyPlaybackEvents() {
  const report = { added: 0, issues: [] as string[] };
  for (const [id, setting] of Object.entries(readWriteState().settings)) {
    const userId = Number(id);
    if (!Number.isSafeInteger(userId) || userId < 1 || !setting.enabled)
      continue;
    const result = await refreshForUser(userId);
    updateWriteState((s) =>
      setPreparationFailure(
        s,
        userId,
        setting.account,
        'party-history',
        result.issues.length > 0
      )
    );
    report.added += result.added;
    report.issues.push(...result.issues.map((reason) => userId + ':' + reason));
  }
  return report;
}
