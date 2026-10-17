import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import Slider from '@app/components/Slider';
import { usePartyText } from '@app/components/WatchParty/messages';
import { useUser } from '@app/hooks/useUser';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

type Review = {
  id: string;
  userId: number;
  tmdbId: number;
  source: 'local' | 'letterboxd';
  rating: number | null;
  text: string;
  spoiler: boolean;
  publishedAt: string;
  externalUrl: string | null;
  user?: { id: number; name: string; avatar: string };
};
function Rating({ review }: { review: Review }) {
  const t = usePartyText();
  return (
    <span
      className={
        review.source === 'letterboxd' ? 'text-green-400' : 'text-purple-300'
      }
    >
      {review.rating !== null && (
        <span
          aria-label={`${review.rating} / 5`}
          className="mr-2 inline-flex items-center gap-2"
        >
          <span
            aria-hidden="true"
            className="relative inline-block leading-none"
          >
            <span className="text-gray-500">★★★★★</span>
            <span
              className="absolute inset-y-0 left-0 overflow-hidden whitespace-nowrap"
              style={{ width: `${review.rating * 20}%` }}
            >
              ★★★★★
            </span>
          </span>
          <span>{review.rating}/5</span>
        </span>
      )}
      <span className="text-xs">
        {review.source === 'letterboxd'
          ? 'Letterboxd'
          : t('Multimeldia', 'Multimeldia')}
      </span>
    </span>
  );
}
function ReviewBody({
  review,
  compact = false,
}: {
  review: Review;
  compact?: boolean;
}) {
  const t = usePartyText(),
    [revealed, setRevealed] = useState(false);
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-gray-300">
        {review.user && (
          <Link
            href={`/users/${review.user.id}`}
            className="flex items-center gap-2 text-white hover:underline"
          >
            <CachedImage
              type="avatar"
              src={review.user.avatar}
              alt=""
              width={24}
              height={24}
              className="h-6 w-6 rounded-full"
            />
            {review.user.name}
          </Link>
        )}
        <time dateTime={review.publishedAt}>
          {review.publishedAt.slice(0, 10)}
        </time>
      </div>
      <Rating review={review} />
      {review.spoiler && !revealed ? (
        <div className="mt-3">
          <button
            className="text-purple-300 underline"
            onClick={() => setRevealed(true)}
          >
            {t('Contains spoilers — reveal', 'Contiene spoilers — mostrar')}
          </button>
        </div>
      ) : (
        <p
          className={`mt-3 whitespace-pre-wrap break-words text-gray-100 ${compact ? 'line-clamp-3 text-sm' : ''}`}
        >
          {review.text}
        </p>
      )}
      {compact ? (
        <Link
          href={`/movie/${review.tmdbId}#review-${review.id}`}
          className="mt-2 inline-block text-purple-300 hover:underline"
        >
          {t('Read more', 'Leer más')}
        </Link>
      ) : (
        review.externalUrl && (
          <a
            className="mt-3 inline-block text-green-400 hover:underline"
            href={review.externalUrl}
            target="_blank"
            rel="noreferrer"
          >
            {t('Read on Letterboxd ↗', 'Leer en Letterboxd ↗')}
          </a>
        )
      )}
    </>
  );
}
export function MovieReviews({ movieId }: { movieId: number }) {
  const t = usePartyText(),
    { user } = useUser(),
    router = useRouter();
  const [page, setPage] = useState(1),
    [editing, setEditing] = useState(false),
    [rating, setRating] = useState(''),
    [text, setText] = useState(''),
    [spoiler, setSpoiler] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const {
    data,
    mutate,
    error: loadError,
  } = useSWR<{ results: Review[]; total: number }>(
    `/api/v1/reviews?movieId=${movieId}&page=${page}`
  );
  const { data: mine, mutate: refreshMine } = useSWR<{ review: Review | null }>(
    user ? `/api/v1/reviews/mine/${movieId}` : null
  );
  const hash = router.asPath.split('#review-')[1];
  const { data: focused } = useSWR<{ review: Review | null }>(
    hash ? `/api/v1/reviews/entry/${encodeURIComponent(hash)}` : null
  );
  useEffect(() => {
    setPage(1);
    setEditing(false);
  }, [movieId]);
  useEffect(() => {
    if (hash && data)
      requestAnimationFrame(() =>
        document
          .getElementById(`review-${hash}`)
          ?.scrollIntoView({ block: 'center' })
      );
  }, [hash, data, focused]);
  const rows = [
    ...(focused?.review?.tmdbId === movieId &&
    !data?.results.some((r) => r.id === focused.review?.id)
      ? [focused.review]
      : []),
    ...(data?.results || []),
  ];
  async function save(remove = false) {
    setBusy(true);
    setError(false);
    try {
      if (remove) await axios.delete(`/api/v1/reviews/mine/${movieId}`);
      else
        await axios.put(`/api/v1/reviews/mine/${movieId}`, {
          rating: rating ? Number(rating) : null,
          text,
          spoiler,
        });
      await Promise.all([mutate(), refreshMine()]);
      setEditing(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="reviews" className="my-8 w-full text-white">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-overseerr text-2xl font-bold">
          {t('Reviews', 'Reseñas')}
        </h2>
        {user && (
          <Button
            disabled={!mine}
            onClick={() => {
              setRating(mine?.review?.rating?.toString() || '');
              setText(mine?.review?.text || '');
              setSpoiler(mine?.review?.spoiler || false);
              setEditing(true);
            }}
          >
            {mine?.review
              ? t('Edit your review', 'Editar tu reseña')
              : t('Write a review', 'Escribir una reseña')}
          </Button>
        )}
      </div>
      {editing && (
        <form
          className="mb-6 space-y-4 rounded-xl border border-purple-400/50 bg-gray-800 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="block">
            {t('Rating', 'Calificación')}
            <select
              className="ml-3 rounded bg-gray-900 p-2 text-purple-300"
              value={rating}
              onChange={(e) => setRating(e.target.value)}
            >
              <option value="">{t('No rating', 'Sin calificación')}</option>
              {Array.from({ length: 10 }, (_, i) => (i + 1) / 2).map((n) => (
                <option key={n} value={n}>
                  {n} / 5
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            {t('Your review (optional)', 'Tu reseña (opcional)')}
            <textarea
              rows={5}
              maxLength={20000}
              className="mt-2 w-full rounded bg-gray-900 p-3 text-white"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={spoiler}
              onChange={(e) => setSpoiler(e.target.checked)}
            />
            {t('Contains spoilers', 'Contiene spoilers')}
          </label>
          <p className="text-sm text-gray-300">
            {t(
              'Visible to catalogue members. This does not publish to Letterboxd.',
              'Visible para los miembros del catálogo. Esto no publica en Letterboxd.'
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              buttonType="primary"
              disabled={busy || (!rating && !text.trim())}
              type="submit"
            >
              {t('Save', 'Guardar')}
            </Button>
            <Button
              disabled={busy}
              type="button"
              onClick={() => setEditing(false)}
            >
              {t('Cancel', 'Cancelar')}
            </Button>
            {mine?.review && (
              <Button
                buttonType="danger"
                disabled={busy}
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      t('Delete your review?', '¿Eliminar tu reseña?')
                    )
                  )
                    void save(true);
                }}
              >
                {t('Delete', 'Eliminar')}
              </Button>
            )}
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-red-300">
          {t(
            'Could not save your review. Try again.',
            'No se pudo guardar tu reseña. Inténtalo de nuevo.'
          )}
        </p>
      )}
      {loadError ? (
        <p role="alert" className="text-red-300">
          {t(
            'Reviews could not be loaded. Please try again.',
            'No se pudieron cargar las reseñas. Inténtalo de nuevo.'
          )}
        </p>
      ) : !data ? (
        <p>{t('Loading reviews…', 'Cargando reseñas…')}</p>
      ) : !rows.length ? (
        <p className="text-gray-300">
          {t('No reviews yet.', 'Todavía no hay reseñas.')}
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((r) => (
            <article
              id={`review-${r.id}`}
              key={r.id}
              className="scroll-mt-24 rounded-xl border border-gray-700 bg-gray-800 p-4"
            >
              <ReviewBody review={r} />
            </article>
          ))}
        </div>
      )}
      {data && data.total > 20 && (
        <div className="mt-4 flex gap-2">
          <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
            {t('Previous', 'Anterior')}
          </Button>
          <Button
            disabled={page * 20 >= data.total}
            onClick={() => setPage(page + 1)}
          >
            {t('Next', 'Siguiente')}
          </Button>
        </div>
      )}
    </section>
  );
}
function ReviewCard({ review }: { review: Review }) {
  const { data } = useSWR<{ title: string; posterPath: string }>(
    `/api/v1/movie/${review.tmdbId}`
  );
  return (
    <article className="flex min-h-[200px] w-80 gap-3 rounded-xl bg-gray-800 p-4 text-white ring-1 ring-gray-700 sm:w-[440px]">
      <Link
        href={`/movie/${review.tmdbId}#review-${review.id}`}
        className="w-20 flex-none sm:w-28"
      >
        <CachedImage
          type="tmdb"
          src={
            data?.posterPath
              ? `https://image.tmdb.org/t/p/w300${data.posterPath}`
              : '/images/seerr_poster_not_found.png'
          }
          alt={data?.title || ''}
          width={300}
          height={450}
          className="rounded-md"
        />
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          href={`/movie/${review.tmdbId}#review-${review.id}`}
          className="mb-2 block truncate text-lg font-bold hover:underline"
        >
          {data?.title || '…'}
        </Link>
        <ReviewBody review={review} compact />
      </div>
    </article>
  );
}
export function RecentReviews({ days = 28 }: { days?: number }) {
  const t = usePartyText(),
    { data, error } = useSWR<{ results: Review[] }>(
      `/api/v1/reviews?days=${days}`,
      { refreshInterval: 60000 }
    );
  return (
    <section className="mb-6">
      <div className="slider-header">
        <h2 className="slider-title">
          {t('Recent reviews', 'Reseñas recientes')}
        </h2>
      </div>
      {error ? (
        <p className="text-gray-300">
          {t(
            'Reviews are temporarily unavailable.',
            'Las reseñas no están disponibles temporalmente.'
          )}
        </p>
      ) : (
        <Slider
          sliderKey="recent-reviews"
          isLoading={!data}
          isEmpty={!data?.results.length}
          emptyMessage={t(
            'No reviews in this period.',
            'No hay reseñas en este período.'
          )}
          items={data?.results.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        />
      )}
    </section>
  );
}
