import { getRepository } from '@server/datasource';
import { MovieReview } from '@server/entity/MovieReview';
import { appDataPath } from '@server/utils/appDataVolume';
import fs from 'fs';
import path from 'path';
import { letterboxdEntryIdentity } from './letterboxdImport';
import { recentUnratedViewing } from './recentUnratedViewing';
import { readSyncReceipts } from './letterboxdSyncReceipts';

export function scopedReviewId(base: string, value: unknown) {
  if (value === undefined) return base;
  if (
    typeof value !== 'string' ||
    (value !== base &&
      !(
        value.startsWith(base + ':') &&
        /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
          value.slice(base.length + 1)
        )
      ))
  )
    throw Error('Invalid review identity');
  return value;
}
export type ViewingChoice = {
  id: string;
  date: string;
  source: 'letterboxd' | 'catalogue';
  entryId: string | null;
  occurredAt?: number;
  suggested?: boolean;
};
export async function latestReviewViewing(
  userId: number,
  tmdbId: number,
  mediaType: 'movie' | 'tv'
): Promise<ViewingChoice | null> {
  const choices: ViewingChoice[] = [];
  const reviews = await getRepository(MovieReview).findBy({
    userId,
    tmdbId,
    mediaType,
  });
  for (const r of reviews.filter(r => r.source === 'letterboxd')) {
    const entryId =
      r.externalEntryId ||
      (r.externalUrl && letterboxdEntryIdentity(r.externalUrl));
    if (r.watchedDate && entryId)
      choices.push({
        id: r.id,
        date: r.watchedDate,
        source: 'letterboxd',
        entryId,
      });
  }
  if (mediaType === 'movie')
    for (const filename of [
      'letterboxd-playback-events.json',
      'letterboxd-party-playback-events.json',
    ]) {
      try {
        const store = JSON.parse(
          fs.readFileSync(path.join(appDataPath(), filename), 'utf8')
        );
        if (store.version !== 1 || !Array.isArray(store.events))
          throw Error('Invalid viewing store');
        for (const e of store.events)
          if (
            e.userId === userId &&
            e.tmdbId === tmdbId &&
            /^\d{4}-\d{2}-\d{2}$/.test(e.watchedDate)
          ) {
            const receipt = readSyncReceipts().find(
              (r) =>
                r.userId === userId && r.originId === e.id && r.diaryBaseline
            );
            const linkedReview = reviews.find(r => r.source === 'local' && r.viewingEventId === e.id && r.externalEntryId);
            const entryId = receipt?.entryId || linkedReview?.externalEntryId || null;
            choices.push({
              id: e.id,
              date: e.watchedDate,
              occurredAt: e.occurredAt,
              source: entryId ? 'letterboxd' : 'catalogue',
              entryId,
            });
          }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  const latest = (
    choices.sort(
      (a, b) =>
        b.date.localeCompare(a.date) || (b.occurredAt || 0) - (a.occurredAt || 0) || (a.source === 'letterboxd' ? -1 : 1)
    )[0] || null
  );
  return latest ? { ...latest, suggested: !reviews.some(r => r.rating !== null && r.viewingEventId === latest.id) && recentUnratedViewing(latest, reviews) } : null;
}
