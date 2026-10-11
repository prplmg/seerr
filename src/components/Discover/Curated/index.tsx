import CachedImage from '@app/components/Common/CachedImage';
import PageTitle from '@app/components/Common/PageTitle';
import Slider from '@app/components/Slider';
import TmdbTitleCard from '@app/components/TitleCard/TmdbTitleCard';
import { usePartyText } from '@app/components/WatchParty/messages';
import { ArrowRightCircleIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

type Text = { en: string; es?: string };
type Item = { type: 'movie' | 'tv'; tmdbId: number };
type Category = {
  id: string;
  title: Text;
  description: Text;
  count: number;
  cover: Item;
  covers?: Item[];
};
function useText() {
  const { locale } = useIntl();
  return (value: Text) =>
    /^es(?:-|$)/i.test(locale) ? value.es || value.en : value.en;
}
function CategoryCard({
  category,
  fullWidth = false,
}: {
  category: Category;
  fullWidth?: boolean;
}) {
  const text = useText();
  const { ref, inView } = useInView({ triggerOnce: true });
  const [coverIndex, setCoverIndex] = useState(0);
  const [failedBackdrop, setFailedBackdrop] = useState(false);
  const candidates = category.covers ?? [category.cover];
  const cover = candidates[coverIndex];
  const { data, error } = useSWR<{
    backdropPath?: string;
    posterPath?: string;
  }>(inView && cover ? `/api/v1/${cover.type}/${cover.tmdbId}` : null, {
    revalidateOnFocus: false,
  });
  const image =
    !failedBackdrop && data?.backdropPath
      ? data.backdropPath
      : data?.posterPath;
  useEffect(() => {
    if (cover && (error || (data && !image))) {
      setCoverIndex((i) => i + 1);
      setFailedBackdrop(false);
    }
  }, [cover, error, data, image]);
  return (
    <Link
      ref={ref}
      href={`/discover/curated/${category.id}`}
      className={`relative flex min-h-48 ${fullWidth ? 'w-full' : 'w-72 sm:w-80'} flex-col justify-end overflow-hidden whitespace-normal break-words rounded-xl bg-gray-800 p-5 ring-1 ring-gray-700 hover:ring-purple-400 focus-visible:ring-purple-400`}
    >
      {image && (
        <CachedImage
          type="tmdb"
          src={`https://image.tmdb.org/t/p/w780${image}`}
          alt=""
          fill
          style={{ objectFit: 'cover' }}
          onError={() => {
            if (!failedBackdrop && data?.backdropPath && data.posterPath)
              setFailedBackdrop(true);
            else {
              setCoverIndex((i) => i + 1);
              setFailedBackdrop(false);
            }
          }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/80 to-gray-900/40" />
      <div className="relative text-white">
        <h3 className="text-lg font-bold leading-tight">
          {text(category.title)}
        </h3>
        <p className="mt-2 text-sm text-gray-200">
          {text(category.description)}
        </p>
      </div>
    </Link>
  );
}
export default function CuratedSlider() {
  const t = usePartyText();
  const { data, error } = useSWR<{ day: string; results: Category[] }>(
    '/api/v1/curated',
    { refreshInterval: 60000, revalidateOnFocus: true }
  );
  return (
    <section aria-label={t('Curated Lists', 'Listas seleccionadas')}>
      <div className="slider-header">
        <h2>
          <Link href="/discover/curated" className="slider-title">
            <span>{t('Curated Lists', 'Listas seleccionadas')}</span>
            <ArrowRightCircleIcon />
          </Link>
        </h2>
      </div>
      {error ? (
        <p role="status" className="text-gray-300">
          {t(
            'Curated Lists are temporarily unavailable.',
            'Las listas seleccionadas no están disponibles temporalmente.'
          )}
        </p>
      ) : (
        <Slider
          stretchItems
          sliderKey={`curated-${data?.day ?? 'loading'}`}
          isLoading={!data}
          placeholder={
            <div className="h-48 w-72 animate-pulse rounded-xl bg-gray-800" />
          }
          items={data?.results.map((category) => (
            <CategoryCard key={category.id} category={category} />
          ))}
        />
      )}
    </section>
  );
}
export function CuratedCategoriesPage() {
  const t = usePartyText();
  const { data, error } = useSWR<{ day: string; results: Category[] }>(
    '/api/v1/curated?limit=25',
    { refreshInterval: 60000, revalidateOnFocus: true }
  );
  return (
    <>
      <PageTitle title={t('Curated Lists', 'Listas seleccionadas')} />
      <Link href="/" className="text-purple-300 hover:underline">
        {t('Back to catalogue', 'Volver al catálogo')}
      </Link>
      <div className="my-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-white">
          {t('Curated Lists', 'Listas seleccionadas')}
        </h1>
      </div>
      <p className="mb-6 text-gray-300">
        {t(
          'Today’s categories: the catalogue picks, plus ten more to explore. Rotates every day.',
          'Las categorías de hoy: las del catálogo y diez más para explorar. Cambia cada día.'
        )}
      </p>
      {error ? (
        <p role="alert">
          {t(
            'Curated Lists are temporarily unavailable.',
            'Las listas seleccionadas no están disponibles temporalmente.'
          )}
        </p>
      ) : !data ? (
        <p role="status">{t('Loading…', 'Cargando…')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.results.map((category) => (
            <CategoryCard key={category.id} category={category} fullWidth />
          ))}
        </div>
      )}
    </>
  );
}
export function CuratedPage() {
  const router = useRouter();
  const t = usePartyText();
  const text = useText();
  const id = typeof router.query.id === 'string' ? router.query.id : undefined;
  const { data, error } = useSWR<Category & { items: Item[] }>(
    id ? `/api/v1/curated/${encodeURIComponent(id)}` : null
  );
  const [limit, setLimit] = useState(20);
  const { ref, inView } = useInView();
  useEffect(() => {
    setLimit(20);
  }, [id]);
  useEffect(() => {
    if (inView) setLimit((n) => Math.min(n + 20, data?.items.length ?? n));
  }, [inView, data?.items.length]);
  if (error)
    return (
      <p role="alert">
        {t(
          'This collection could not be loaded.',
          'No se pudo cargar esta colección.'
        )}
      </p>
    );
  if (!data) return <p role="status">{t('Loading…', 'Cargando…')}</p>;
  return (
    <>
      <PageTitle title={text(data.title)} />
      <Link href="/" className="text-purple-300 hover:underline">
        {t('Back to catalogue', 'Volver al catálogo')}
      </Link>
      <h1 className="mt-4 text-3xl font-bold text-white">{text(data.title)}</h1>
      <p className="mb-6 mt-3 max-w-3xl text-gray-300">
        {text(data.description)}
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {data.items.slice(0, limit).map((item, index) => (
          <TmdbTitleCard
            key={`${item.type}-${item.tmdbId}-${index}`}
            id={item.tmdbId}
            tmdbId={item.tmdbId}
            type={item.type}
            canExpand
          />
        ))}
      </div>
      {limit < data.items.length && (
        <button
          ref={ref}
          className="my-6 rounded-lg border border-gray-600 px-4 py-2 text-white"
          onClick={() => setLimit((n) => n + 20)}
        >
          {t('Load more', 'Cargar más')}
        </button>
      )}
    </>
  );
}
