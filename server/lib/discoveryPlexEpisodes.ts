import type { PlexMetadata } from '@server/api/plexapi';
import { discoveryCache } from './discoverySharedCache';

// Share raw show/season reads across release and progress rows, including
// concurrent requests. Cache no user progress and never cache failed reads.
// Keep one TTL here: derived caches must not extend the age of this evidence.
const children = discoveryCache<PlexMetadata[]>(400, 60000);
export function discoveryPlexChildren(
  settingsStamp: string,
  token: string,
  ratingKey: string,
  load: () => Promise<PlexMetadata[]>
) {
  return children(JSON.stringify([settingsStamp, token, ratingKey]), load);
}
