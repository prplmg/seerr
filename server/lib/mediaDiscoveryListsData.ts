import { MediaStatus } from '@server/constants/media';
import { appDataPath } from '@server/utils/appDataVolume';
import path from 'path';
import { discoveryMedia } from './discoveryDatabaseCache';
import { readListStore, type ListFilm, type ListStore } from './discoveryLists';
import {
  discoveryCache,
  discoveryFileStamp,
  stableDiscoveryRead,
} from './discoverySharedCache';
import { mediaDiscoveryLists } from './mediaDiscoveryLists';

const snapshots = discoveryCache<ListStore>(1, 15000);
const memberships = discoveryCache<ReturnType<typeof mediaDiscoveryLists>>(
  128,
  15000
);

/** Local-only lookup. File replacements and DB writes invalidate cached results. */
export function mediaDiscoveryListsData(viewerId: number, film: ListFilm) {
  return stableDiscoveryRead(async () => {
    const stamp = discoveryFileStamp([
      path.join(appDataPath(), 'discovery-lists.json'),
    ]);
    return memberships(
      JSON.stringify([viewerId, film.type, film.tmdbId, stamp]),
      async () => {
        const [store, media] = await Promise.all([
          snapshots(stamp, async () => readListStore()),
          discoveryMedia(),
        ]);
        const blocked = new Set(
          media
            .filter(
              (m) =>
                m.status === MediaStatus.BLOCKLISTED ||
                m.status4k === MediaStatus.BLOCKLISTED
            )
            .map((m) => `${m.mediaType}:${m.tmdbId}`)
        );
        return mediaDiscoveryLists(store, viewerId, film, Date.now(), blocked);
      }
    );
  });
}
