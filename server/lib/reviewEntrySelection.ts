import { getRepository } from '@server/datasource';
import { MovieReview } from '@server/entity/MovieReview';
import { appDataPath } from '@server/utils/appDataVolume';
import fs from 'fs';
import path from 'path';
import { letterboxdEntryIdentity } from './letterboxdImport';
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
};
export async function latestReviewViewing(
  userId: number,
  tmdbId: number,
  mediaType: 'movie' | 'tv'
): Promise<ViewingChoice | null> {
  const choices: ViewingChoice[] = [];
  for (const r of await getRepository(MovieReview).findBy({
    userId,
    tmdbId,
    mediaType,
    source: 'letterboxd',
  })) {
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
            choices.push({
              id: e.id,
              date: e.watchedDate,
              source: receipt ? 'letterboxd' : 'catalogue',
              entryId: receipt?.entryId || null,
            });
          }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  return (
    choices.sort(
      (a, b) =>
        b.date.localeCompare(a.date) || (a.source === 'letterboxd' ? -1 : 1)
    )[0] || null
  );
}
