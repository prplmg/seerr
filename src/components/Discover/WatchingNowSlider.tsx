import CachedImage from '@app/components/Common/CachedImage';
import RequestCard from '@app/components/RequestCard';
import Slider from '@app/components/Slider';
import {
  PartyControls,
  useWatchingNow,
  WatchingPeople,
} from '@app/components/WatchParty';
import { usePartyText } from '@app/components/WatchParty/messages';
import type { WatchingTitle } from '@server/interfaces/api/watchParty';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import Link from 'next/link';
import { useInView } from 'react-intersection-observer';
import useSWR from 'swr';

export function WatchingCard({ item }: { item: WatchingTitle }) {
  const t = usePartyText();
  const { ref, inView } = useInView({ triggerOnce: true });
  const { data } = useSWR<MovieDetails | TvDetails>(
    inView ? `/api/v1/${item.mediaType}/${item.tmdbId}` : null
  );
  const mine = item.parties.find((p) => p.mine);
  const title = data && ('title' in data ? data.title : data.name);
  const year =
    data &&
    ('releaseDate' in data ? data.releaseDate : data.firstAirDate)?.slice(0, 4);
  return (
    <article
      ref={ref}
      data-testid="watching-card"
      className="relative flex h-[152px] w-72 gap-3 overflow-hidden rounded-xl bg-gray-800 bg-cover bg-center p-4 text-gray-400 shadow ring-1 ring-gray-700 sm:h-[200px] sm:w-96"
      style={
        data?.backdropPath
          ? {
              backgroundImage: `linear-gradient(135deg,rgba(17,24,39,.65),rgba(17,24,39,1)),url(https://image.tmdb.org/t/p/w780${data.backdropPath})`,
            }
          : undefined
      }
    >
      <Link
        href={`/${item.mediaType}/${item.tmdbId}`}
        className="w-20 flex-none overflow-hidden rounded-md sm:w-28"
      >
        <CachedImage
          type="tmdb"
          src={
            data?.posterPath
              ? `https://image.tmdb.org/t/p/w300${data.posterPath}`
              : '/images/seerr_poster_not_found.png'
          }
          alt={title || ''}
          width={300}
          height={450}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="hidden text-xs text-white sm:block">{year}</span>
        <Link
          href={`/${item.mediaType}/${item.tmdbId}`}
          className="truncate text-base font-bold text-white hover:underline sm:text-lg"
        >
          {title || '…'}
        </Link>
        {mine && (
          <span className="text-[10px] text-purple-300">
            {t('Your party', 'Tu grupo')}
          </span>
        )}
        <div className="my-1 min-h-0 flex-1 overflow-y-auto">
          <WatchingPeople item={item} list />
        </div>
        {mine && (
          <div className="flex-none text-white">
            <PartyControls key={mine.id} party={mine} />
          </div>
        )}
      </div>
    </article>
  );
}
export default function WatchingNowSlider() {
  const t = usePartyText();
  const { data, error } = useWatchingNow();
  if (!data?.enabled || error || !data.results.length) return null;
  return (
    <section aria-label={t('Watching now', 'Viendo ahora')}>
      <div className="slider-header">
        <h2 className="slider-title">{t('Watching now', 'Viendo ahora')}</h2>
      </div>
      {(!data.activityAvailable ||
        (data.partiesEnabled && !data.relayAvailable)) && (
        <p role="status" className="mb-2 text-xs text-gray-400">
          {t(
            'Some live activity is temporarily unavailable.',
            'Parte de la actividad en vivo no está disponible temporalmente.'
          )}
        </p>
      )}
      <Slider
        sliderKey="watching-now"
        isLoading={false}
        items={data.results.map((item) => (
          <WatchingCard key={`${item.mediaType}:${item.tmdbId}`} item={item} />
        ))}
        placeholder={<RequestCard.Placeholder />}
      />
    </section>
  );
}
