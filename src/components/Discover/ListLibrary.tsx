import CachedImage from '@app/components/Common/CachedImage';
import Modal from '@app/components/Common/Modal';
import PageTitle from '@app/components/Common/PageTitle';
import Slider from '@app/components/Slider';
import TmdbTitleCard from '@app/components/TitleCard/TmdbTitleCard';
import { usePartyText } from '@app/components/WatchParty/messages';
import useDiscovery from '@app/hooks/useDiscovery';
import { useUser } from '@app/hooks/useUser';
import { Transition } from '@headlessui/react';
import {
  ArrowRightCircleIcon,
  BookmarkIcon,
  ClockIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import ForYouLayout from './ForYouLayout';
import ListEditor from './ListEditor';
import { ReleaseUpdates } from './ReleaseUpdates';
import { listAuthorStyle } from './listAuthorStyle';

type Film = {
  type: 'movie' | 'tv';
  tmdbId: number;
  note?: string;
  supporters?: number[];
  matches?: { userId: number; overlap: number }[];
  watchlistCount?: number;
  listRating?: number | null;
  listRuntime?: number | null;
};
export type List = {
  virtual?: boolean;
  visibility?: 'public' | 'private' | 'unknown';
  source?: 'curated' | 'letterboxd' | 'catalogue';
  unmatched?: { url: string; title: string; position: number }[];
  id: string;
  title: string;
  description: string;
  creator: string;
  url?: string;
  saved: boolean;
  owned: boolean;
  liked: boolean;
  available: number;
  progress: {
    watched: number;
    total: number;
    remaining: number;
    recent: number;
  };
  covers: Film[];
};
type SectionMetadata = {
  users?: { id: number; name: string; avatar?: string }[];
  lists?: Pick<List, 'id' | 'title'>[];
  historyAvailable?: boolean;
};
type Page = Partial<List> &
  SectionMetadata & {
    results: Film[];
    next: number | null;
    metadataUpdating?: boolean;
    watchlistsUpdating?: boolean;
    watchlistsUnmatched?: number;
  };
const style =
  'rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-white';
function LoadingState() {
  const t = usePartyText();
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
}
function Gate({ children }: { children: React.ReactNode }) {
  const { enabled, loading } = useDiscovery(),
    t = usePartyText();
  if (loading)
    return (
      <p className="text-gray-300" role="status">
        {t('Loading…', 'Cargando…')}
      </p>
    );
  if (!enabled)
    return (
      <p className="text-gray-300">
        {t(
          'This preview is not enabled for your account.',
          'Esta vista previa no está activada para tu cuenta.'
        )}
      </p>
    );
  return <div className="text-gray-300">{children}</div>;
}
export function SaveList({
  id,
  saved,
  onChange,
}: {
  id: string;
  saved?: boolean;
  onChange?: () => void;
}) {
  const { enabled, readOnly } = useDiscovery(),
    [value, setValue] = useState(!!saved),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    t = usePartyText();
  const { user } = useUser();
  const { data, mutate } = useSWR<List>(
    enabled && !readOnly && saved === undefined
      ? [`/api/v1/discovery-lists/${id}`, user?.id]
      : null,
    async ([url]) => (await axios.get(url)).data
  );
  useEffect(
    () => setValue(saved ?? data?.saved ?? false),
    [saved, data?.saved, id]
  );
  if (!enabled || readOnly) return null;
  return (
    <span>
      <button
        className={style}
        disabled={busy || (saved === undefined && !data)}
        aria-pressed={value}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await axios.put(`/api/v1/discovery-lists/${id}/save`, {
              saved: !value,
            });
            setValue(!value);
            if (data) void mutate({ ...data, saved: !value }, false);
            onChange?.();
          } catch (error) {
            setError(
              axios.isAxiosError(error)
                ? error.response?.data?.message ||
                    t(
                      'Could not save. Please retry.',
                      'No se pudo guardar. Intenta de nuevo.'
                    )
                : t(
                    'Could not save. Please retry.',
                    'No se pudo guardar. Intenta de nuevo.'
                  )
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? t('Saving…', 'Guardando…')
          : value
            ? t('Saved ✓', 'Guardada ✓')
            : t('Save list', 'Guardar lista')}
      </button>
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
export function ListCard({ list: l }: { list: List }) {
  const t = usePartyText();
  const { href } = useDiscovery();
  return (
    <article
      key={l.id}
      className="flex h-full min-w-0 flex-col whitespace-normal break-words rounded-xl border border-gray-700 bg-gray-800 p-4 text-gray-300"
    >
      <h3 className="min-w-0 text-xl text-purple-300">
        <Link href={href(`/lists/${l.id}`)}>
          {l.title}{' '}
          <ArrowRightCircleIcon className="inline h-6 w-6" aria-hidden="true" />
        </Link>
      </h3>
      <p
        className={`text-sm ${l.virtual ? 'text-gray-400' : listAuthorStyle(l.source)}`}
      >
        {l.creator}
      </p>
      <p>
        {l.progress.watched}/{l.progress.total} · {l.available}{' '}
        {t('available', 'disponibles')}
      </p>
      {!!l.progress.recent && (
        <p className="text-sm text-gray-400">
          {l.progress.recent}{' '}
          {t('watched in the last 30 days', 'vistas en los últimos 30 días')}
        </p>
      )}
      {l.description && (
        <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-gray-300">
          {l.description}
        </p>
      )}
      <div className="mt-auto flex w-full -space-x-3 overflow-hidden pt-3">
        {l.covers.slice(0, 3).map((f) => (
          <div className="min-w-0 flex-1" key={`${f.type}:${f.tmdbId}`}>
            <TmdbTitleCard
              id={f.tmdbId}
              tmdbId={f.tmdbId}
              type={f.type}
              canExpand
              posterBadge={
                f.listRating != null ? (
                  `★ ${f.listRating.toFixed(2)}`
                ) : f.listRuntime != null ? (
                  `${f.listRuntime} min`
                ) : f.watchlistCount ? (
                  <span
                    className="inline-flex items-center gap-1"
                    aria-label={`${f.watchlistCount} participant watchlists`}
                  >
                    <BookmarkIcon className="h-4 w-4" />
                    {f.watchlistCount}
                  </span>
                ) : undefined
              }
            />
          </div>
        ))}
      </div>
      <div className="pt-3">
        {!l.virtual && <SaveList id={l.id} saved={l.saved} />}
      </div>
    </article>
  );
}
function ActivityListRow({ lists }: { lists: List[] }) {
  const t = usePartyText();
  if (!lists.length) return null;
  return (
    <Slider
      sliderKey="watched-from-lists"
      stretchItems
      isLoading={false}
      header={
        <h2 className="text-2xl font-bold">
          {t(
            'Lists matching your recent watches',
            'Listas que coinciden con tus vistas recientes'
          )}
        </h2>
      }
      items={lists.map((list) => (
        <div key={list.id} className="w-80 max-w-[85vw] sm:w-96">
          <ListCard list={list} />
        </div>
      ))}
    />
  );
}
function ListCards({ lists }: { lists: List[] }) {
  return (
    <div className="my-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {lists.map((list) => (
        <ListCard key={list.id} list={list} />
      ))}
    </div>
  );
}
function FilmGrid({
  endpoint,
  onMetadata,
}: {
  endpoint: string;
  onMetadata?: (page: Page) => void;
}) {
  const { user } = useUser(),
    { enabled, read, previewUserId } = useDiscovery(),
    { ref, inView } = useInView(),
    t = usePartyText();
  const { data, error, size, setSize, isValidating } = useSWRInfinite<Page>(
    (index, previous) =>
      !enabled || previous?.next === null
        ? null
        : [
            `${endpoint}${endpoint.includes('?') ? '&' : '?'}offset=${index === 0 ? 0 : previous!.next}`,
            user?.id,
            previewUserId,
          ],
    read,
    {
      revalidateFirstPage: false,
      refreshInterval: (pages) =>
        pages?.some((p) => p.watchlistsUpdating || p.metadataUpdating)
          ? 5000
          : 0,
    }
  );
  useEffect(() => {
    if (data?.[0]) onMetadata?.(data[0]);
  }, [data, onMetadata]);
  useEffect(() => {
    if (
      inView &&
      data?.[data.length - 1]?.next != null &&
      !isValidating &&
      !error
    )
      void setSize(size + 1);
  }, [inView, data, isValidating, error, setSize, size]);
  const films = [
    ...new Map(
      (data || [])
        .flatMap((p) => p.results)
        .map((f) => [`${f.type}:${f.tmdbId}`, f])
    ).values(),
  ];
  return (
    <>
      {data?.[0]?.watchlistsUpdating && (
        <p role="status" className="my-4 text-sm text-gray-400">
          {t(
            'Updating watchlist matches…',
            'Actualizando coincidencias de listas de seguimiento…'
          )}
        </p>
      )}
      {data?.[0]?.metadataUpdating && (
        <p role="status" className="my-4">
          {t(
            'Loading sort information… The first lookup may take a while.',
            'Cargando información para ordenar… La primera consulta puede tardar.'
          )}
        </p>
      )}
      {!data?.[0]?.watchlistsUpdating && !!data?.[0]?.watchlistsUnmatched && (
        <p className="my-4 text-sm text-gray-400">
          {t(
            'Some watchlists could not be fully matched yet.',
            'Algunas listas de seguimiento aún no se pudieron identificar por completo.'
          )}
        </p>
      )}
      <ul className="cards-vertical">
        {films.map((f) => (
          <li key={`${f.type}:${f.tmdbId}`}>
            <TmdbTitleCard
              detailHref={
                endpoint.includes('section=unrated')
                  ? `/movie/${f.tmdbId}#reviews`
                  : undefined
              }
              id={f.tmdbId}
              tmdbId={f.tmdbId}
              type={f.type}
              canExpand
              posterBadge={
                f.listRating != null ? (
                  `★ ${f.listRating.toFixed(2)}`
                ) : f.listRuntime != null ? (
                  `${f.listRuntime} min`
                ) : f.watchlistCount ? (
                  <span
                    className="inline-flex items-center gap-1"
                    aria-label={`${f.watchlistCount} participant watchlists`}
                  >
                    <BookmarkIcon className="h-4 w-4" />
                    {f.watchlistCount}
                  </span>
                ) : undefined
              }
            />
            {f.note && <p className="mt-2 text-sm text-gray-400">{f.note}</p>}
          </li>
        ))}
      </ul>
      <div ref={ref} className="h-12" />
      {error ? (
        <button className={style} onClick={() => void setSize(size)}>
          {t('Retry loading', 'Reintentar')}
        </button>
      ) : !data || isValidating ? (
        <LoadingState />
      ) : films.length === 0 && !data?.[0]?.metadataUpdating ? (
        <p>
          {t(
            'No films match these filters.',
            'No hay películas que coincidan.'
          )}
        </p>
      ) : null}
    </>
  );
}
function Library({ explore = false }: { explore?: boolean }) {
  const { enabled, read, previewUserId, readOnly, href } = useDiscovery(),
    { user } = useUser(),
    t = usePartyText(),
    [filter, setFilter] = useState('all'),
    [url, setUrl] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false),
    [importOpen, setImportOpen] = useState(false),
    [createOpen, setCreateOpen] = useState(false),
    [jobId, setJobId] = useState(''),
    router = useRouter();
  const { data: importJob } = useSWR<{
    state: string;
    listId?: string;
    error?: string;
  }>(
    enabled && !readOnly && jobId
      ? [`/api/v1/discovery-lists/imports/${jobId}`, user?.id]
      : null,
    async ([url]) => (await axios.get(url)).data,
    {
      refreshInterval: (data) =>
        data && ['succeeded', 'blocked'].includes(data.state) ? 0 : 5000,
    }
  );
  useEffect(() => {
    if (importJob?.state === 'succeeded' && importJob.listId) {
      setJobId('');
      void router.push(`/lists/${importJob.listId}`);
    } else if (importJob?.state === 'blocked')
      setStatus(
        importJob.error ||
          t(
            'Import needs attention. Please retry.',
            'La importación necesita atención. Intenta de nuevo.'
          )
      );
  }, [importJob, router, t]);
  const { data, error, mutate } = useSWR<{
    results: List[];
    unavailable: string[];
    unresolvedLiked: number;
  }>(
    enabled
      ? [
          `/api/v1/discovery-lists?filter=${explore ? 'discover' : filter}`,
          user?.id,
          previewUserId,
        ]
      : null,
    read
  );
  const matchingLists = data?.results.filter(
    (list) =>
      !explore ||
      `${list.title} ${list.creator} ${list.description}`
        .toLocaleLowerCase()
        .includes(String(router.query.q || '').toLocaleLowerCase())
  );
  return (
    <>
      <h1 className="my-5 text-3xl font-bold">
        {explore
          ? t('Explore lists', 'Explorar listas')
          : t('My lists', 'Mis listas')}
      </h1>
      {!explore && (
        <Link
          className="mb-4 inline-flex items-center gap-2 text-purple-300"
          href={href('/lists/explore')}
        >
          {t('Explore lists', 'Explorar listas')}{' '}
          <ArrowRightCircleIcon className="h-5 w-5" />
        </Link>
      )}
      {explore ? (
        <input
          className={`${style} mb-4 w-full`}
          type="search"
          aria-label={t('Search lists', 'Buscar listas')}
          placeholder={t('Search lists', 'Buscar listas')}
          value={String(router.query.q || '')}
          onChange={(e) =>
            void router.replace(
              {
                pathname: router.pathname,
                query: { ...router.query, q: e.target.value },
              },
              undefined,
              { shallow: true, scroll: false }
            )
          }
        />
      ) : (
        <div className="flex items-center gap-3">
          <select
            className={`${style} min-w-0 max-w-xs flex-1`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {[
              ['all', 'All', 'Todas'],
              ['saved', 'Saved', 'Guardadas'],
              ['created', 'Created', 'Creadas'],
              ['liked', 'Liked on Letterboxd', 'Me gustan en Letterboxd'],
            ].map(([id, en, es]) => (
              <option key={id} value={id}>
                {t(en, es)}
              </option>
            ))}
          </select>
          {!readOnly && (
            <>
              <button className={style} onClick={() => setImportOpen(true)}>
                {t('Import', 'Importar')}
              </button>
              <button className={style} onClick={() => setCreateOpen(true)}>
                {t('Create', 'Crear')}
              </button>
            </>
          )}
        </div>
      )}
      {!readOnly && importOpen && (
        <Transition show={importOpen}>
          <Modal
            title={t('Import from Letterboxd', 'Importar de Letterboxd')}
            onCancel={() => setImportOpen(false)}
          >
            <form
              className="my-4 flex flex-wrap gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setStatus(
                  t(
                    'Reading list and matching films…',
                    'Leyendo lista e identificando películas…'
                  )
                );
                try {
                  const r = await axios.post('/api/v1/discovery-lists/import', {
                    url,
                  });
                  void mutate();
                  if (r.data.jobId) {
                    setJobId(r.data.jobId);
                    setStatus(
                      t(
                        'Import in progress. It will be saved when verified.',
                        'Importación en progreso. Se guardará al verificarse.'
                      )
                    );
                  } else void router.push(`/lists/${r.data.id}`);
                } catch (error) {
                  setStatus(
                    (axios.isAxiosError(error) &&
                      error.response?.data?.message) ||
                      t(
                        'Could not import this public list.',
                        'No se pudo importar esta lista pública.'
                      )
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <input
                className={`${style} w-full min-w-0`}
                aria-label="Letterboxd list URL"
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://letterboxd.com/…/list/…/"
              />
              <button
                className={style}
                disabled={busy || (!!jobId && importJob?.state !== 'blocked')}
              >
                {busy || (!!jobId && importJob?.state !== 'blocked') ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-purple-300 border-t-transparent" />
                    {t('Importing…', 'Importando…')}
                  </span>
                ) : (
                  t('Import from Letterboxd', 'Importar de Letterboxd')
                )}
              </button>
              <p role="status">{status}</p>
            </form>
          </Modal>
        </Transition>
      )}
      {!readOnly && user && createOpen && (
        <ListEditor
          key={`${user.id}:new`}
          userId={user.id}
          onClose={() => setCreateOpen(false)}
          onSaved={(id) => {
            setCreateOpen(false);
            void mutate();
            void router.push(`/lists/${id}`);
          }}
        />
      )}
      {!importOpen && <p role="status">{status}</p>}
      {!explore && filter === 'all' && <MyWatchlists />}
      {!!data?.unresolvedLiked && (
        <p className="text-gray-400">
          {data.unresolvedLiked}{' '}
          {t(
            'liked lists are awaiting a successful public refresh.',
            'listas que te gustan esperan una actualización pública correcta.'
          )}
        </p>
      )}
      {data?.unavailable?.map((id) => (
        <div key={id} className="my-3 flex items-center gap-3">
          <span>
            {t(
              'A saved list is unavailable or private.',
              'Una lista guardada no está disponible o es privada.'
            )}
          </span>
          <SaveList id={id} saved={true} onChange={() => void mutate()} />
        </div>
      ))}
      {error ? (
        <p role="alert">{t('Lists unavailable.', 'Listas no disponibles.')}</p>
      ) : !data ? (
        <LoadingState />
      ) : matchingLists?.length ? (
        <ListCards lists={matchingLists} />
      ) : explore ? (
        <p>{t('No matching lists.', 'No hay listas que coincidan.')}</p>
      ) : (
        <p>
          {t(
            'No lists yet. Create a list, save a curated list or import a public Letterboxd list. Linked-account lists are imported with the twice-daily reconciliation.',
            'Aún no hay listas. Crea una lista, guarda una lista seleccionada o importa una lista pública de Letterboxd. Las listas de cuentas vinculadas se importan con la conciliación dos veces al día.'
          )}
        </p>
      )}
    </>
  );
}
function MyWatchlists() {
  const { read, previewUserId } = useDiscovery();
  const { user } = useUser();
  const t = usePartyText();
  const { data, error, mutate } = useSWR<{
    results: List[];
    updating: boolean;
    unresolved: boolean;
  }>(['/api/v1/discovery-lists/watchlists', user?.id, previewUserId], read, {
    refreshInterval: (data) => (data?.updating ? 5000 : 0),
  });
  if (error)
    return (
      <button className={style} onClick={() => void mutate()}>
        {t('Retry watchlists', 'Reintentar listas de seguimiento')}
      </button>
    );
  return (
    <section className="my-6">
      <h2 className="mb-4 text-2xl font-bold">
        {t('Watchlists', 'Listas de seguimiento')}
      </h2>
      {!data ? (
        <LoadingState />
      ) : (
        <>
          <ListCards lists={data.results} />
          {data.updating && (
            <p role="status">
              {t('Updating watchlists…', 'Actualizando listas…')}
            </p>
          )}
          {data.unresolved && (
            <p>
              {t(
                'Some watchlist entries are temporarily unavailable.',
                'Algunas entradas no están disponibles temporalmente.'
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}
export function MyListsPage() {
  return (
    <Gate>
      <Library />
    </Gate>
  );
}
export function ExploreListsPage() {
  const router = useRouter();
  const { user } = useUser();
  const { previewUserId } = useDiscovery();
  const key = `explore-scroll:${user?.id}:${previewUserId}:${router.asPath}`;
  useEffect(() => {
    if (!router.isReady) return;
    let saved = 0;
    try {
      const value = Number(sessionStorage.getItem(key) || 0);
      if (Number.isFinite(value) && value > 0) saved = value;
    } catch {
      /* Storage may be disabled. Browsing must still work. */
    }
    let frame = 0;
    let cancelled = false;
    const deadline = Date.now() + 10000;
    const restore = () => {
      if (cancelled || Date.now() > deadline) return;
      window.scrollTo(0, saved);
      if (
        document.documentElement.scrollHeight >= saved + window.innerHeight ||
        saved === 0
      )
        return;
      frame = requestAnimationFrame(restore);
    };
    frame = requestAnimationFrame(restore);
    const save = () => {
      try {
        sessionStorage.setItem(key, String(window.scrollY));
      } catch {
        /* Optional back-position persistence. */
      }
    };
    const stop = () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
    router.events.on('routeChangeStart', save);
    window.addEventListener('pagehide', save);
    window.addEventListener('touchstart', stop, { once: true });
    window.addEventListener('wheel', stop, { once: true });
    return () => {
      stop();
      router.events.off('routeChangeStart', save);
      window.removeEventListener('pagehide', save);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('wheel', stop);
    };
  }, [key, router.isReady, router.events]);
  return (
    <Gate>
      <Library explore />
    </Gate>
  );
}
function Details() {
  const router = useRouter(),
    { query } = router,
    { enabled, read, previewUserId, readOnly } = useDiscovery(),
    { user } = useUser(),
    t = usePartyText(),
    [available, setAvailable] = useState(false),
    [unwatched, setUnwatched] = useState(false),
    [editOpen, setEditOpen] = useState(false),
    [editVersion, setEditVersion] = useState(0),
    [sort, setSort] = useState('original');
  const base = `/api/v1/discovery-lists/${encodeURIComponent(String(query.id))}`;
  const { data, error, mutate } = useSWR<List>(
    enabled && query.id ? [base, user?.id, previewUserId] : null,
    read
  );
  if (error)
    return (
      <p>
        {t(
          'This list is unavailable or private.',
          'Esta lista no está disponible o es privada.'
        )}
      </p>
    );
  if (!data) return <p role="status">{t('Loading…', 'Cargando…')}</p>;
  return (
    <>
      <h1 className="my-4 text-3xl font-bold">{data.title}</h1>
      {data.visibility === 'private' && (
        <p className="text-sm text-purple-300">
          {t('Private — only you', 'Privada — solo tú')}
        </p>
      )}
      <p className="text-gray-400">
        <span
          className={
            data.virtual ? 'text-gray-400' : listAuthorStyle(data.source)
          }
        >
          {data.creator}
        </span>{' '}
        · {data.progress.watched}/{data.progress.total} · {data.available}{' '}
        {t('available', 'disponibles')}
      </p>
      <p className="my-3 whitespace-pre-wrap">{data.description}</p>
      {!!data.unmatched?.length && (
        <div className="my-4 rounded-lg border border-gray-700 p-3 text-sm text-gray-400">
          <p>
            {t(
              'These entries have no valid catalogue match on Letterboxd. They remain in the list total, but viewing progress is unknown:',
              'Estas entradas no tienen una coincidencia válida en Letterboxd. Siguen en el total de la lista, pero su progreso es desconocido:'
            )}
          </p>
          <ul className="mt-2 space-y-1">
            {data.unmatched.map((film) => (
              <li key={film.url}>
                <a
                  className="text-purple-300 underline"
                  href={film.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {film.position}. {film.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        {!readOnly &&
          !data.virtual &&
          data.owned &&
          data.source === 'catalogue' && (
            <button className={style} onClick={() => setEditOpen(true)}>
              {t('Edit list', 'Editar lista')}
            </button>
          )}
        {!data.virtual && (
          <SaveList
            id={data.id}
            saved={data.saved}
            onChange={() => void mutate()}
          />
        )}
        {data.url && (
          <a
            className="text-green-400"
            href={data.url}
            target="_blank"
            rel="noreferrer"
          >
            {t('Open in Letterboxd ↗', 'Abrir en Letterboxd ↗')}
          </a>
        )}
        <div className="flex w-full flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={available}
              onChange={(e) => setAvailable(e.target.checked)}
            />{' '}
            {t('Available', 'Disponibles')}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={unwatched}
              onChange={(e) => setUnwatched(e.target.checked)}
            />{' '}
            {t('Unwatched', 'Sin ver')}
          </label>
        </div>
      </div>
      <select
        aria-label={t('Sort list', 'Ordenar lista')}
        className={`${style} mb-4`}
        value={sort}
        onChange={(e) => setSort(e.target.value)}
      >
        <option value="original">{t('List order', 'Orden de la lista')}</option>
        <option value="rating-desc">
          {t(
            'Letterboxd rating: highest first',
            'Calificación Letterboxd: mayor primero'
          )}
        </option>
        <option value="rating-asc">
          {t(
            'Letterboxd rating: lowest first',
            'Calificación Letterboxd: menor primero'
          )}
        </option>
        <option value="runtime-asc">
          {t('Runtime: shortest first', 'Duración: menor primero')}
        </option>
        <option value="runtime-desc">
          {t('Runtime: longest first', 'Duración: mayor primero')}
        </option>
      </select>
      <FilmGrid
        key={`${data.id}:${available}:${unwatched}:${editVersion}:${sort}`}
        endpoint={`${base}?available=${available}&unwatched=${unwatched}&revision=${editVersion}&sort=${sort}`}
      />
      {!readOnly && user && editOpen && (
        <ListEditor
          key={`${user.id}:${data.id}`}
          userId={user.id}
          listId={data.id}
          onDeleted={() => {
            setEditOpen(false);
            void router.push('/lists');
          }}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            setEditVersion((v) => v + 1);
            void mutate();
          }}
        />
      )}
    </>
  );
}
export function ListDetailPage() {
  return (
    <Gate>
      <Details />
    </Gate>
  );
}
export function DiscoveryListSections({
  section = 'explore',
}: {
  section?: 'explore' | 'activity';
}) {
  const { enabled, read, previewUserId, href } = useDiscovery(),
    { user } = useUser(),
    t = usePartyText();
  const { data, error } = useSWR<{
    results: List[];
    explore: List[];
    activity: { list: List; progress: { recent: number } }[];
  }>(
    enabled
      ? ['/api/v1/discovery-lists?filter=discover', user?.id, previewUserId]
      : null,
    read
  );
  if (!enabled) return null;
  if (error)
    return (
      <p role="alert">{t('Lists unavailable.', 'Listas no disponibles.')}</p>
    );
  if (!data) return <LoadingState />;
  return (
    <section className="my-8 text-gray-300">
      {section === 'explore' && (
        <>
          <Slider
            sliderKey="lists-to-explore"
            stretchItems
            header={
              <h2 className="text-2xl font-bold">
                <Link
                  href={href('/lists/explore')}
                  className="inline-flex items-center gap-2"
                >
                  {t('Lists to explore', 'Listas para explorar')}{' '}
                  <ArrowRightCircleIcon className="h-6 w-6" />
                </Link>
              </h2>
            }
            isLoading={false}
            items={(data.explore || []).map((list) => (
              <div className="w-80 max-w-[85vw] sm:w-96" key={list.id}>
                <ListCard list={list} />
              </div>
            ))}
          />
          <Link
            href={href('/lists')}
            className="mt-4 inline-flex items-center gap-2 text-purple-300"
          >
            {t('My lists', 'Mis listas')}{' '}
            <ArrowRightCircleIcon
              className="inline h-6 w-6"
              aria-hidden="true"
            />
          </Link>
        </>
      )}
      {section === 'activity' && data.activity.length > 0 && (
        <>
          <ActivityListRow
            lists={data.activity.map((a) => ({
              ...a.list,
              progress: { ...a.list.progress, recent: a.progress.recent },
            }))}
          />
        </>
      )}
    </section>
  );
}
function ForYou() {
  const { previewUserId, preview, href } = useDiscovery(),
    { user } = useUser(),
    { query } = useRouter(),
    t = usePartyText(),
    [withIds, setWithIds] = useState<number[]>([]),
    [runtime, setRuntime] = useState(90),
    [list, setList] = useState('');
  const [editingLayout, setEditingLayout] = useState(false);
  const [sectionMetadata, setSectionMetadata] = useState<{
    key: string;
    page: SectionMetadata;
  }>();
  const section = typeof query.section === 'string' ? query.section : '';
  const metadataKey = `${section}:${user?.id}:${previewUserId}`;
  const receiveMetadata = useCallback(
    (page: Page) => {
      setSectionMetadata({ key: metadataKey, page });
    },
    [metadataKey]
  );
  const controls = section
    ? sectionMetadata?.key === metadataKey
      ? sectionMetadata.page
      : undefined
    : undefined;
  const titles: Record<string, string> = {
    unfinished: t('Unfinished series', 'Series sin terminar'),
    requested: t(
      'You requested, still unwatched',
      'Las pediste, aún no las ves'
    ),
    unrated: t('Just watched, unrated', 'Recién vistas, sin calificar'),
    recommendations: t('For your taste', 'Para tus gustos'),
    available: t('Available from your lists', 'Disponibles de tus listas'),
    friendsLoved: t('Friends loved', 'Favoritas de amigos'),
    short: t('Watch something with limited time', 'Ver algo con poco tiempo'),
    together: t('What can we watch together?', '¿Qué podemos ver juntos?'),
  };
  const pageTitle = section
    ? titles[section] || t('Section unavailable', 'Sección no disponible')
    : t('For you', 'Para ti');
  return (
    <>
      <PageTitle title={pageTitle} />
      <div className="my-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="text-3xl font-bold">{pageTitle}</h1>
          {!section && (
            <nav
              aria-label={t(
                'Find something to watch',
                'Encuentra algo para ver'
              )}
              className="flex shrink-0 items-center"
            >
              {[
                { id: 'short', label: titles.short, Icon: ClockIcon },
                { id: 'together', label: titles.together, Icon: UsersIcon },
              ].map(({ id, label, Icon }) => (
                <Link
                  key={id}
                  href={href(`/for-you?section=${id}`)}
                  aria-label={label}
                  title={label}
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-purple-300 hover:bg-gray-800 hover:text-purple-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
                >
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </Link>
              ))}
            </nav>
          )}
        </div>
        {!section && previewUserId === undefined && (
          <button
            className="shrink-0 text-sm text-purple-300 disabled:opacity-50"
            disabled={editingLayout}
            onClick={() => setEditingLayout(true)}
          >
            {t('Customize page', 'Personalizar página')}
          </button>
        )}
      </div>
      {preview && (
        <>
          <Link className="text-purple-300" href={href('/lists')}>
            {t('View this user’s lists', 'Ver las listas de este usuario')}{' '}
            <ArrowRightCircleIcon
              className="inline h-6 w-6"
              aria-hidden="true"
            />
          </Link>
        </>
      )}
      {controls?.historyAvailable === false && (
        <p className="text-gray-400">
          {t(
            'Playback history is temporarily unavailable; progress may be incomplete.',
            'El historial de reproducción no está disponible; el progreso puede estar incompleto.'
          )}
        </p>
      )}
      {section && (
        <Link
          className="mb-4 inline-block text-purple-300"
          href={href('/for-you')}
        >
          {t('Back to For you', 'Volver a Para ti')}
        </Link>
      )}
      {section === 'together' && (
        <fieldset className="mb-6 rounded-xl border border-gray-700 bg-gray-800 p-4 sm:p-6">
          <legend className="px-2 text-lg font-semibold">
            {t('Who is watching?', '¿Quién va a ver?')}
          </legend>
          <p className="mb-4 text-sm text-gray-400">
            {t(
              'You’re already included. Choose up to five people to join you.',
              'Ya estás incluido. Elige hasta cinco personas para acompañarte.'
            )}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {controls?.users
              ?.filter((u) => u.id !== (preview?.id ?? user?.id))
              .map((u) => (
                <label
                  key={u.id}
                  className={`flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors focus-within:ring-2 focus-within:ring-purple-400 ${withIds.includes(u.id) ? 'border-purple-400 bg-gray-900' : 'border-gray-600 hover:border-purple-300'} ${withIds.length >= 5 && !withIds.includes(u.id) ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  {u.avatar ? (
                    <CachedImage
                      type="avatar"
                      src={u.avatar}
                      alt=""
                      width={40}
                      height={40}
                      className="h-10 w-10 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-700 font-semibold text-purple-200"
                    >
                      {u.name.trim().slice(0, 1).toLocaleUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 break-words font-medium">
                    {u.name}
                  </span>
                  <input
                    type="checkbox"
                    className="h-5 w-5 shrink-0 rounded border-gray-500 bg-gray-900 text-purple-500 focus:ring-purple-400"
                    disabled={withIds.length >= 5 && !withIds.includes(u.id)}
                    checked={withIds.includes(u.id)}
                    onChange={(e) =>
                      setWithIds(
                        e.target.checked
                          ? [...withIds, u.id].slice(0, 5)
                          : withIds.filter((id) => id !== u.id)
                      )
                    }
                  />
                </label>
              ))}
          </div>
          <p className="mt-4 text-sm text-gray-400" role="status">
            {withIds.length
              ? t(
                  `${withIds.length + 1} people watching · Suggestions update below.`,
                  `${withIds.length + 1} personas · Las sugerencias se actualizan abajo.`
                )
              : t(
                  'Just you for now. Add someone to find films for your group.',
                  'Solo tú por ahora. Agrega a alguien para encontrar películas para tu grupo.'
                )}
          </p>
        </fieldset>
      )}
      {section === 'short' && (
        <fieldset className="mb-6 rounded-xl border border-gray-700 bg-gray-800 p-4 sm:p-6">
          <legend className="px-2 text-lg font-semibold">
            {t('How much time do you have?', '¿Cuánto tiempo tienes?')}
          </legend>
          <p className="mb-4 text-sm text-gray-400">
            {t(
              'Choose a time limit. We’ll show films that fit.',
              'Elige un límite de tiempo. Te mostraremos películas que quepan.'
            )}
          </p>
          <div className="mb-5 flex flex-wrap gap-2">
            {[60, 90, 120, 180].map((minutes) => (
              <button
                key={minutes}
                type="button"
                aria-pressed={runtime === minutes}
                onClick={() => setRuntime(minutes)}
                className={`rounded-full border px-4 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-purple-400 ${runtime === minutes ? 'border-purple-400 bg-purple-900 text-purple-100' : 'border-gray-600 text-gray-300 hover:border-purple-300'}`}
              >
                {minutes} min
              </button>
            ))}
          </div>
          <label
            className="mb-3 flex items-center justify-between gap-3"
            htmlFor="short-watch-runtime"
          >
            <span className="text-sm text-gray-400">
              {t('Fine-tune your time', 'Ajusta tu tiempo')}
            </span>
            <span className="font-semibold text-purple-300">
              {t(`Up to ${runtime} minutes`, `Hasta ${runtime} minutos`)}
            </span>
          </label>
          <input
            id="short-watch-runtime"
            type="range"
            min={30}
            max={240}
            step={5}
            className="w-full accent-purple-400"
            value={runtime}
            aria-valuetext={t(`${runtime} minutes`, `${runtime} minutos`)}
            onChange={(e) => setRuntime(Number(e.target.value))}
          />
          <div className="mt-1 flex justify-between text-xs text-gray-400">
            <span>30 min</span>
            <span>240 min</span>
          </div>
        </fieldset>
      )}
      {section === 'available' && (
        <select
          className={`${style} mb-4`}
          value={list}
          onChange={(e) => setList(e.target.value)}
        >
          <option value="">{t('All your lists', 'Todas tus listas')}</option>
          {controls?.lists?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.title}
            </option>
          ))}
        </select>
      )}
      {section ? (
        <FilmGrid
          onMetadata={receiveMetadata}
          key={`${section}:${withIds}:${runtime}:${list}`}
          endpoint={`/api/v1/discovery-lists/feed?section=${encodeURIComponent(section)}${section === 'together' && withIds.length ? '&with=' + encodeURIComponent(withIds.join(',')) : ''}${section === 'short' ? '&runtime=' + runtime : ''}${section === 'available' && list ? '&list=' + encodeURIComponent(list) : ''}`}
        />
      ) : (
        <ForYouLayout
          key={`${user?.id}:${previewUserId}`}
          editing={editingLayout}
          onClose={() => setEditingLayout(false)}
        >
          {{
            requested: (
              <RemoteFilmRow
                title={t(
                  'You requested, still unwatched',
                  'Las pediste, aún no las ves'
                )}
                section="requested"
              />
            ),
            unfinished: (
              <RemoteFilmRow
                title={t('Unfinished series', 'Series sin terminar')}
                section="unfinished"
              />
            ),
            unrated: (
              <RemoteFilmRow
                title={t(
                  'Just watched, unrated',
                  'Recién vistas, sin calificar'
                )}
                section="unrated"
              />
            ),
            episodes: <ReleaseUpdates section="episodes" />,
            movies: <ReleaseUpdates section="movies" />,
            recommendations: (
              <RemoteFilmRow
                title={t('For your taste', 'Para tus gustos')}
                section="recommendations"
              />
            ),
            available: (
              <RemoteFilmRow
                title={t(
                  'Available from your lists',
                  'Disponibles de tus listas'
                )}
                section="available"
              />
            ),
            friendsLoved: (
              <RemoteFilmRow
                title={t('Friends loved', 'Favoritas de amigos')}
                section="friendsLoved"
              />
            ),
            activity: <RemoteListRow section="activity" />,
            continueLists: <RemoteListRow section="continueLists" />,
            almostFinished: <RemoteListRow section="almostFinished" />,
            explore: <DiscoveryListSections />,
          }}
        </ForYouLayout>
      )}
    </>
  );
}
function HistoryNotice({ available }: { available?: boolean }) {
  const t = usePartyText();
  if (available !== false) return null;
  return (
    <p className="text-gray-400">
      {t(
        'Playback history is temporarily unavailable; progress may be incomplete.',
        'El historial de reproducción no está disponible; el progreso puede estar incompleto.'
      )}
    </p>
  );
}
function RemoteFilmRow({ title, section }: { title: string; section: string }) {
  const { read, previewUserId } = useDiscovery();
  const { user } = useUser();
  const { data, error, mutate } = useSWR<Page>(
    [
      `/api/v1/discovery-lists/feed?section=${section}`,
      user?.id,
      previewUserId,
    ],
    read
  );
  const t = usePartyText();
  if (error)
    return (
      <button className="my-4 text-purple-300" onClick={() => mutate()}>
        {title}: {t('Retry', 'Reintentar')}
      </button>
    );
  if (!data) return <LoadingState />;
  return (
    <>
      <HistoryNotice available={data.historyAvailable} />
      <FilmRow title={title} section={section} films={data.results} />
    </>
  );
}
function RemoteListRow({
  section,
}: {
  section: 'activity' | 'continueLists' | 'almostFinished';
}) {
  const { read, previewUserId } = useDiscovery();
  const { user } = useUser();
  const t = usePartyText();
  const { data, error, mutate } = useSWR<{
    results: List[];
    historyAvailable?: boolean;
  }>(
    [
      `/api/v1/discovery-lists/feed?section=${section}`,
      user?.id,
      previewUserId,
    ],
    read
  );
  if (error)
    return (
      <button className="my-4 text-purple-300" onClick={() => mutate()}>
        {t(
          'Could not load lists. Retry',
          'No se pudieron cargar las listas. Reintentar'
        )}
      </button>
    );
  if (!data) return <LoadingState />;
  if (!data.results.length)
    return <HistoryNotice available={data.historyAvailable} />;
  if (section === 'almostFinished')
    return (
      <>
        <HistoryNotice available={data.historyAvailable} />
        <h2 className="mt-8 text-2xl">
          {t('Almost finished', 'Casi terminadas')}
        </h2>
        <ListCards lists={data.results} />
      </>
    );
  if (section === 'activity')
    return (
      <section className="my-8">
        <HistoryNotice available={data.historyAvailable} />
        <ActivityListRow lists={data.results} />
      </section>
    );
  return (
    <section className="my-8">
      <HistoryNotice available={data.historyAvailable} />
      <Slider
        sliderKey={section}
        stretchItems
        isLoading={false}
        header={
          <h2 className="text-2xl font-bold">
            {t('Pick up where you left off', 'Retoma donde lo dejaste')}
          </h2>
        }
        items={data.results.map((list) => (
          <div key={list.id} className="w-80 max-w-[85vw] sm:w-96">
            <ListCard list={list} />
          </div>
        ))}
      />
    </section>
  );
}
function FilmRow({
  title,
  section,
  films,
}: {
  title: string;
  section: string;
  films: Film[];
}) {
  const { href } = useDiscovery();
  if (!films.length) return null;
  return (
    <section className="my-8">
      <Slider
        header={
          <h2 className="text-2xl font-bold">
            <Link
              className="inline-flex items-center gap-2"
              href={href(`/for-you?section=${section}`)}
            >
              {title}{' '}
              <ArrowRightCircleIcon
                className="inline h-6 w-6 align-middle"
                aria-hidden="true"
              />
            </Link>
          </h2>
        }
        sliderKey={`for-you-${section}`}
        isLoading={false}
        items={films.slice(0, 20).map((f) => (
          <TmdbTitleCard
            key={`${f.type}:${f.tmdbId}`}
            detailHref={
              section === 'unrated' ? `/movie/${f.tmdbId}#reviews` : undefined
            }
            id={f.tmdbId}
            tmdbId={f.tmdbId}
            type={f.type}
          />
        ))}
      />
    </section>
  );
}
export function ForYouPage() {
  const { query } = useRouter();
  const { user } = useUser();
  const { previewUserId } = useDiscovery();
  return (
    <Gate>
      <ForYou key={`${user?.id}:${previewUserId}:${query.section || ''}`} />
    </Gate>
  );
}
