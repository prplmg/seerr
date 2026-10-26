import Slider from '@app/components/Slider';
import TitleCard from '@app/components/TitleCard';
import TmdbTitleCard from '@app/components/TitleCard/TmdbTitleCard';
import { ArrowRightCircleIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useInView } from 'react-intersection-observer';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

export function WatchlistCard({
  userId,
  item,
  canExpand = false,
}: {
  userId: number;
  item: { slug: string; title: string };
  canExpand?: boolean;
}) {
  const es = useIntl().locale.startsWith('es');
  const { ref, inView } = useInView({ triggerOnce: true });
  const { data, error } = useSWR<{
    resolved: boolean;
    tmdbId: number;
    mediaType: 'movie' | 'tv';
  }>(
    inView ? `/api/v1/letterboxd-watchlist/${userId}/film/${item.slug}` : null,
    { shouldRetryOnError: false, revalidateOnFocus: false }
  );
  return (
    <div ref={ref}>
      {data?.resolved ? (
        <TmdbTitleCard
          id={data.tmdbId}
          tmdbId={data.tmdbId}
          type={data.mediaType}
          canExpand={canExpand}
        />
      ) : !data && !error ? (
        <TitleCard.Placeholder canExpand={canExpand} />
      ) : (
        <div
          className={`flex flex-col justify-center rounded-lg border border-gray-700 bg-gray-800 p-4 text-white ${canExpand ? 'aspect-[2/3] w-full' : 'h-72 w-36 sm:w-44'}`}
        >
          <p className="font-semibold">{item.title}</p>
          <p className="mt-3 text-sm text-gray-300">
            {es
              ? 'No se pudo identificar este título en el catálogo.'
              : 'This title could not be matched in the catalogue.'}
          </p>
        </div>
      )}
    </div>
  );
}

export default function LetterboxdWatchlist({ userId }: { userId: number }) {
  const es = useIntl().locale.startsWith('es');
  const { data, error } = useSWR<{
    available: boolean;
    totalPages: number;
    stale?: boolean;
    results: { slug: string; title: string }[];
  }>(`/api/v1/letterboxd-watchlist/${userId}?page=1`);
  if (!data?.available)
    return error ? (
      <p className="my-4 text-yellow-300">
        {es
          ? 'La lista de Letterboxd no está disponible temporalmente.'
          : 'Letterboxd Watchlist is temporarily unavailable.'}
      </p>
    ) : null;
  return (
    <section className="my-8 text-white">
      <div className="slider-header">
        <Link
          href={`/users/${userId}/letterboxd-watchlist`}
          className="slider-title"
        >
          <span>
            {es ? 'Lista de seguimiento de Letterboxd' : 'Letterboxd Watchlist'}
          </span>
          <ArrowRightCircleIcon />
        </Link>
      </div>
      {data.stale && (
        <p className="mb-4 text-yellow-300">
          {es
            ? 'Se muestra la última lista verificada; la sincronización necesita atención.'
            : 'Showing the last verified list; synchronization needs attention.'}
        </p>
      )}
      <Slider
        sliderKey={`letterboxd-watchlist-${userId}`}
        isLoading={false}
        isEmpty={data.results.length === 0}
        emptyMessage={
          es ? 'Esta lista está vacía.' : 'This watchlist is empty.'
        }
        items={data.results.map((item) => (
          <WatchlistCard key={item.slug} userId={userId} item={item} />
        ))}
      />
    </section>
  );
}
