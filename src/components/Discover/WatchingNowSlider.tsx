import CachedImage from '@app/components/Common/CachedImage';
import RequestCard from '@app/components/RequestCard';
import Slider from '@app/components/Slider';
import {
  PartyControls,
  useWatchingNow,
  WatchingPeople,
} from '@app/components/WatchParty';
import { usePartyText } from '@app/components/WatchParty/messages';
import ViewingMenu from '@app/components/WatchParty/ViewingMenu';
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
  const href = `/${item.mediaType}/${item.tmdbId}`;
  const backdrop = data?.backdropPath
    ? `https://image.tmdb.org/t/p/w780${data.backdropPath}`
    : undefined;
  const year =
    data &&
    ('releaseDate' in data ? data.releaseDate : data.firstAirDate)?.slice(0, 4);
  return (
    <article
      ref={ref}
      data-testid="watching-card"
      className="relative flex min-h-[152px] w-72 gap-3 rounded-xl bg-gray-800 bg-cover bg-center p-4 text-gray-400 shadow ring-1 ring-gray-700 sm:min-h-[200px] sm:w-96"
      style={
        backdrop
          ? {
              backgroundImage: `linear-gradient(135deg,rgba(17,24,39,.65),rgba(17,24,39,1)),url(${backdrop})`,
            }
          : undefined
      }
    >
      <ViewingMenu item={item} />
      <Link
        href={href}
        className="h-[120px] w-20 flex-none overflow-hidden rounded-md sm:h-[168px] sm:w-28"
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
          href={href}
          className="truncate pr-5 text-base font-bold text-white hover:underline sm:text-lg"
        >
          {title || '…'}
        </Link>
        {mine && (
          <span className="hidden text-[10px] text-purple-300 sm:block">
            {t('Your party', 'Tu grupo')}
          </span>
        )}
        <div className="my-1 min-h-[28px] flex-1">
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
