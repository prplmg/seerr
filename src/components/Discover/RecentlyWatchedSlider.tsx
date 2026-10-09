import Link from 'next/link';
import { ArrowRightCircleIcon } from '@heroicons/react/24/outline';
import Slider from '@app/components/Slider';
import TmdbTitleCard from '@app/components/TitleCard/TmdbTitleCard';
import catalogueMessages from '@app/components/Discover/catalogueMessages';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

type RecentResponse = {
  enabled: boolean;
  results: { id: number; tmdbId: number; tvdbId?: number; mediaType: 'movie' | 'tv' }[];
};

export default function RecentlyWatchedSlider() {
  const intl = useIntl();
  const { data, error } = useSWR<RecentResponse>('/api/v1/social/recently-watched', {
    refreshInterval: 120000,
    dedupingInterval: 120000,
    revalidateOnFocus: false,
  });
  if (data && !data.enabled) return null;
  return (
    <>
      <div className="slider-header"><Link href="/discover/recently-watched" className="slider-title"><span>{intl.formatMessage(catalogueMessages.recentlyWatched)}</span><ArrowRightCircleIcon /></Link></div>
      {error ? <p className="mb-6 text-sm text-gray-400" role="status">{intl.formatMessage(catalogueMessages.historyError)}</p> :
        data && !data.results.length ? <p className="mb-6 text-sm text-gray-400">{intl.formatMessage(catalogueMessages.emptyHistory)}</p> :
        <Slider sliderKey="recently-watched" isLoading={!data} items={(data?.results ?? []).map(item => (
          <TmdbTitleCard key={`recently-watched-${item.id}`} id={item.id} tmdbId={item.tmdbId} tvdbId={item.tvdbId} type={item.mediaType} />
        ))} />}
    </>
  );
}
