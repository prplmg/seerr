import { appDataPath } from '@server/utils/appDataVolume';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { sessionIdentity, type SessionIdentity } from './viewingAttribution';

export const EARLY_REVIEW_WINDOW_MS = 10 * 60 * 1000;
export const ACTIVE_VIEWING_MAX_AGE_MS = 65 * 1000;
export type EarlyViewing = {
  id: string;
  userId: number;
  tmdbId: number;
  date: string;
  observedAt: number;
};
export function reviewSessionId(
  row: SessionIdentity,
  sourceId: string | undefined,
  userId: number
) {
  const session = sessionIdentity(row);
  if (!session || !sourceId || !Number.isSafeInteger(userId) || userId < 1)
    return undefined;
  return (
    'playback-session:' +
    createHash('sha256')
      .update(JSON.stringify([sourceId, userId, session]))
      .digest('hex')
  );
}
export function earlyViewing(
  row: SessionIdentity & {
    media_type: string;
    state: string;
    duration: unknown;
    view_offset: unknown;
  },
  sourceId: string | undefined,
  userId: number,
  tmdbId: number,
  timezone: string | undefined,
  now = Date.now()
): EarlyViewing | undefined {
  const duration = Number(row.duration),
    position = Number(row.view_offset);
  if (
    row.media_type !== 'movie' ||
    row.state !== 'playing' ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(position) ||
    position <= 0 ||
    position > duration ||
    duration - position > EARLY_REVIEW_WINDOW_MS ||
    !Number.isSafeInteger(tmdbId) ||
    tmdbId < 1 ||
    !timezone
  )
    return;
  const id = reviewSessionId(row, sourceId, userId);
  if (!id) return;
  return {
    id,
    userId,
    tmdbId,
    observedAt: now,
    date: new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now),
  };
}
export function selectEarlyViewing(
  rows: EarlyViewing[],
  userId: number,
  tmdbId: number,
  now = Date.now()
) {
  const matching = rows.filter(
    (r) =>
      r.userId === userId &&
      r.tmdbId === tmdbId &&
      r.observedAt <= now &&
      now - r.observedAt <= ACTIVE_VIEWING_MAX_AGE_MS
  );
  return matching.length === 1 ? matching[0] : undefined;
}
const filename = () => path.join(appDataPath(), 'early-review-viewings.json');
export function saveEarlyViewings(rows: EarlyViewing[]) {
  if (rows.length > 100) throw Error('Too many active viewings');
  const file = filename(),
    temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(rows), { mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
export function readEarlyViewing(userId: number, tmdbId: number) {
  try {
    const rows = JSON.parse(fs.readFileSync(filename(), 'utf8'));
    if (!Array.isArray(rows) || rows.length > 100) return undefined;
    return selectEarlyViewing(rows, userId, tmdbId);
  } catch {
    return undefined;
  } // Optional hint must never break the review form.
}

export function playbackClaimed(
  event: { id: string; sessionId?: string },
  claimed: ReadonlySet<string>
) {
  return (
    claimed.has(event.id) || (!!event.sessionId && claimed.has(event.sessionId))
  );
}
