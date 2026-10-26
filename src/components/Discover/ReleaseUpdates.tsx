import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import PageTitle from '@app/components/Common/PageTitle';
import Slider from '@app/components/Slider';
import TmdbTitleCard from '@app/components/TitleCard/TmdbTitleCard';
import { usePartyText } from '@app/components/WatchParty/messages';
import useDiscovery from '@app/hooks/useDiscovery';
import { Permission, useUser } from '@app/hooks/useUser';
import { ArrowRightCircleIcon } from '@heroicons/react/24/outline';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';

type ReleaseMetadata = {
  status?: string;
  releaseDate?: string;
  releases?: {
    results: { release_dates: { type: number; release_date: string }[] }[];
  };
  nextEpisodeToAir?: { airDate: string | null } | null;
  mediaInfo?: {
    status?: number;
    status4k?: number;
    requests?: { id: number; status: number }[];
  };
};

export function canFollowRelease(
  type: 'movie' | 'tv',
  metadata?: ReleaseMetadata,
  now = Date.now()
) {
  if (!metadata) return false;
  const future = (date?: string | null) =>
    !!date && Number.isFinite(Date.parse(date)) && Date.parse(date) > now;
  if (type === 'movie') {
    if (
      metadata.mediaInfo?.status === MediaStatus.AVAILABLE ||
      metadata.mediaInfo?.status4k === MediaStatus.AVAILABLE
    )
      return false;
    // Home release anywhere, not the theatrical date or the viewer's region.
    // Unknown/invalid dates must not prematurely hide the follow control.
    return !(metadata.releases?.results || []).some((region) =>
      region.release_dates.some(
        (release) =>
          [4, 5].includes(release.type) &&
          Number.isFinite(Date.parse(release.release_date)) &&
          Date.parse(release.release_date) <= now
      )
    );
  }
  const status = metadata.status?.toLowerCase();
  if (!status) return false;
  return (
    !['ended', 'canceled', 'cancelled'].includes(status) ||
    future(metadata.nextEpisodeToAir?.airDate)
  );
}

