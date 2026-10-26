import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaRequest from '@server/entity/MediaRequest';
import { MovieReview } from '@server/entity/MovieReview';
import { User } from '@server/entity/User';
import { discoveryCache, stableDiscoveryRead } from './discoverySharedCache';

const media = discoveryCache<Media[]>(1);
const users = discoveryCache<User[]>(1);
const reviews = discoveryCache<MovieReview[]>(1);
const requests = discoveryCache<MediaRequest[]>(1);
const plexOwner = discoveryCache<Pick<User, 'id' | 'plexToken'> | null>(1);
// Credential-bearing lookup is deliberately separate from discoveryUsers.
// User.plexToken is select:false; never widen the shared user snapshot.
export const discoveryPlexOwner = () =>
  stableDiscoveryRead(() =>
    plexOwner('plex-owner', async () => {
      const owner = await getRepository(User).findOne({
        where: { id: 1 },
        select: { id: true, plexToken: true },
        loadEagerRelations: false,
      });
      return owner ? { id: owner.id, plexToken: owner.plexToken } : null;
    })
  );
// Internal immutable snapshots: callers must not mutate ORM entities.
// Jobs also call these directly. Wait/retry at the read boundary; outer
// projections still validate their original revision across multiple reads.
export const discoveryMedia = () =>
  stableDiscoveryRead(() =>
    media('media', () =>
      getRepository(Media).find({ loadEagerRelations: false })
    )
  );
export const discoveryUsers = () =>
  stableDiscoveryRead(() =>
    users('users', () =>
      getRepository(User).find({ loadEagerRelations: false })
    )
  );
export const discoveryReviews = () =>
  stableDiscoveryRead(() =>
    reviews('reviews', () => getRepository(MovieReview).find())
  );
export const discoveryRequests = () =>
  stableDiscoveryRead(() =>
    requests('requests', () =>
      getRepository(MediaRequest).find({
        loadEagerRelations: false,
        relations: { media: true, requestedBy: true },
        select: {
          id: true,
          status: true,
          createdAt: true,
          media: { id: true, mediaType: true, tmdbId: true },
          requestedBy: { id: true },
        },
      })
    )
  );
