import CachedImage from '@app/components/Common/CachedImage';
import Modal from '@app/components/Common/Modal';
import { usePartyText } from '@app/components/WatchParty/messages';
import { Transition } from '@headlessui/react';
import type {
  EditableCatalogueList,
  MovieChoice,
} from '@server/interfaces/api/catalogueLists';
import {
  exactMovieChoice,
  parseMovieLine,
} from '@server/interfaces/api/catalogueLists';
import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import { listDraftKey, parseListDraft, type ListDraft } from './listDraft';

type Row = {
  id: number;
  query: string;
  movie?: MovieChoice;
  results?: MovieChoice[];
  next?: number | null;
  error?: string;
};
const button =
  'shrink-0 whitespace-nowrap rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 disabled:opacity-40';
const input =
  'w-full min-w-0 rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white';
const endpoint = '/api/v1/discovery-lists/created';
function Poster({ movie }: { movie: MovieChoice }) {
  return (
    <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-700">
      {movie.poster ? (
        <CachedImage
          type="tmdb"
          src={`https://image.tmdb.org/t/p/w185${movie.poster}`}
          alt=""
          fill
          sizes="96px"
          style={{ objectFit: 'cover' }}
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-full items-center justify-center whitespace-normal break-words p-2 text-center text-xs text-gray-300 [overflow-wrap:anywhere]"
        >
          {movie.title}
        </span>
      )}
    </div>
  );
}

