import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import StarPicker from '@app/components/Reviews/StarPicker';
import Slider from '@app/components/Slider';
import { usePartyText } from '@app/components/WatchParty/messages';
import { useUser } from '@app/hooks/useUser';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import useSWR, { useSWRConfig } from 'swr';

type Review = {
  id: string;
  userId: number;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  episodeName?: string | null;
  source: 'local' | 'letterboxd';
  rating: number | null;
  text: string;
  spoiler: boolean;
  syncToLetterboxd?: boolean;
  syncedToLetterboxd?: boolean;
  syncingToLetterboxd?: boolean;
  publishedAt: string;
  externalUrl: string | null;
  watchedDate?: string | null;
  externalEntryId?: string | null;
  user?: { id: number; name: string; avatar: string };
};
function reviewHref(review: Review) {
  const episode =
    review.episodeNumber != null
      ? `?reviewSeason=${review.seasonNumber}&reviewEpisode=${review.episodeNumber}`
      : '';
  return `/${review.mediaType || 'movie'}/${review.tmdbId}${episode}#review-${review.id}`;
}
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
      <span
        className="text-xs decoration-green-400"
        style={
          review.source === 'local' && review.syncedToLetterboxd
            ? {
                textDecorationLine: 'underline',
                textDecorationThickness: '2px',
                textUnderlineOffset: '3px',
              }
            : undefined
        }
        aria-label={
          review.source === 'local' && review.syncedToLetterboxd
            ? t(
                'Multimeldia · synced to Letterboxd',
                'Multimeldia · sincronizada con Letterboxd'
              )
            : undefined
        }
      >
        {review.source === 'letterboxd'
          ? 'Letterboxd'
          : t('Multimeldia', 'Multimeldia')}
      </span>
    </span>
  );
}
function CompactExcerpt({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState(5);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () =>
      setLines(Math.max(0, Math.min(5, Math.floor(element.clientHeight / 20))));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="mt-2 min-h-0 flex-1 overflow-hidden">
      {lines > 0 && (
        <p
          className="whitespace-pre-wrap break-words text-sm text-gray-100"
          style={{
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: lines,
            lineHeight: '20px',
            maxHeight: lines * 20,
            overflow: 'hidden',
          }}
        >
          {text}
        </p>
      )}
    </div>
  );
}
function ReviewMetadata({
  review,
  compactEpisode = false,
}: {
  review: Review;
  compactEpisode?: boolean;
}) {
  return (
    <>
      <div
        className={`${compactEpisode ? '' : review.episodeNumber != null ? 'mb-1' : 'mb-2'} flex flex-none flex-wrap items-center gap-2 text-sm text-gray-300`}
      >
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
        <time dateTime={review.watchedDate || review.publishedAt}>
          {review.watchedDate || review.publishedAt.slice(0, 10)}
        </time>
      </div>
      <Rating review={review} />
    </>
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
      {!compact && <ReviewMetadata review={review} />}
      {review.spoiler && !revealed ? (
        <div
          className={compact ? 'mt-2 min-h-0 flex-1 overflow-hidden' : 'mt-3'}
        >
          <button
            className="max-w-full whitespace-normal break-words text-left text-purple-300 underline"
            onClick={() => setRevealed(true)}
          >
            {t('Contains spoilers — reveal', 'Contiene spoilers — mostrar')}
          </button>
        </div>
      ) : compact ? (
        <CompactExcerpt text={review.text} />
      ) : (
        <p className="mt-3 whitespace-pre-wrap break-words text-gray-100">
          {review.text}
        </p>
      )}
      {compact ? (
        <Link
          href={reviewHref(review)}
          className="mt-auto inline-block flex-none pt-1 text-purple-300 hover:underline"
        >
          {t('Read more', 'Leer más')}
        </Link>
      ) : null}
    </>
  );
}
export function MovieReviews({
  movieId,
  mediaType = 'movie',
  seasonNumber,
  episodeNumber,
  onSaved,
}: {
  movieId: number;
  mediaType?: 'movie' | 'tv';
  seasonNumber?: number;
  episodeNumber?: number;
  onSaved?: () => void;
}) {
  const scope =
    episodeNumber !== undefined
      ? `&seasonNumber=${seasonNumber}&episodeNumber=${episodeNumber}`
      : '';
  const t = usePartyText(),
    { user } = useUser(),
    router = useRouter();
  const [page, setPage] = useState(1),
    [editing, setEditing] = useState(false),
    [rating, setRating] = useState(''),
    [text, setText] = useState(''),
    [spoiler, setSpoiler] = useState(false),
    [syncToLetterboxd, setSyncToLetterboxd] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [viewingId, setViewingId] = useState<string | null | undefined>();
  const {
    data,
    mutate,
    error: loadError,
  } = useSWR<{ results: Review[]; total: number }>(
    `/api/v1/reviews?movieId=${movieId}&mediaType=${mediaType}${scope}&page=${page}`,
    {
      refreshInterval: (data) =>
        data?.results.some(
          (r) =>
            r.source === 'local' && r.syncToLetterboxd && !r.syncedToLetterboxd
        )
          ? 15000
          : 0,
    }
  );
  const { data: mine, mutate: refreshMine } = useSWR<{
    review: Review | null;
    entries: Review[];
    latestViewing: {
      id: string;
      date: string;
      source: 'catalogue' | 'letterboxd';
    } | null;
    publishing?: {
      enabled: boolean;
      schedule: { times: string[] | null; timeZone: string };
    };
  }>(
    user
      ? `/api/v1/reviews/mine/${movieId}?mediaType=${mediaType}${scope}`
      : null
  );
  const hash = router.asPath.split('#review-')[1];
  useEffect(() => {
    if (router.asPath.split('#')[1] !== 'reviews') return;
    const frame = requestAnimationFrame(() =>
      document.getElementById('reviews')?.scrollIntoView({ block: 'start' })
    );
    return () => cancelAnimationFrame(frame);
  }, [router.asPath]);
  const { data: focused } = useSWR<{ review: Review | null }>(
    hash ? `/api/v1/reviews/entry/${encodeURIComponent(hash)}` : null,
    {
      refreshInterval: (data) =>
        data?.review?.source === 'local' &&
        data.review.syncToLetterboxd &&
        !data.review.syncedToLetterboxd
          ? 15000
          : 0,
    }
  );
  const scrolledReview = useRef<string | undefined>(undefined);
  useEffect(() => {
    setPage(1);
    setEditing(false);
  }, [movieId, mediaType, seasonNumber, episodeNumber]);
  useEffect(() => {
    if (!hash) {
      scrolledReview.current = undefined;
      return;
    }
    if (data && scrolledReview.current !== hash)
      requestAnimationFrame(() => {
        const element = document.getElementById(`review-${hash}`);
        if (element) {
          element.scrollIntoView({ block: 'center' });
          scrolledReview.current = hash;
        }
      });
  }, [hash, data, focused]);
  const rows = [
    ...(focused?.review?.tmdbId === movieId &&
    focused.review.mediaType === mediaType &&
    (focused.review.episodeNumber ?? undefined) === episodeNumber &&
    (focused.review.seasonNumber ?? undefined) === seasonNumber &&
    !data?.results.some((r) => r.id === focused.review?.id)
      ? [focused.review]
      : []),
    ...(data?.results || []),
  ];
  function startEditing(review?: Review) {
    const base = `local:${user!.id}:${mediaType === 'tv' ? 'tv:' : ''}${movieId}${episodeNumber !== undefined ? `:s${seasonNumber}:e${episodeNumber}` : ''}`;
    setEditingId(review?.id || `${base}:${crypto.randomUUID()}`);
    setRating(review?.rating?.toString() || '');
    setText(review?.text || '');
    setSpoiler(review?.spoiler || false);
    setSyncToLetterboxd(
      review
        ? review.syncToLetterboxd === true
        : mine?.publishing?.enabled === true
    );
    setViewingId(review ? undefined : null);
    setEditing(true);
  }
  const { mutate: refreshCache } = useSWRConfig();
  async function save(remove = false) {
    setBusy(true);
    setError(false);
    try {
      if (remove)
        await axios.delete(
          `/api/v1/reviews/mine/${movieId}?mediaType=${mediaType}${scope}&entryId=${encodeURIComponent(editingId!)}`
        );
      else
        await axios.put(
          `/api/v1/reviews/mine/${movieId}?mediaType=${mediaType}${scope}&entryId=${encodeURIComponent(editingId!)}`,
          {
            rating: rating ? Number(rating) : null,
            text,
            spoiler,
            viewingId,
            syncToLetterboxd: Boolean(
              mine?.publishing?.enabled && syncToLetterboxd
            ),
          }
        );
      await Promise.all([
        mutate(),
        refreshMine(),
        refreshCache(
          `/api/v1/reviews/average/${movieId}?mediaType=${mediaType}`
        ),
      ]);
      onSaved?.();
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
          {t('Ratings and reviews', 'Calificaciones y reseñas')}
        </h2>
        {user && (
          <Button disabled={!mine} onClick={() => startEditing()}>
            {t('Rate or review', 'Calificar o escribir una reseña')}
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
          <StarPicker value={rating} onChange={setRating} disabled={busy} />
          {episodeNumber === undefined && (
            <label className="block text-sm">
              {t('Associate with a viewing', 'Asociar con una visualización')}
              <select
                className="mt-2 w-full rounded bg-gray-900 p-3"
                value={viewingId === undefined ? 'existing' : viewingId || ''}
                onChange={(e) =>
                  setViewingId(
                    e.target.value === 'existing'
                      ? undefined
                      : e.target.value || null
                  )
                }
              >
                {mine?.entries?.some((r) => r.id === editingId) && (
                  <option value="existing">
                    {t(
                      'Keep existing association',
                      'Mantener asociación actual'
                    )}
                  </option>
                )}
                <option value="">
                  {t('Keep undated', 'Sin fecha de visualización')}
                </option>
                {mediaType === 'movie' && (
                  <option value="new-diary">
                    {t('Log new viewing', 'Registrar nueva visualización')}
                  </option>
                )}
                {mine?.latestViewing && (
                  <option value={mine.latestViewing.id}>
                    {t('Latest viewing', 'Última visualización')} ·{' '}
                    {mine.latestViewing.date} ·{' '}
                    {mine.latestViewing.source === 'letterboxd'
                      ? 'Letterboxd'
                      : 'Multimeldia'}
                  </option>
                )}
              </select>
              {(viewingId === 'new-diary' ||
                (viewingId && mine?.latestViewing?.source === 'catalogue')) && (
                <span className="mt-1 block text-gray-400">
                  {t(
                    'If synced, this creates a dated Letterboxd diary entry.',
                    'Al sincronizar, se creará una entrada con fecha en el diario de Letterboxd.'
                  )}
                </span>
              )}
            </label>
          )}
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
          {mine?.publishing?.enabled && (
            <div className="space-y-2 rounded-lg bg-gray-900 p-3 text-sm text-gray-300">
              <label className="flex items-center gap-2 text-white">
                <input
                  type="checkbox"
                  checked={syncToLetterboxd}
                  disabled={busy}
                  onChange={(e) => setSyncToLetterboxd(e.target.checked)}
                />
                {t('Sync to Letterboxd', 'Sincronizar con Letterboxd')}
              </label>
            </div>
          )}
          <p className="text-sm text-gray-300">
            {mine?.publishing?.enabled
              ? t(
                  'Visible to multimeldia members.',
                  'Visible para los miembros de multimeldia.'
                )
              : t(
                  'Visible to multimeldia members. Letterboxd publishing is not enabled for this review.',
                  'Visible para los miembros de multimeldia. La publicación en Letterboxd no está habilitada para esta reseña.'
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
            {mine?.entries?.some((r) => r.id === editingId) && (
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
          {t(
            'No ratings or reviews yet.',
            'Todavía no hay calificaciones ni reseñas.'
          )}
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
              {(r.source === 'local' && r.userId === user?.id) ||
              r.syncedToLetterboxd ||
              r.externalUrl ? (
                <div className="mt-3 flex items-center justify-between gap-x-3">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
                    {r.source === 'local' && r.userId === user?.id && (
                      <button
                        className="text-purple-300 hover:underline"
                        onClick={() => startEditing(r)}
                      >
                        {t('Edit this entry', 'Editar esta entrada')}
                      </button>
                    )}
                    {r.externalUrl && (
                      <a
                        className="text-green-400 hover:underline"
                        href={r.externalUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('Open in Letterboxd ↗', 'Abrir en Letterboxd ↗')}
                      </a>
                    )}
                  </div>
                  {r.syncingToLetterboxd && !r.syncedToLetterboxd ? (
                    <span
                      role="status"
                      aria-label={t(
                        'Syncing with Letterboxd…',
                        'Sincronizando con Letterboxd…'
                      )}
                      title={t(
                        'Syncing with Letterboxd…',
                        'Sincronizando con Letterboxd…'
                      )}
                      className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-right text-sm text-gray-400"
                    >
                      <span
                        aria-hidden="true"
                        className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-gray-600 border-t-gray-300 motion-reduce:animate-none"
                      />
                      <span aria-hidden="true" className="sm:hidden">
                        {t('Syncing…', 'Sincronizando…')}
                      </span>
                      <span aria-hidden="true" className="hidden sm:inline">
                        {t(
                          'Syncing with Letterboxd…',
                          'Sincronizando con Letterboxd…'
                        )}
                      </span>
                    </span>
                  ) : (
                    r.syncedToLetterboxd &&
                    !r.externalUrl && (
                      <span className="ml-auto text-right text-gray-400">
                        {t(
                          'Synced with Letterboxd',
                          'Sincronizado con Letterboxd'
                        )}
                      </span>
                    )
                  )}
                </div>
              ) : null}
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
  const { ref, inView } = useInView({ triggerOnce: true });
  const { data } = useSWR<{
    title?: string;
    name?: string;
    posterPath: string;
  }>(
    inView
      ? `/api/v1/${review.mediaType || 'movie'}/${review.tmdbId}?view=card`
      : null
  );
  return (
    <article
      ref={ref}
      className="flex h-[260px] w-80 flex-none flex-col overflow-hidden whitespace-normal rounded-xl bg-gray-800 p-4 text-white ring-1 ring-gray-700 sm:h-[240px] sm:w-[440px]"
    >
      <div className="flex flex-none items-end gap-3">
        <Link href={reviewHref(review)} className="flex-none">
          <CachedImage
            type="tmdb"
            src={
              data?.posterPath
                ? `https://image.tmdb.org/t/p/w300${data.posterPath}`
                : '/images/seerr_poster_not_found.png'
            }
            alt={data?.title || data?.name || ''}
            width={300}
            height={450}
            className="block h-[92px] w-auto rounded-md"
          />
        </Link>
        <div
          className={`flex min-h-0 min-w-0 flex-1 flex-col ${review.episodeNumber != null ? 'gap-1 leading-5' : ''}`}
        >
          <Link
            href={reviewHref(review)}
            className={`${review.episodeNumber != null ? 'leading-5' : 'mb-2'} block flex-none truncate text-lg font-bold hover:underline`}
          >
            {data?.title || data?.name || '…'}
          </Link>
          {review.episodeNumber != null && (
            <div
              className="truncate text-xs leading-4 text-gray-200"
              title={review.episodeName || ''}
            >
              S{String(review.seasonNumber).padStart(2, '0')}E
              {String(review.episodeNumber).padStart(2, '0')} ·{' '}
              {review.episodeName}
            </div>
          )}
          <ReviewMetadata
            review={review}
            compactEpisode={review.episodeNumber != null}
          />
        </div>
      </div>
      <ReviewBody review={review} compact />
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