export function FollowReleases({
  type,
  id,
  metadata,
  compact = false,
}: {
  type: 'movie' | 'tv';
  id: number;
  metadata?: ReleaseMetadata;
  compact?: boolean;
}) {
  const { enabled, readOnly } = useDiscovery(),
    { user } = useUser(),
    t = usePartyText();
  const endpoint = `/api/v1/discovery-lists/follow/${type}/${id}`;
  const eligible =
    !!metadata?.mediaInfo?.requests?.some(
      (request) => request.status !== MediaRequestStatus.DECLINED
    ) && canFollowRelease(type, metadata);
  const requestVersion = metadata?.mediaInfo?.requests
    ?.map((r) => `${r.id}:${r.status}`)
    .sort()
    .join(',');
  const { data, mutate } = useSWR(
    enabled && !readOnly && eligible
      ? [endpoint, user?.id, requestVersion]
      : null,
    async ([url]) => (await axios.get(url)).data
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  if (readOnly || !eligible) return null;
  return (
    <span>
      {enabled && (
        <>
          <Button
            buttonType={compact ? 'ghost' : 'default'}
            className={compact ? 'mt-2 px-2 py-1 text-sm' : undefined}
            disabled={busy || !data || data.locked}
            onClick={async () => {
              setBusy(true);
              setError(false);
              try {
                await mutate(
                  (await axios.put(endpoint, { following: !data.following }))
                    .data,
                  false
                );
              } catch {
                setError(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {data?.locked
              ? type === 'movie'
                ? t('Following release', 'Siguiendo estreno')
                : t('Following releases', 'Siguiendo estrenos')
              : data?.following
                ? type === 'movie'
                  ? t('Unfollow release', 'Dejar de seguir estreno')
                  : t('Unfollow releases', 'Dejar de seguir estrenos')
                : type === 'movie'
                  ? t('Follow release', 'Seguir estreno')
                  : t('Follow releases', 'Seguir estrenos')}
          </Button>
          {error && (
            <span role="alert">
              {t(
                'Could not save. Try again.',
                'No se pudo guardar. Intenta de nuevo.'
              )}
            </span>
          )}
        </>
      )}
    </span>
  );
}
export function AdminReleaseSubscriptions({
  type,
  id,
}: {
  type: 'movie' | 'tv';
  id: number;
}) {
  const { hasPermission, user } = useUser(),
    t = usePartyText();
  const { readOnly } = useDiscovery();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState<number | null>(null),
    [error, setError] = useState(false);
  const endpoint = `/api/v1/discovery-lists/admin/follow/${type}/${id}`;
  const allowed = hasPermission(Permission.ADMIN) && !readOnly;
  const {
    data,
    mutate,
    error: loadError,
  } = useSWR<{
    users: { id: number; name: string; following: boolean; locked?: boolean }[];
  }>(
    allowed && open ? [endpoint, user?.id] : null,
    async ([url]) => (await axios.get(url)).data
  );
  if (!allowed) return null;
  return (
    <div className="min-w-0">
      <Button onClick={() => setOpen(!open)}>
        {t(
          'Manage release subscribers',
          'Administrar suscriptores de estrenos'
        )}
      </Button>
      {open && (
        <div className="my-3 max-h-64 overflow-auto rounded-lg bg-gray-800 p-4 text-gray-300">
          <p className="mb-2 text-sm">
            {t(
              'Subscribe users to new releases. Their feature access is unchanged.',
              'Suscribe usuarios a nuevos estrenos. No cambia su acceso a funciones.'
            )}
          </p>
          {!data && !loadError && (
            <p role="status">{t('Loading…', 'Cargando…')}</p>
          )}
          {data?.users.map((u) => (
            <label key={u.id} className="mb-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={u.following}
                disabled={busy !== null || u.locked}
                onChange={async (e) => {
                  const following = e.target.checked;
                  setBusy(u.id);
                  setError(false);
                  try {
                    await axios.put(endpoint, { userId: u.id, following });
                    await mutate();
                  } catch {
                    setError(true);
                  } finally {
                    setBusy(null);
                  }
                }}
              />
              {u.name}
            </label>
          ))}
          {(error || loadError) && (
            <p role="alert">
              {t(
                'Could not load or save subscriptions. Try again.',
                'No se pudieron cargar o guardar las suscripciones. Intenta de nuevo.'
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
type Releases = {
  episodes: {
    key: string;
    name: string;
    date: string;
    season: number;
    episode: number;
    episodeName: string;
    image?: string;
    poster?: string;
    episodes?: { season: number; episode: number; name: string }[];
  }[];
  movies: { key: string; name: string; downloadedAt: number }[];
};
export function ReleaseUpdates({
  section,
}: {
  section?: 'episodes' | 'movies';
}) {
  const { enabled, read, previewUserId, href } = useDiscovery(),
    { user } = useUser(),
    t = usePartyText();
  const { data, error } = useSWR<Releases>(
    enabled
      ? ['/api/v1/discovery-lists/releases', user?.id, previewUserId]
      : null,
    read
  );
  if (!enabled) return null;
  if (error)
    return (
      <p role="alert">
        {t('Releases unavailable.', 'Estrenos no disponibles.')}
      </p>
    );
  if (!data)
    return (
      <p
        role="status"
        data-row-loading
        className="my-4 flex items-center gap-2 text-gray-400"
      >
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-gray-600 border-t-purple-300"
        />
        {t('Loading…', 'Cargando…')}
      </p>
    );
  return (
    <>
      {section !== 'movies' && !!data.episodes.length && (
        <section className="my-8 text-gray-300">
          <Slider
            stretchItems
            header={
              <h2 className="text-2xl font-bold">
                {t('New episodes for you', 'Nuevos episodios para ti')}
              </h2>
            }
            isLoading={false}
            sliderKey="followed-episodes"
            items={data.episodes.slice(0, 20).map((ep) => (
              <div className="w-72 sm:w-80" key={`${ep.key}:${ep.date}`}>
                <EpisodeCard episode={ep} />
              </div>
            ))}
          />
        </section>
      )}
      {section !== 'episodes' && !!data.movies.length && (
        <section className="my-8 text-gray-300">
          <Slider
            header={
              <h2 className="text-2xl font-bold">
                <Link
                  className="inline-flex items-center gap-2"
                  href={href('/discover/releases?section=movies')}
                >
                  {t(
                    'New movies for you',
                    'Nuevas películas para ti'
                  )}{' '}
                  <ArrowRightCircleIcon
                    className="inline h-6 w-6 align-middle"
                    aria-hidden="true"
                  />
                </Link>
              </h2>
            }
            isLoading={false}
            sliderKey="awaited-movies"
            items={data.movies.slice(0, 20).map((movie) => (
              <TmdbTitleCard
                key={movie.key}
                id={Number(movie.key.split(':')[1])}
                tmdbId={Number(movie.key.split(':')[1])}
                type="movie"
              />
            ))}
          />
        </section>
      )}
    </>
  );
}

export function episodeRanges(episodes: { season: number; episode: number }[]) {
  const ordered = [...episodes].sort(
    (a, b) => a.season - b.season || a.episode - b.episode
  );
  const ranges: { season: number; first: number; last: number }[] = [];
  for (const ep of ordered) {
    const last = ranges.at(-1);
    if (last && last.season === ep.season && last.last === ep.episode - 1)
      last.last = ep.episode;
    else
      ranges.push({ season: ep.season, first: ep.episode, last: ep.episode });
  }
  return ranges
    .map(
      (r) => `S${r.season}E${r.first}${r.last !== r.first ? `–E${r.last}` : ''}`
    )
    .join(', ');
}
export function episodeImageUrl(value?: string) {
  if (!value) return undefined;
  if (/^\/[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp)$/i.test(value))
    return `https://image.tmdb.org/t/p/w780${value}`;
  return /^https:\/\/image\.tmdb\.org\/t\/p\//.test(value) ? value : undefined;
}
export function EpisodeCard({
  episode: ep,
}: {
  episode: Releases['episodes'][number];
}) {
  const t = usePartyText();
  const { ref, inView } = useInView({ triggerOnce: true });
  const [failed, setFailed] = useState<string[]>([]);
  const still = episodeImageUrl(ep.image);
  const image = still && !failed.includes(still) ? still : undefined;
  const savedPoster = episodeImageUrl(ep.poster);
  // Older release snapshots lack posters. Reuse the same compact/SWR cache as
  // title cards, only for visible episodes without a usable still or poster.
  const { data: title } = useSWR<{ posterPath?: string }>(
    inView && !image && !savedPoster
      ? `/api/v1/tv/${ep.key.split(':')[1]}?view=card`
      : null
  );
  const poster = savedPoster || episodeImageUrl(title?.posterPath);
  const src =
    image || (poster && !failed.includes(poster) ? poster : undefined);
  return (
    <Link
      ref={ref}
      href={`/tv/${ep.key.split(':')[1]}?reviewSeason=${ep.season}&viewEpisode=${ep.episode}`}
      className="flex h-full min-w-0 flex-col overflow-hidden whitespace-normal rounded-xl bg-gray-800 text-gray-300"
    >
      <div className="aspect-video w-full shrink-0 overflow-hidden bg-gray-700">
        {src && (
          <CachedImage
            type="tmdb"
            width={640}
            height={360}
            src={src}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover object-center"
            onError={() =>
              setFailed((previous) => [...new Set([...previous, src])])
            }
          />
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <strong className="line-clamp-2 break-words">{ep.name}</strong>
        <p className="mt-2 line-clamp-2 whitespace-normal break-words">
          {(ep.episodes?.length || 0) > 1
            ? `${ep.episodes!.length} ${t('episodes', 'episodios')} · ${episodeRanges(ep.episodes!)}`
            : `S${ep.season}E${ep.episode} · ${ep.episodeName}`}
        </p>
        <p className="mt-auto pt-2 text-sm text-gray-400">
          {t('Air date', 'Fecha de emisión')}: {ep.date}
        </p>
        <span className="text-purple-300">
          {t(
            (ep.episodes?.length || 0) > 1 ? 'Go to episodes' : 'Go to episode',
            (ep.episodes?.length || 0) > 1 ? 'Ir a episodios' : 'Ir al episodio'
          )}{' '}
          <ArrowRightCircleIcon className="inline h-5 w-5" aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}
export function ReleasePage() {
  const { enabled, loading, read, previewUserId } = useDiscovery(),
    { user } = useUser(),
    { query } = useRouter(),
    t = usePartyText(),
    { ref, inView } = useInView();
  const section = query.section === 'movies' ? 'movies' : 'episodes';
  type Row = Releases['episodes'][number] | Releases['movies'][number];
  const { data, error, size, setSize, isValidating } = useSWRInfinite<{
    results: Row[];
    next: number | null;
  }>(
    (index, previous) =>
      !enabled || previous?.next === null
        ? null
        : [
            `/api/v1/discovery-lists/releases?section=${section}&offset=${index === 0 ? 0 : previous!.next}`,
            user?.id,
            previewUserId,
          ],
    read,
    { revalidateFirstPage: false }
  );
  useEffect(() => {
    if (inView && data?.at(-1)?.next != null && !isValidating && !error)
      void setSize(size + 1);
  }, [inView, data, isValidating, error, setSize, size]);
  if (!enabled)
    return (
      <p>
        {loading
          ? t('Loading…', 'Cargando…')
          : t(
              'This preview is not enabled for your account.',
              'Esta vista previa no está activada para tu cuenta.'
            )}
      </p>
    );
  const title =
    section === 'movies'
      ? t(
          'New movies for you',
          'Nuevas películas para ti'
        )
      : t('New episodes for you', 'Nuevos episodios para ti');
  const rows = [
    ...new Map(
      (data || [])
        .flatMap((p) => p.results)
        .map((r) => [
          r.key + ('episode' in r ? `:${r.season}:${r.episode}` : ''),
          r,
        ])
    ).values(),
  ];
  return (
    <>
      <PageTitle title={title} />
      <h1 className="my-6 text-3xl font-bold text-gray-300">{title}</h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {rows.map((r) =>
          'episode' in r ? (
            <EpisodeCard
              key={`${r.key}:${r.season}:${r.episode}`}
              episode={r}
            />
          ) : (
            <TmdbTitleCard
              key={r.key}
              id={Number(r.key.split(':')[1])}
              tmdbId={Number(r.key.split(':')[1])}
              type="movie"
            />
          )
        )}
      </div>
      <div ref={ref} className="h-12" />
      {error ? (
        <button className="text-gray-300" onClick={() => void setSize(size)}>
          {t('Retry loading', 'Reintentar')}
        </button>
      ) : isValidating ? (
        <p className="text-gray-300" role="status">
          {t('Loading…', 'Cargando…')}
        </p>
      ) : !rows.length ? (
        <p className="text-gray-300">
          {t('No recent releases yet.', 'Aún no hay estrenos recientes.')}
        </p>
      ) : null}
    </>
  );
}