export default function ListEditor({
  listId,
  onClose,
  onSaved,
  userId,
  onDeleted,
}: {
  userId: number;
  listId?: string;
  onClose: () => void;
  onSaved: (id: string) => void;
  onDeleted?: () => void;
}) {
  const t = usePartyText();
  const draftKey = listDraftKey(userId, listId);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [recovery, setRecovery] = useState<ListDraft>();
  const [storageFailed, setStorageFailed] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [mode, setMode] = useState<'choose' | 'paste' | 'review'>(
    listId ? 'review' : 'choose'
  );
  const [title, setTitle] = useState(''),
    [description, setDescription] = useState(''),
    [text, setText] = useState('');
  const [rows, setRows] = useState<Row[]>([]),
    [busy, setBusy] = useState(!!listId),
    [error, setError] = useState('');
  const [loaded, setLoaded] = useState(!listId),
    [revision, setRevision] = useState<number>();
  const dirty = useRef(false),
    sequence = useRef(0),
    controller = useRef(new AbortController());
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    try {
      const raw = localStorage.getItem(draftKey),
        draft = parseListDraft(raw);
      setRecovery(draft);
      if (raw && !draft) localStorage.removeItem(draftKey);
    } catch {
      setStorageFailed(true);
    }
    setDraftReady(true);
    if (listId) {
      axios
        .get<EditableCatalogueList>(`${endpoint}/${listId}`, {
          signal: abort.signal,
        })
        .then(({ data }) => {
          setTitle(data.title);
          setDescription(data.description);
          setRevision(data.revision);
          setVisibility(data.visibility || 'public');
          setRows(
            data.movies.map((movie) => ({
              id: ++sequence.current,
              query: `${movie.title}${movie.year ? ` (${movie.year})` : ''}`,
              movie,
            }))
          );
          setLoaded(true);
        })
        .catch((e) => {
          if (!axios.isCancel(e))
            setError(
              t(
                'Could not load this list. Close and retry.',
                'No se pudo cargar la lista. Cierra e intenta de nuevo.'
              )
            );
        })
        .finally(() => {
          if (!abort.signal.aborted) setBusy(false);
        });
    }
    return () => abort.abort();
    // The editor is mounted afresh for each list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId, draftKey]);
  useEffect(() => {
    if (!draftReady || !loaded || !dirty.current || recovery) return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          version: 1,
          updatedAt: Date.now(),
          title,
          description,
          text,
          mode,
          visibility,
          revision,
          rows: rows.map(({ id, query, movie }) => ({ id, query, movie })),
        })
      );
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }, [
    draftReady,
    loaded,
    recovery,
    draftKey,
    title,
    description,
    text,
    mode,
    visibility,
    revision,
    rows,
  ]);
  const clearDraft = () => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* Saving/deleting the server list still succeeds. */
    }
  };
  const change = (id: number, patch: Partial<Row>) => {
    dirty.current = true;
    setRows((old) => old.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const search = async (row: Row, page = 1, auto = false) => {
    try {
      const { data } = await axios.get<{
        results: MovieChoice[];
        total: number;
        next: number | null;
      }>(`${endpoint}/search`, {
        params: { query: row.query, page },
        signal: controller.current.signal,
      });
      change(row.id, {
        results:
          page === 1 ? data.results : [...(row.results || []), ...data.results],
        movie: auto
          ? exactMovieChoice(row.query, data.results, data.total)
          : undefined,
        next: data.next,
        error: undefined,
      });
    } catch (e) {
      if (!axios.isCancel(e))
        change(row.id, {
          error: t(
            'Search failed. Please try again.',
            'Falló la búsqueda. Intenta de nuevo.'
          ),
        });
    }
  };
  const runSearch = async (row: Row, page = 1) => {
    setBusy(true);
    await search(row, page);
    setBusy(false);
  };
  const add = () => {
    dirty.current = true;
    setRows((old) => [...old, { id: ++sequence.current, query: '' }]);
  };
  const move = (index: number, delta: number) => {
    dirty.current = true;
    setRows((old) => {
      const next = [...old];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
  };
  const close = () => {
    if (
      !busy &&
      (!dirty.current ||
        window.confirm(
          t(
            storageFailed
              ? 'Close without saving? Draft recovery is unavailable on this device.'
              : 'Close editor? Your draft will be kept on this device.',
            storageFailed
              ? '¿Cerrar sin guardar? No se pueden recuperar borradores en este dispositivo.'
              : '¿Cerrar el editor? Tu borrador quedará en este dispositivo.'
          )
        ))
    )
      onClose();
  };
  const duplicates =
    new Set(rows.flatMap((r) => (r.movie ? [r.movie.id] : []))).size !==
    rows.filter((r) => r.movie).length;
  const unresolved = rows.some((r) => !r.movie);
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const body = {
        title,
        description,
        visibility,
        movieIds: rows.map((r) => r.movie!.id),
        ...(listId ? { revision } : {}),
      };
      const { data } = listId
        ? await axios.put(`${endpoint}/${listId}`, body, {
            signal: controller.current.signal,
          })
        : await axios.post(endpoint, body, {
            signal: controller.current.signal,
          });
      dirty.current = false;
      clearDraft();
      onSaved(data.id);
    } catch (e) {
      if (!axios.isCancel(e))
        setError(
          e.response?.data?.message ||
            t(
              'Could not save. Your changes are still here; try again.',
              'No se pudo guardar. Tus cambios siguen aquí; intenta de nuevo.'
            )
        );
    } finally {
      setBusy(false);
    }
  };
  const removeList = async () => {
    if (
      !listId ||
      !window.confirm(
        t(
          'Delete this list? It will disappear for everyone who saved it. Movies and watch history are not affected.',
          '¿Eliminar esta lista? Desaparecerá para quienes la guardaron. No afecta películas ni historial.'
        )
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await axios.delete(`${endpoint}/${listId}`, {
        data: { revision },
        signal: controller.current.signal,
      });
      dirty.current = false;
      clearDraft();
      onDeleted?.();
    } catch (e) {
      setError(
        e.response?.data?.message ||
          t('Could not delete. Try again.', 'No se pudo eliminar. Reintenta.')
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Transition show appear>
      <Modal
        title={
          listId
            ? t('Edit list', 'Editar lista')
            : t('Create list', 'Crear lista')
        }
        onCancel={close}
        backgroundClickable={false}
        cancelButtonProps={{ disabled: busy }}
        onOk={mode === 'review' ? () => void save() : undefined}
        onTertiary={listId && onDeleted ? () => void removeList() : undefined}
        tertiaryText={t('Delete list', 'Eliminar lista')}
        tertiaryButtonType="danger"
        tertiaryDisabled={busy || !loaded || !!recovery}
        okText={
          listId
            ? t('Save changes', 'Guardar cambios')
            : t('Create list', 'Crear lista')
        }
        okDisabled={
          !loaded ||
          !!recovery ||
          busy ||
          !title.trim() ||
          !rows.length ||
          unresolved ||
          duplicates
        }
        dialogClass="sm:!max-w-2xl"
      >
        <div className="space-y-4 py-4 text-gray-200">
          {recovery && (
            <div className="space-y-3 rounded-lg border border-purple-400 p-3">
              <p>
                {t(
                  'An unfinished draft is saved on this device.',
                  'Hay un borrador guardado en este dispositivo.'
                )}
              </p>
              {listId && recovery.revision !== revision && loaded && (
                <p className="text-sm text-amber-300">
                  {t(
                    'The saved list has changed since this draft. Restoring it keeps conflict protection; it cannot overwrite the newer version.',
                    'La lista cambió desde este borrador. Restaurarlo conserva la protección: no sobrescribirá la versión nueva.'
                  )}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  className={button}
                  disabled={!loaded || busy}
                  onClick={() => {
                    setTitle(recovery.title);
                    setDescription(recovery.description);
                    setText(recovery.text);
                    setMode(recovery.mode);
                    setVisibility(recovery.visibility);
                    setRows(recovery.rows);
                    setRevision(recovery.revision);
                    sequence.current = Math.max(
                      0,
                      ...recovery.rows.map((r) => r.id)
                    );
                    dirty.current = true;
                    setRecovery(undefined);
                  }}
                >
                  {t('Restore draft', 'Restaurar borrador')}
                </button>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => {
                    clearDraft();
                    setRecovery(undefined);
                  }}
                >
                  {t('Discard draft', 'Descartar borrador')}
                </button>
              </div>
            </div>
          )}
          <p className="text-sm text-gray-400">
            {t(
              'Stored in the catalogue. Never published to Letterboxd.',
              'Guardada en el catálogo. Nunca se publica en Letterboxd.'
            )}
          </p>
          <label className="block text-sm">
            {t('Visibility', 'Visibilidad')}
            <select
              aria-label={t('Visibility', 'Visibilidad')}
              className={`${input} mt-1`}
              value={visibility}
              disabled={busy || !loaded || !!recovery}
              onChange={(e) => {
                dirty.current = true;
                setVisibility(e.target.value as 'public' | 'private');
              }}
            >
              <option value="public">
                {t(
                  'Shared — catalogue users',
                  'Compartida — usuarios del catálogo'
                )}
              </option>
              <option value="private">
                {t('Private — only you', 'Privada — solo tú')}
              </option>
            </select>
          </label>
          <p className="text-xs text-gray-400">
            {storageFailed
              ? t(
                  'Draft recovery is unavailable. Keep this window open until you save.',
                  'No se puede guardar el borrador. Mantén esta ventana abierta hasta guardar.'
                )
              : t(
                  'Drafts stay on this device for 30 days, separately for each account.',
                  'Los borradores quedan en este dispositivo 30 días, separados por cuenta.'
                )}
          </p>
          <label className="block text-sm">
            {t('List name', 'Nombre de la lista')}
            <input
              className={`${input} mt-1`}
              value={title}
              maxLength={200}
              disabled={busy || !loaded}
              onChange={(e) => {
                dirty.current = true;
                setTitle(e.target.value);
              }}
            />
          </label>
          <label className="block text-sm">
            {t('Description (optional)', 'Descripción (opcional)')}
            <textarea
              rows={2}
              className={`${input} mt-1`}
              maxLength={5000}
              value={description}
              disabled={busy || !loaded}
              onChange={(e) => {
                dirty.current = true;
                setDescription(e.target.value);
              }}
            />
          </label>
          {mode === 'choose' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                className={`${button} py-5 text-left`}
                onClick={() => setMode('paste')}
              >
                <strong className="block text-purple-300">
                  {t('Paste movie list', 'Pegar lista de películas')}
                </strong>
                <span>
                  {t(
                    'One movie per line. Year optional.',
                    'Una película por línea. Año opcional.'
                  )}
                </span>
              </button>
              <button
                className={`${button} py-5 text-left`}
                onClick={() => {
                  setMode('review');
                  add();
                }}
              >
                <strong className="block text-purple-300">
                  {t('Add movies individually', 'Añadir películas una por una')}
                </strong>
                <span>
                  {t(
                    'Search and choose each movie.',
                    'Busca y elige cada película.'
                  )}
                </span>
              </button>
            </div>
          )}
          {mode === 'paste' && (
            <>
              <label className="block text-sm">
                {t(
                  'Movies — one per line, up to 200',
                  'Películas — una por línea, hasta 200'
                )}
                <textarea
                  aria-label={t('Movie list', 'Lista de películas')}
                  className={`${input} mt-1`}
                  rows={7}
                  maxLength={60000}
                  placeholder={'Arrival (2016)\nDune\nSpirited Away'}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    dirty.current = true;
                  }}
                />
              </label>
              <div className="flex gap-2">
                <button
                  className={button}
                  onClick={() =>
                    setMode(rows.length || listId ? 'review' : 'choose')
                  }
                >
                  {t('Back', 'Atrás')}
                </button>
                <button
                  className={button}
                  disabled={!text.trim()}
                  onClick={async () => {
                    const lines = text
                      .split(/\r?\n/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                    if (
                      lines.length + rows.length > 200 ||
                      lines.some((s) => s.length > 300)
                    ) {
                      setError(
                        t(
                          'Use up to 200 lines, each under 300 characters.',
                          'Usa hasta 200 líneas de menos de 300 caracteres.'
                        )
                      );
                      return;
                    }
                    const draft = lines.map((query) => ({
                      id: ++sequence.current,
                      query,
                    }));
                    setRows((old) => [...old, ...draft]);
                    setText('');
                    dirty.current = true;
                    setMode('review');
                    setError('');
                    setBusy(true);
                    let cursor = 0;
                    await Promise.all(
                      Array.from(
                        { length: Math.min(3, draft.length) },
                        async () => {
                          while (
                            cursor < draft.length &&
                            !controller.current.signal.aborted
                          )
                            await search(draft[cursor++], 1, true);
                        }
                      )
                    );
                    setBusy(false);
                  }}
                >
                  {t('Find movies', 'Buscar películas')}
                </button>
              </div>
            </>
          )}
          {mode === 'review' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <h3 className="font-semibold">
                  {t('Review movies', 'Revisar películas')} · {rows.length}
                </h3>
                <span className="text-gray-400">
                  {t('Your order is preserved', 'Se conserva tu orden')}
                </span>
              </div>
              <div className="divide-y divide-gray-700">
                {rows.map((row, index) => (
                  <section
                    key={row.id}
                    aria-label={`${t('Movie', 'Película')} ${index + 1}`}
                    className="py-4"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-400">{index + 1}</span>
                      <div className="flex gap-1">
                        <button
                          className="px-2 py-1 disabled:opacity-30"
                          aria-label={t('Move up', 'Subir')}
                          disabled={busy || index === 0}
                          onClick={() => move(index, -1)}
                        >
                          ↑
                        </button>
                        <button
                          className="px-2 py-1 disabled:opacity-30"
                          aria-label={t('Move down', 'Bajar')}
                          disabled={busy || index === rows.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          ↓
                        </button>
                        <button
                          className="px-2 py-1 text-sm text-gray-400"
                          disabled={busy}
                          onClick={() => {
                            dirty.current = true;
                            setRows((old) =>
                              old.filter((r) => r.id !== row.id)
                            );
                          }}
                        >
                          {row.movie || row.results === undefined
                            ? t('Remove', 'Quitar')
                            : t('Skip', 'Omitir')}
                        </button>
                      </div>
                    </div>
                    {row.movie ? (
                      <div className="flex items-center gap-4">
                        <div className="w-20 shrink-0">
                          <Poster movie={row.movie} />
                        </div>
                        <div className="min-w-0">
                          <h4 className="whitespace-normal break-words font-semibold [overflow-wrap:anywhere]">
                            {row.movie.title}{' '}
                            {row.movie.year && (
                              <span className="font-normal text-gray-400">
                                ({row.movie.year})
                              </span>
                            )}
                          </h4>
                          <button
                            className="mt-2 py-1 text-sm text-purple-300"
                            disabled={busy}
                            onClick={() =>
                              change(row.id, {
                                movie: undefined,
                                results: undefined,
                                error: undefined,
                              })
                            }
                          >
                            {t('✎ Fix match', '✎ Corregir coincidencia')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <form
                          className="flex gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (!busy && row.query.trim()) void runSearch(row);
                          }}
                        >
                          <input
                            className={input}
                            aria-label={t(
                              'Movie title and optional year',
                              'Título y año opcional'
                            )}
                            placeholder={t(
                              'Movie title (year)',
                              'Título (año)'
                            )}
                            value={row.query}
                            maxLength={300}
                            disabled={busy}
                            onChange={(e) =>
                              change(row.id, {
                                query: e.target.value,
                                results: undefined,
                                next: null,
                                error: undefined,
                              })
                            }
                          />
                          <button
                            className={button}
                            disabled={busy || !row.query.trim()}
                          >
                            {row.results?.length === 0 || row.error
                              ? t('Try again', 'Reintentar')
                              : t('Search', 'Buscar')}
                          </button>
                        </form>
                        {row.error && (
                          <p role="alert" className="text-sm text-red-300">
                            {row.error}
                          </p>
                        )}
                        {row.results?.length === 0 && (
                          <p className="text-sm text-amber-300">
                            {t(
                              'No matches. Edit the title or year and try again, or skip this row.',
                              'Sin coincidencias. Edita el título o año y reintenta, u omite esta fila.'
                            )}
                          </p>
                        )}
                        {row.results?.length === 0 &&
                          parseMovieLine(row.query).year && (
                            <button
                              className={`${button} text-purple-300`}
                              disabled={busy}
                              onClick={() => {
                                const query = parseMovieLine(row.query).title;
                                change(row.id, {
                                  query,
                                  results: undefined,
                                  next: null,
                                });
                                void runSearch({ ...row, query });
                              }}
                            >
                              {t('Try without year', 'Intentar sin año')}
                            </button>
                          )}
                        {!!row.results?.length && (
                          <>
                            <p className="text-sm text-amber-200">
                              {t(
                                'Choose the right movie',
                                'Elige la película correcta'
                              )}
                            </p>
                            <div className="grid w-full min-w-0 max-w-sm grid-cols-3 items-start gap-3">
                              {row.results.map((movie) => (
                                <button
                                  key={movie.id}
                                  className="w-full min-w-0 max-w-full whitespace-normal rounded-lg text-left focus:ring-2 focus:ring-purple-400"
                                  disabled={busy}
                                  onClick={() => change(row.id, { movie })}
                                >
                                  <Poster movie={movie} />
                                  <span className="mt-1 block whitespace-normal break-words text-sm [overflow-wrap:anywhere]">
                                    {movie.title}
                                  </span>
                                  <span className="text-xs text-gray-400">
                                    {movie.year || '—'}
                                  </span>
                                </button>
                              ))}
                            </div>
                            {row.next && (
                              <button
                                className={button}
                                disabled={busy}
                                onClick={() => void runSearch(row, row.next!)}
                              >
                                {t('More results', 'Más resultados')}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </section>
                ))}
              </div>
              <button
                className="flex w-full items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-600 py-6 text-purple-300 disabled:opacity-40"
                disabled={busy || rows.length >= 200 || !loaded}
                onClick={add}
              >
                <span aria-hidden="true" className="text-3xl">
                  +
                </span>
                {t('Add movie', 'Añadir película')}
              </button>
              <button
                className={`${button} w-full`}
                disabled={busy || rows.length >= 200 || !loaded}
                onClick={() => setMode('paste')}
              >
                {t('Add in bulk', 'Añadir en bloque')}
              </button>
              {unresolved && (
                <p className="text-sm text-gray-400">
                  {t(
                    'Choose a match or remove/skip each unfinished row before saving.',
                    'Elige una coincidencia o quita/omite cada fila pendiente antes de guardar.'
                  )}
                </p>
              )}
              {duplicates && (
                <p role="alert" className="text-sm text-amber-300">
                  {t(
                    'This list contains the same movie twice. Remove a duplicate before saving.',
                    'La lista contiene una película repetida. Quita el duplicado antes de guardar.'
                  )}
                </p>
              )}
            </>
          )}
          {busy && (
            <p role="status" className="flex items-center gap-2 text-sm">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-purple-300 border-t-transparent" />
              {t('Working…', 'Procesando…')}
            </p>
          )}
          {error && (
            <p role="alert" className="text-red-300">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </Transition>
  );
}
