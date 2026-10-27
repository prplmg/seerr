import Button from '@app/components/Common/Button';
import { usePartyText } from '@app/components/WatchParty/messages';
import { Permission, useUser } from '@app/hooks/useUser';
import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { importAll } from './importAll';
type Entry = {
  key: string;
  title: string;
  year: string;
  tmdbId: number | null;
  text: string;
  rating: number | null;
  spoiler: boolean;
};
export default function LetterboxdSettings({ userId }: { userId: number }) {
  const t = usePartyText(),
    { hasPermission, user } = useUser(),
    isAdmin = hasPermission(Permission.ADMIN),
    canManage = isAdmin || user?.id === userId;
  const { data, mutate } = useSWR<{
    account: {
      username: string;
      enabled: boolean;
      lastSync: string | null;
      error: string | null;
    } | null;
  }>(`/api/v1/reviews/account/${userId}`);
  const [username, setUsername] = useState(''),
    [upload, setUpload] = useState<{
      csv?: string;
      zip?: string;
      filename?: string;
    }>({}),
    [offset, setOffset] = useState(0),
    [preview, setPreview] = useState<{
      results: Entry[];
      total: number;
      nextOffset: number | null;
      counts: { watched: number; ratings: number; reviews: number };
    } | null>(null),
    [matches, setMatches] = useState<Record<string, number>>({}),
    [mediaTypes, setMediaTypes] = useState<Record<string, 'movie' | 'tv'>>({}),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const [skipped, setSkipped] = useState<Entry[]>([]);
  const nextImportOffset = useRef(0),
    stopImport = useRef(false),
    importing = useRef(false);
  useEffect(
    () => () => {
      stopImport.current = true;
    },
    []
  );
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setMessage('');
    try {
      await work();
      await mutate();
    } catch {
      setMessage(
        t(
          'Could not complete this action. Check the account/file and try again.',
          'No se pudo completar la acción. Revisa la cuenta o el archivo e inténtalo de nuevo.'
        )
      );
    } finally {
      setBusy(false);
    }
  }
  async function loadPreview(value: typeof upload, start = 0) {
    const r = await axios.post(`/api/v1/reviews/import/${userId}`, {
      ...value,
      offset: start,
      mode: 'preview',
    });
    setPreview(r.data);
    setOffset(start);
    setConfirmed(false);
    if (start === 0) {
      setMatches({});
      setMediaTypes({});
    }
  }
  async function importFile() {
    if (importing.current || !preview) return;
    importing.current = true;
    stopImport.current = false;
    setBusy(true);
    setMessage('');
    setImportProgress(nextImportOffset.current);
    try {
      const complete = await importAll<Entry>({
        start: nextImportOffset.current,
        stopped: () => stopImport.current,
        send: async (offset) =>
          (
            await axios.post(`/api/v1/reviews/import/${userId}`, {
              ...upload,
              offset,
              mode: 'commit',
              confirmPublic: true,
              mediaTypes,
              matches: Object.fromEntries(
                Object.entries(matches).filter(([, v]) => v > 0)
              ),
            })
          ).data,
        progress: (done, batch) => {
          nextImportOffset.current = done;
          setImportProgress(done);
          setSkipped((old) => [
            ...new Map(
              [...old, ...batch.results.filter((r) => !r.tmdbId)].map((r) => [
                r.key,
                r,
              ])
            ).values(),
          ]);
        },
      });
      setMessage(
        complete
          ? t(
              'Import complete. Matched entries are saved; any unmatched entries are listed below.',
              'Importación completa. Las entradas identificadas están guardadas; las no identificadas aparecen abajo.'
            )
          : t(
              'Import paused. Resume to continue from the last completed batch.',
              'Importación pausada. Reanuda para continuar desde el último lote completado.'
            )
      );
      if (complete) setPreview(null);
      await mutate().catch(() => undefined);
    } catch {
      setMessage(
        t(
          'Import stopped. Completed batches are saved. Click Resume import to retry the remaining entries. If you close this page, upload the same file again; existing entries will not be duplicated.',
          'La importación se detuvo. Los lotes completados están guardados. Pulsa Reanudar importación para reintentar las entradas restantes. Si cierras esta página, vuelve a subir el mismo archivo; las entradas existentes no se duplicarán.'
        )
      );
    } finally {
      importing.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="my-8 space-y-4 rounded-xl border border-gray-700 bg-gray-800 p-4 text-white">
      <h3 className="text-overseerr text-xl font-bold">Letterboxd</h3>
      <p className="text-gray-300">
        {t(
          'Import watched titles, ratings and reviews, then check the public RSS feed every 15 minutes. This does not write to Letterboxd.',
          'Importa títulos vistos, calificaciones y reseñas; después se consulta el RSS público cada 15 minutos. Esto no escribe en Letterboxd.'
        )}
      </p>
      {canManage ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              await axios.put(`/api/v1/reviews/account/${userId}`, {
                username: data?.account?.username || username,
                enabled: true,
              });
            });
          }}
        >
          <label>
            {t('Letterboxd username', 'Usuario de Letterboxd')}
            <input
              className="ml-2 rounded bg-gray-900 p-2 text-white"
              value={data?.account?.username || username}
              disabled={!!data?.account || busy}
              onChange={(e) => setUsername(e.target.value)}
              pattern="[A-Za-z0-9_]{1,40}"
              required
            />
          </label>
          <Button type="submit" disabled={busy}>
            {t('Enable RSS', 'Activar RSS')}
          </Button>
          {data?.account && (
            <Button
              disabled={busy}
              type="button"
              onClick={() =>
                void action(async () => {
                  await axios.put(`/api/v1/reviews/account/${userId}`, {
                    username: data.account!.username,
                    enabled: false,
                  });
                })
              }
            >
              {t('Pause RSS', 'Pausar RSS')}
            </Button>
          )}
        </form>
      ) : (
        <p>
          {data?.account
            ? data.account.username
            : t(
                'Ask an administrator to link your Letterboxd username.',
                'Pide a un administrador que vincule tu usuario de Letterboxd.'
              )}
        </p>
      )}
      <aside className="rounded-lg border border-purple-400/30 bg-gray-900 p-3 text-sm text-gray-300">
        {t(
          'For full sync integration, contact Melanie. You’ll need to provide your Letterboxd username and password privately for setup. Do not enter your password here.',
          'Para la integración de sincronización completa, contacta a Melanie. Tendrás que proporcionar tu usuario y contraseña de Letterboxd en privado para configurarla. No escribas tu contraseña aquí.'
        )}
      </aside>
      {data?.account && (
        <>
          <p className="text-sm text-gray-300">
            {data.account.enabled
              ? t('RSS enabled', 'RSS activo')
              : t('RSS paused', 'RSS pausado')}{' '}
            · {t('Last successful sync:', 'Última sincronización correcta:')}{' '}
            {data.account.lastSync
              ? new Date(data.account.lastSync).toLocaleString()
              : t('Not yet', 'Todavía no')}
          </p>
          {data.account.error && (
            <p role="status" className="text-yellow-300">
              {data.account.error === 'unresolved'
                ? t(
                    'Some films could not be matched. Existing reviews are safe.',
                    'No se pudieron identificar algunas películas. Las reseñas existentes están guardadas.'
                  )
                : t(
                    'RSS is temporarily unavailable. Existing reviews are safe.',
                    'El RSS no está disponible temporalmente. Las reseñas existentes están guardadas.'
                  )}
            </p>
          )}
          <Button
            disabled={busy || !data.account.enabled}
            onClick={() =>
              void action(async () => {
                await axios.post(`/api/v1/reviews/account/${userId}/sync`);
              })
            }
          >
            {t('Check RSS now', 'Consultar RSS ahora')}
          </Button>
          {isAdmin && (
            <Button
              buttonType="danger"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    t(
                      'Unlink Letterboxd and delete its imported watched titles, ratings and reviews? Local reviews and other watch-history sources will stay.',
                      '¿Desvincular Letterboxd y eliminar sus títulos vistos, calificaciones y reseñas importadas? Las reseñas locales y las otras fuentes del historial se conservarán.'
                    )
                  )
                )
                  void action(async () => {
                    await axios.delete(`/api/v1/reviews/account/${userId}`);
                    setPreview(null);
                    setUsername('');
                  });
              }}
            >
              {t(
                'Unlink and remove imports',
                'Desvincular y eliminar importaciones'
              )}
            </Button>
          )}
          <label className="block">
            <a
              href="https://letterboxd.com/user/exportdata/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-overseerr underline"
            >
              {t(
                'Upload your complete Letterboxd ZIP (up to 10 MB)',
                'Sube el ZIP completo de Letterboxd (hasta 10 MB)'
              )}
            </a>
            {t(
              ', or reviews.csv, ratings.csv, diary.csv or watched.csv (up to 2 MB each). No need to unzip.',
              ', o reviews.csv, ratings.csv, diary.csv o watched.csv (hasta 2 MB cada uno). No es necesario descomprimirlo.'
            )}
            <input
              type="file"
              accept=".csv,.zip,text/csv,application/zip"
              disabled={busy}
              className="mt-2 block max-w-full"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void action(async () => {
                    setPreview(null);
                    setConfirmed(false);
                    const zipped = file.name.toLowerCase().endsWith('.zip');
                    if (file.size > (zipped ? 10 : 2) * 1024 * 1024)
                      throw Error('large');
                    const value: typeof upload = zipped
                      ? {
                          zip: await new Promise<string>((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () =>
                              resolve(String(reader.result).split(',')[1]);
                            reader.onerror = () => reject(Error('Read failed'));
                            reader.readAsDataURL(file);
                          }),
                        }
                      : {
                          csv: await file.text(),
                          filename: file.name.toLowerCase(),
                        };
                    setUpload(value);
                    nextImportOffset.current = 0;
                    setImportProgress(null);
                    setSkipped([]);
                    await loadPreview(value);
                  });
              }}
            />
          </label>
          {preview && (
            <div className="space-y-3">
              <p className="text-sm text-gray-300">
                {t(
                  'Source records (overlaps are merged):',
                  'Registros de origen (se combinan las coincidencias):'
                )}{' '}
                {preview.counts.watched} {t('watched', 'vistos')} ·{' '}
                {preview.counts.ratings} {t('ratings', 'calificaciones')} ·{' '}
                {preview.counts.reviews} {t('reviews', 'reseñas')}
              </p>
              <p>
                {t('Preview entries', 'Vista previa de entradas')} {offset + 1}–
                {offset + preview.results.length} / {preview.total}
              </p>
              <div className="max-h-96 space-y-3 overflow-y-auto">
                {preview.results.map((r) => (
                  <div
                    key={r.key}
                    className="rounded border border-gray-600 p-3"
                  >
                    <strong>
                      {r.title} ({r.year})
                    </strong>
                    <p className="text-green-400">
                      {r.rating === null ? '—' : `${r.rating}/5`}
                    </p>
                    <p className="line-clamp-3 whitespace-pre-wrap text-sm text-gray-300">
                      {r.text}
                    </p>
                    <label className="mt-2 block text-sm">
                      {r.tmdbId
                        ? `TMDB: ${r.tmdbId}`
                        : t(
                            'Unmatched — select the type and enter its TMDB ID, or leave blank to skip.',
                            'Sin identificar: selecciona el tipo y escribe su ID de TMDB, o déjalo vacío para omitirlo.'
                          )}
                      {!r.tmdbId && (
                        <>
                          <select
                            disabled={busy}
                            className="ml-2 rounded bg-gray-900 p-1"
                            aria-label={t('Media type', 'Tipo de contenido')}
                            value={mediaTypes[r.key] || 'movie'}
                            onChange={(e) =>
                              setMediaTypes({
                                ...mediaTypes,
                                [r.key]: e.target.value as 'movie' | 'tv',
                              })
                            }
                          >
                            <option value="movie">
                              {t('Movie', 'Película')}
                            </option>
                            <option value="tv">{t('Series', 'Serie')}</option>
                          </select>
                          <input
                            disabled={busy}
                            type="number"
                            min={1}
                            className="ml-2 w-28 rounded bg-gray-900 p-1"
                            value={matches[r.key] || ''}
                            onChange={(e) =>
                              setMatches({
                                ...matches,
                                [r.key]: Number(e.target.value),
                              })
                            }
                          />
                        </>
                      )}
                    </label>
                  </div>
                ))}
              </div>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                {t(
                  'Publish all matched entries in this file to catalogue members. I checked that the file contains no private or deleted content.',
                  'Publicar todas las entradas identificadas de este archivo para los miembros del catálogo. Revisé que el archivo no contenga contenido privado ni eliminado.'
                )}
              </label>
              <Button
                disabled={busy || !confirmed}
                onClick={() => void importFile()}
              >
                {importProgress === null
                  ? t('Import entire file', 'Importar archivo completo')
                  : t('Resume import', 'Reanudar importación')}
              </Button>
              {preview.nextOffset !== null && importProgress === null && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void action(() => loadPreview(upload, preview.nextOffset!))
                  }
                >
                  {t('Preview next batch', 'Ver siguiente lote')}
                </Button>
              )}
            </div>
          )}
          {importProgress !== null && (
            <div role="status" className="space-y-2">
              {t('Processed records:', 'Registros procesados:')}{' '}
              {importProgress}
              {preview ? ` / ${preview.total}` : ''}
              {preview && (
                <progress
                  className="block w-full"
                  max={preview.total || 1}
                  value={importProgress}
                />
              )}
              {busy && (
                <>
                  <p>
                    {t(
                      'Keep this page open until the import finishes.',
                      'Mantén esta página abierta hasta que termine la importación.'
                    )}
                  </p>
                  <Button
                    onClick={() => {
                      stopImport.current = true;
                    }}
                  >
                    {t('Pause after this batch', 'Pausar después de este lote')}
                  </Button>
                </>
              )}
            </div>
          )}
          {!!skipped.length && (
            <details className="text-yellow-300">
              <summary>
                {skipped.length}{' '}
                {t(
                  'unmatched records skipped',
                  'registros sin identificar omitidos'
                )}
              </summary>
              <ul className="max-h-64 overflow-y-auto">
                {skipped.map((r) => (
                  <li key={r.key}>
                    {r.title} ({r.year})
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {busy && <p role="status">{t('Working…', 'Procesando…')}</p>}
      {message && (
        <p role="status" className="text-yellow-300">
          {message}
        </p>
      )}
    </section>
  );
}
