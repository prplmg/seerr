import Button from '@app/components/Common/Button';
import { usePartyText } from '@app/components/WatchParty/messages';
import { Permission, useUser } from '@app/hooks/useUser';
import axios from 'axios';
import { useState } from 'react';
import useSWR from 'swr';
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
    { hasPermission } = useUser(),
    isAdmin = hasPermission(Permission.ADMIN);
  const { data, mutate } = useSWR<{
    account: {
      username: string;
      enabled: boolean;
      lastSync: string | null;
      error: string | null;
    } | null;
  }>(`/api/v1/reviews/account/${userId}`);
  const [username, setUsername] = useState(''),
    [csv, setCsv] = useState(''),
    [offset, setOffset] = useState(0),
    [preview, setPreview] = useState<{
      results: Entry[];
      total: number;
      nextOffset: number | null;
    } | null>(null),
    [matches, setMatches] = useState<Record<string, number>>({}),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
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
  async function loadPreview(value: string, start = 0) {
    const r = await axios.post(`/api/v1/reviews/import/${userId}`, {
      csv: value,
      offset: start,
      mode: 'preview',
    });
    setPreview(r.data);
    setOffset(start);
    setConfirmed(false);
    setMatches({});
  }
  return (
    <section className="my-8 space-y-4 rounded-xl border border-gray-700 bg-gray-800 p-4 text-white">
      <h3 className="text-overseerr text-xl font-bold">Letterboxd</h3>
      <p className="text-gray-300">
        {t(
          'Import ratings and reviews, then check the public RSS feed every 15 minutes. This does not write to Letterboxd.',
          'Importa calificaciones y reseñas; después se consulta el RSS público cada 15 minutos. Esto no escribe en Letterboxd.'
        )}
      </p>
      {isAdmin ? (
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
          <Button
            buttonType="danger"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  t(
                    'Unlink Letterboxd and delete its imported ratings and reviews? Your local reviews will stay.',
                    '¿Desvincular Letterboxd y eliminar sus calificaciones y reseñas importadas? Tus reseñas locales se conservarán.'
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
          <label className="block">
            {t(
              'Upload reviews.csv or ratings.csv from your export (up to 2 MB). Unzip the export first.',
              'Sube reviews.csv o ratings.csv de tu exportación (hasta 2 MB). Descomprime la exportación primero.'
            )}
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              className="mt-2 block max-w-full"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void action(async () => {
                    if (file.size > 2 * 1024 * 1024) throw Error('large');
                    const value = await file.text();
                    setCsv(value);
                    await loadPreview(value);
                  });
              }}
            />
          </label>
          {preview && (
            <div className="space-y-3">
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
                            'Unmatched — enter the movie’s TMDB ID, or leave blank to skip.',
                            'Sin identificar: escribe el ID de TMDB de la película o déjalo vacío para omitirla.'
                          )}
                      {!r.tmdbId && (
                        <input
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
                      )}
                    </label>
                  </div>
                ))}
              </div>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                {t(
                  'Publish these imported entries to catalogue members. I checked that they contain no private or deleted content.',
                  'Publicar estas entradas importadas para los miembros del catálogo. Revisé que no contengan contenido privado ni eliminado.'
                )}
              </label>
              <Button
                disabled={busy || !confirmed}
                onClick={() =>
                  void action(async () => {
                    await axios.post(`/api/v1/reviews/import/${userId}`, {
                      csv,
                      offset,
                      mode: 'commit',
                      matches: Object.fromEntries(
                        Object.entries(matches).filter(([, v]) => v > 0)
                      ),
                      confirmPublic: true,
                    });
                    setMessage(
                      t(
                        'Imported matched entries.',
                        'Entradas identificadas importadas.'
                      )
                    );
                    if (preview.nextOffset !== null)
                      await loadPreview(csv, preview.nextOffset);
                    else setPreview(null);
                  })
                }
              >
                {t('Import this batch', 'Importar este lote')}
              </Button>
              {preview.nextOffset !== null && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void action(() => loadPreview(csv, preview.nextOffset!))
                  }
                >
                  {t('Skip to next batch', 'Omitir e ir al siguiente lote')}
                </Button>
              )}
            </div>
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
