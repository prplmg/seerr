import DeferredSection from '@app/components/Common/DeferredSection';
import { usePartyText } from '@app/components/WatchParty/messages';
import useDiscovery from '@app/hooks/useDiscovery';
import { useUser } from '@app/hooks/useUser';
import { forYouLayout, type ForYouRow } from '@server/lib/forYouLayout';
import axios from 'axios';
import { useEffect, useState, type ReactNode } from 'react';
import useSWR from 'swr';

/** Match poster breakpoints/aspect ratio and heading wrapping, not a fixed row height. */
export function RowPlaceholder({ id, title }: { id: string; title: string }) {
  const lists = [
    'continueLists',
    'activity',
    'almostFinished',
    'explore',
  ].includes(id);
  const episodes = id === 'episodes';
  return (
    <section className="my-8" role="status" aria-label={`Loading: ${title}`}>
      <div className="relative mb-3">
        <h2 className="text-2xl font-bold">
          <span className="inline-flex items-center gap-2">
            {title}
            {!lists && !episodes && (
              <span className="inline-block h-6 w-6 shrink-0" />
            )}
          </span>
        </h2>
      </div>
      <div
        aria-hidden="true"
        className="relative -mx-4 -my-2 overflow-hidden whitespace-nowrap px-2 py-2"
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="inline-block px-2 align-top">
            {lists ? (
              <div className="w-80 max-w-[85vw] rounded-xl border border-gray-700 bg-gray-800 p-4 sm:w-96">
                <div className="mb-3 h-28 animate-pulse rounded bg-gray-700" />
                <div className="flex -space-x-3">
                  {[0, 1, 2].map((j) => (
                    <div
                      key={j}
                      className="aspect-[2/3] min-w-0 flex-1 animate-pulse rounded-xl bg-gray-700"
                    />
                  ))}
                </div>
                <div className="mt-3 h-11 w-24 rounded bg-gray-700" />
              </div>
            ) : episodes ? (
              <div className="w-72 overflow-hidden rounded-xl bg-gray-800 sm:w-80">
                <div className="aspect-video animate-pulse bg-gray-700" />
                <div className="space-y-2 p-4">
                  <div className="h-6 bg-gray-700" />
                  <div className="h-12 bg-gray-700" />
                  <div className="h-5 bg-gray-700" />
                  <div className="h-6 bg-gray-700" />
                </div>
              </div>
            ) : (
              <div className="w-36 md:w-44">
                <div className="aspect-[2/3] animate-pulse rounded-xl bg-gray-700" />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function ForYouLayout({
  children,
  editing = false,
  onClose = () => {},
}: {
  children: Partial<Record<ForYouRow['id'], ReactNode>>;
  editing?: boolean;
  onClose?: () => void;
}) {
  const { read, readOnly, previewUserId } = useDiscovery();
  const { user } = useUser();
  const t = usePartyText();
  const { data, error, mutate } = useSWR<ForYouRow[]>(
    ['/api/v1/discovery-lists/layout', user?.id, previewUserId],
    read
  );
  const [draft, setDraft] = useState<ForYouRow[]>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (editing && data && !readOnly) setDraft((previous) => previous ?? data);
  }, [editing, data, readOnly]);
  const labels: Record<ForYouRow['id'], string> = {
    unfinished: t('Unfinished series', 'Series sin terminar'),
    unrated: t('Just watched, unrated', 'Recién vistas, sin calificar'),
    requested: t(
      'You requested, still unwatched',
      'Las pediste, aún no las ves'
    ),
    episodes: t('New episodes for you', 'Nuevos episodios para ti'),
    movies: t(
      'New movies for you',
      'Nuevas películas para ti'
    ),
    recommendations: t('For your taste', 'Para tus gustos'),
    available: t('Available from your lists', 'Disponibles de tus listas'),
    friendsLoved: t('Friends loved', 'Favoritas de amigos'),
    activity: t(
      'Lists matching your recent watches',
      'Listas que coinciden con tus vistas recientes'
    ),
    continueLists: t('Pick up where you left off', 'Retoma donde lo dejaste'),
    almostFinished: t('Almost finished', 'Casi terminadas'),
    explore: t('Lists to explore', 'Listas para explorar'),
  };
  if (error)
    return (
      <p role="alert">
        {t(
          'Could not load your layout. Reload to retry.',
          'No se pudo cargar tu diseño. Recarga para reintentar.'
        )}
      </p>
    );
  if (!data)
    return (
      <p role="status">
        {t('Loading your sections…', 'Cargando tus secciones…')}
      </p>
    );
  return (
    <>
      {draft && !readOnly && (
        <fieldset disabled={busy} className="my-4 rounded-xl bg-gray-800 p-4">
          <legend>{t('Your sections', 'Tus secciones')}</legend>
          {draft.map((row, index) => (
            <div key={row.id} className="flex items-center gap-3 py-2">
              <label className="flex flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  checked={row.enabled}
                  onChange={(e) =>
                    setDraft(
                      draft.map((item) =>
                        item.id === row.id
                          ? { ...item, enabled: e.target.checked }
                          : item
                      )
                    )
                  }
                />
                {labels[row.id]}
              </label>
              {[-1, 1].map((direction) => (
                <button
                  key={direction}
                  aria-label={`${direction < 0 ? t('Move up', 'Subir') : t('Move down', 'Bajar')}: ${labels[row.id]}`}
                  disabled={
                    index + direction < 0 || index + direction >= draft.length
                  }
                  onClick={() => {
                    const next = [...draft];
                    [next[index], next[index + direction]] = [
                      next[index + direction],
                      next[index],
                    ];
                    setDraft(next);
                  }}
                  className="px-2 disabled:opacity-30"
                >
                  {direction < 0 ? '↑' : '↓'}
                </button>
              ))}
            </div>
          ))}
          <div className="mt-4 flex gap-4">
            <button
              onClick={async () => {
                setBusy(true);
                setFailed(false);
                try {
                  await mutate(
                    (await axios.put('/api/v1/discovery-lists/layout', draft))
                      .data,
                    false
                  );
                  setDraft(undefined);
                  onClose();
                } catch {
                  setFailed(true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('Save', 'Guardar')}
            </button>
            <button
              onClick={() => {
                setDraft(undefined);
                onClose();
              }}
            >
              {t('Cancel', 'Cancelar')}
            </button>
            <button onClick={() => setDraft(forYouLayout())}>
              {t('Reset to default', 'Restablecer')}
            </button>
          </div>
          {failed && (
            <p role="alert">
              {t(
                'Could not save. Try again.',
                'No se pudo guardar. Intenta de nuevo.'
              )}
            </p>
          )}
        </fieldset>
      )}
      {data
        .filter((row) => row.enabled)
        .map((row) => (
          <DeferredSection
            key={row.id}
            placeholder={<RowPlaceholder id={row.id} title={labels[row.id]} />}
          >
            {children[row.id]}
          </DeferredSection>
        ))}
    </>
  );
}
