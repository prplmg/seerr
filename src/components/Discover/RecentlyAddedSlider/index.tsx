import Link from 'next/link';
import { ArrowRightCircleIcon } from '@heroicons/react/24/outline';
import Slider from '@app/components/Slider';
import TmdbTitleCard from '@app/components/TitleCard/TmdbTitleCard';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import type Media from '@server/entity/Media';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Discover.RecentlyAddedSlider', {
  recentlyAdded: 'Recently Added',
});

const RecentlyAddedSlider = () => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const { data: media, error: mediaError } = useSWR<{ results: Media[] }>(
    '/api/v1/media/plex-library?type=all&page=1',
    { revalidateOnMount: true }
  );

  if (
    (media && !media.results.length && !mediaError) ||
    !hasPermission([Permission.MANAGE_REQUESTS, Permission.RECENT_VIEW], {
      type: 'or',
    })
  ) {
    return null;
  }

  return (
    <>
      <div className="slider-header">
        <Link href="/discover/recently-added" className="slider-title">
          <span>{intl.formatMessage(messages.recentlyAdded)}</span>
          <ArrowRightCircleIcon />
        </Link>
      </div>
      <Slider
        sliderKey="media"
        isLoading={!media}
        items={(media?.results ?? []).map((item) => (
          <TmdbTitleCard
            key={`media-slider-item-${item.id}`}
            id={item.id}
            tmdbId={item.tmdbId}
            tvdbId={item.tvdbId}
            type={item.mediaType}
          />
        ))}
      />
    </>
  );
};

export default RecentlyAddedSlider;
