import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

type Binding = {
  userId: number;
  instance: string;
  username: string;
  enabled: boolean;
  syncHealth?: {
    runtime: string;
    pauseReason?: string;
    unsupportedQueued: number | null;
    oldestQueuedAt: number | null;
    recentErrors: {
      stage: string;
      at: number;
      type: string;
      httpStatus?: number;
    }[];
  };
  writeEnabled?: boolean;
  writePilotEligible?: boolean;
  reconciliationHolds?: { originId: string; reason: string }[];
  writeQueue?: Record<
    'queued' | 'dispatched' | 'verified' | 'conflict' | 'unknown',
    number
  >;
  issue?: string;
  lastSeen?: number;
  lastSuccess?: number;
  itemCount?: number;
  job?: { state: string };
};
export default function LetterboxdBrowserStatus({
  userId,
}: {
  userId: number;
}) {
  const es = useIntl().locale.startsWith('es');
  const { data, error, mutate } = useSWR<{
    sharedHistory?: { attempts: number; nextAttemptAt: number; error?: {stage: string; code: string} };
    configured: boolean;
    bindings: Binding[];
  }>('/api/v1/settings/letterboxd-browser', { refreshInterval: 30000 });
  const row = data?.bindings.find((b) => b.userId === userId);
  const pilotEligible = row?.writePilotEligible === true;
  const canEnableWrites =
    pilotEligible &&
    !!data?.configured &&
    !!row?.enabled &&
    !row.issue &&
    !!row.lastSuccess;
  const [instance, setInstance] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save(enabled: boolean) {
    setBusy(true);
    setMessage('');
    try {
      await axios.put('/api/v1/settings/letterboxd-browser', {
        userId,
        instance: row?.instance || instance.trim(),
        enabled,
      });
      await mutate();
      setMessage(es ? 'Configuración guardada.' : 'Settings saved.');
    } catch {
      setMessage(
        es
          ? 'No se pudo guardar. Primero vincula la cuenta de Letterboxd y verifica el perfil del navegador.'
          : 'Could not save. Link the Letterboxd account and verify the browser profile first.'
      );
    } finally {
      setBusy(false);
    }
  }
  const issues: Record<string, string> = {
    offline: es ? 'El navegador no responde' : 'Browser offline',
    cloudflare: es
      ? 'Resuelve la verificación de seguridad en Edge'
      : 'Resolve the security check in Edge',
    identity: es
      ? 'Revisa la sesión de Letterboxd en Edge'
      : 'Check the Letterboxd login in Edge',
    verification: es
      ? 'Verificación fallida; tarea en pausa'
      : 'Verification failed; job paused',
    timeout: es ? 'Tiempo agotado; tarea en pausa' : 'Timed out; job paused',
  };
  async function toggleWrites() {
    if (!row || busy || (!row.writeEnabled && !canEnableWrites)) return;
    setBusy(true);
    setMessage('');
    try {
      await axios.put('/api/v1/settings/letterboxd-browser/writes', {
        userId,
        enabled: !row.writeEnabled,
      });
      await mutate();
      setMessage(
        row.writeEnabled
          ? es
            ? 'Publicación desactivada.'
            : 'Publishing disabled.'
          : es
            ? 'Publicación activada para esta cuenta.'
            : 'Publishing enabled for this account.'
      );
    } catch (error) {
      const missingConfig =
        (error as { response?: { data?: { code?: string } } }).response?.data
          ?.code === 'playback-configuration-required';
      setMessage(
        missingConfig
          ? es
            ? 'Configura la fuente del historial y la zona horaria antes de activar la publicación.'
            : 'Configure the playback history source and timezone before enabling publishing.'
          : es
            ? 'No se pudo cambiar la sincronización bidireccional. Revisa la cuenta y el estado del navegador.'
            : 'Could not change two-way sync. Check account and browser status.'
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-xl border border-gray-700 bg-gray-800 p-5 text-white">
      <h2 className="text-xl font-bold text-purple-300">
        {es ? 'Automatización de Letterboxd' : 'Letterboxd browser automation'}
      </h2>
      <p className="text-gray-300">
        {es
          ? 'Lee la lista de seguimiento cada 12 horas. Los problemas del navegador se notifican al administrador por correo. La publicación se controla por separado para cada usuario.'
          : 'Reads the watchlist every 12 hours. Browser issues are emailed to the administrator. Publishing is controlled separately for each user.'}
      </p>
      {error ? (
        <p role="alert">{es ? 'Estado no disponible' : 'Status unavailable'}</p>
      ) : !data ? (
        <p>{es ? 'Cargando…' : 'Loading…'}</p>
      ) : (
        <>
          {!!data.sharedHistory?.attempts && (
            <p role="status" className="text-yellow-300">
              {es ? 'La lectura compartida del historial de Plex está fallando; se reintentará automáticamente. No indica un fallo de publicación.' : 'The shared Plex history check is failing; it will retry automatically. This does not indicate a failed publication.'}
              {' '}{data.sharedHistory.error?.stage}: {data.sharedHistory.error?.code}
            </p>
          )}
          {!data.configured && (
            <p className="text-yellow-300">
              {es
                ? 'Falta configurar la conexión segura con prpl-pc.'
                : 'Secure connection to prpl-pc has not been configured.'}
            </p>
          )}
          {row ? (
            <>
              <p>
                {row.username} ·{' '}
                {row.enabled
                  ? es
                    ? 'Activado'
                    : 'Enabled'
                  : es
                    ? 'Desactivado'
                    : 'Disabled'}
              </p>
              <div
                className="space-y-1 rounded-lg bg-gray-900 p-3 text-sm"
                aria-label={
                  es ? 'Estado real de sincronización' : 'Effective sync health'
                }
              >
                <p
                  className={
                    row.syncHealth?.runtime === 'ready'
                      ? 'text-green-300'
                      : 'text-yellow-300'
                  }
                >
                  {es ? 'Navegador: ' : 'Worker: '}
                  {row.syncHealth?.runtime === 'ready'
                    ? es
                      ? 'listo'
                      : 'ready'
                    : row.syncHealth?.runtime === 'paused'
                      ? es
                        ? 'publicación pausada'
                        : 'publishing paused'
                      : es
                        ? 'estado reciente no disponible'
                        : 'fresh runtime status unavailable'}
                </p>
                {row.syncHealth?.runtime === 'paused' && (
                  <p>
                    {row.syncHealth.pauseReason === 'read-check'
                      ? es
                        ? 'Una verificación de lectura falló. La opción de publicación puede estar activa, pero el navegador no publicará hasta recuperarse.'
                        : 'A read-only check failed. Publishing may be enabled, but this worker will not publish until it recovers.'
                      : es
                        ? 'Hay una pausa de seguridad o manual. Revisa el navegador antes de reactivar.'
                        : 'A safety or manual pause is active. Review the worker before resuming.'}
                  </p>
                )}
                {!!row.syncHealth?.unsupportedQueued && (
                  <p className="text-yellow-300">
                    {row.syncHealth.unsupportedQueued}{' '}
                    {es
                      ? 'operaciones en cola no compatibles con este navegador.'
                      : 'queued operations are not supported by this worker.'}
                  </p>
                )}
                {row.syncHealth?.oldestQueuedAt && (
                  <p>
                    {es ? 'En cola desde: ' : 'Oldest queued operation: '}
                    {new Date(row.syncHealth.oldestQueuedAt).toLocaleString()}
                  </p>
                )}
                {row.syncHealth?.recentErrors.map((e) => (
                  <p key={e.stage} className="text-yellow-300">
                    {es ? 'Error reciente' : 'Recent error'} · {e.stage} ·{' '}
                    {e.httpStatus ? `HTTP ${e.httpStatus}` : e.type} ·{' '}
                    {new Date(e.at).toLocaleTimeString()}
                  </p>
                ))}
              </div>
              {row.issue && (
                <p className="text-yellow-300">
                  {issues[row.issue] ||
                    (es ? 'Requiere atención' : 'Needs attention')}
                </p>
              )}
              {!!row.reconciliationHolds?.length && (
                <div className="text-sm text-yellow-300">
                  <p>
                    {es
                      ? 'Cambios en conflicto durante la conciliación:'
                      : 'Reconciliation changes need review:'}
                  </p>
                  <ul>
                    {row.reconciliationHolds.map((hold) => (
                      <li key={hold.originId}>
                        {hold.originId}: {hold.reason}
                      </li>
                    ))}
                  </ul>
                  <p>
                    {es
                      ? 'La publicación de estas entradas está pausada; los datos remotos no se sobrescribieron.'
                      : 'Publishing these entries is held; remote data was not overwritten.'}
                  </p>
                </div>
              )}
              <p>
                {es
                  ? 'Última sincronización verificada: '
                  : 'Last verified sync: '}
                {row.lastSuccess
                  ? new Date(row.lastSuccess).toLocaleString(
                      es ? 'es-MX' : 'en-US'
                    )
                  : '—'}
                {row.itemCount !== undefined
                  ? ` · ${row.itemCount} ${es ? 'películas' : 'films'}`
                  : ''}
              </p>
              <label className="flex items-center gap-3 font-semibold">
                <input
                  type="checkbox"
                  checked={!!row.writeEnabled}
                  disabled={busy || (!row.writeEnabled && !canEnableWrites)}
                  onChange={toggleWrites}
                  aria-describedby={`letterboxd-write-help-${userId}`}
                  className="h-5 w-5 shrink-0 rounded border-gray-600 accent-purple-500"
                />
                {es
                  ? 'Publicar cambios en Letterboxd'
                  : 'Publish changes to Letterboxd'}
              </label>
              <p
                id={`letterboxd-write-help-${userId}`}
                className="text-sm text-gray-300"
              >
                {es
                  ? 'Publica calificaciones, reseñas (incluidos spoilers) y nuevos visionados de esta cuenta. No publica el historial existente ni activa otras cuentas.'
                  : 'Publishes this account’s ratings, reviews (including spoiler flags), and new watched activity. Does not publish existing history or enable other accounts.'}
              </p>
              {pilotEligible && !canEnableWrites && !row.writeEnabled && (
                <p className="text-sm text-yellow-300">
                  {es
                    ? 'Para activar la publicación, habilita el navegador y espera una sincronización verificada sin problemas pendientes.'
                    : 'To enable publishing, enable the browser and wait for a verified sync with no outstanding browser issues.'}
                </p>
              )}
              <p className="text-sm text-gray-300">
                {es
                  ? 'La lista de Letterboxd es de solo lectura: esta opción nunca envía cambios de listas. El marcador del catálogo sigue conectado a Plex, incluso para cuentas compartidas.'
                  : 'The Letterboxd watchlist is inbound only: this switch never publishes watchlist changes. The catalogue bookmark remains connected to Plex, including shared accounts.'}
              </p>
              {row.writeQueue ? (
                <div className="space-y-3 rounded-lg border border-gray-600 p-3">
                  <h3 className="font-semibold">
                    {es ? 'Cola de publicación' : 'Publishing queue'}
                  </h3>
                  <p className="text-sm text-gray-300">
                    {es
                      ? 'Recuentos registrados para esta cuenta; no solo la última ejecución.'
                      : 'Recorded counts for this account, not just the latest run.'}
                  </p>
                  <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                    {(
                      [
                        ['queued', es ? 'En espera' : 'Queued'],
                        ['dispatched', es ? 'Enviadas' : 'Dispatched'],
                        ['verified', es ? 'Verificadas' : 'Verified'],
                        ['conflict', es ? 'Conflictos' : 'Conflicts'],
                        [
                          'unknown',
                          es ? 'Resultado incierto' : 'Uncertain outcome',
                        ],
                      ] as const
                    ).map(([key, label]) => (
                      <div key={key}>
                        <dt className="text-gray-300">{label}</dt>
                        <dd className="font-semibold text-white">
                          {row.writeQueue?.[key]}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {(row.writeQueue.conflict > 0 ||
                    row.writeQueue.unknown > 0) && (
                    <p role="alert" className="text-sm text-yellow-300">
                      {es
                        ? 'Requiere atención: compara las entradas del catálogo y Letterboxd antes de continuar. Si el resultado es incierto, comprueba si el cambio ya se aplicó; no lo vuelvas a publicar a ciegas. No hay acciones de resolución disponibles aquí todavía.'
                        : 'Needs attention: compare the catalogue and Letterboxd entries before continuing. For uncertain outcomes, check whether the change already applied; do not blindly publish it again. Resolution actions are not available here yet.'}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-300">
                  {es
                    ? 'Estado de la cola no disponible.'
                    : 'Queue status unavailable.'}
                </p>
              )}
              <button
                disabled={busy}
                onClick={() => save(!row.enabled)}
                className="rounded-lg border border-gray-600 px-4 py-2 disabled:opacity-50"
              >
                {row.enabled
                  ? es
                    ? 'Desactivar navegador'
                    : 'Disable browser'
                  : es
                    ? 'Activar navegador'
                    : 'Enable browser'}
              </button>
            </>
          ) : (
            <>
              <label className="block">
                {es
                  ? 'Identificador del navegador verificado'
                  : 'Verified browser identifier'}
                <input
                  value={instance}
                  onChange={(e) => setInstance(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-gray-600 bg-gray-900 p-3 text-white"
                  autoComplete="off"
                />
              </label>
              <button
                disabled={busy || !data.configured || !instance.trim()}
                onClick={() => save(true)}
                className="rounded-lg bg-purple-600 px-4 py-2 disabled:opacity-50"
              >
                {es ? 'Vincular navegador' : 'Bind browser'}
              </button>
            </>
          )}
        </>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
