import PageTitle from '@app/components/Common/PageTitle';
import { usePartyText } from '@app/components/WatchParty/messages';
import { Permission, useUser } from '@app/hooks/useUser';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

type Session = {
  id: number;
  started: number;
  updated: number;
  ended: number | null;
  status: string;
  title: string;
  mediaType: string;
  tmdbId: number;
  playingMs: number;
  peak: number;
  participants: number;
  controls: number;
  phoneControls: number;
};
type Activity = {
  id: number;
  at: number;
  type: string;
  userId: number | null;
  source: string | null;
  device: string | null;
  position: number | null;
  title: string | null;
};
type Detail = {
  session: Session;
  visits: {
    id: number;
    userId: number;
    joined: number;
    leftAt: number | null;
  }[];
  users: { id: number; name: string; avatar: string }[];
  events: Activity[];
  next: number | null;
};
const duration = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
const button =
  'rounded-lg border border-gray-600 px-3 py-2 hover:bg-gray-700 disabled:opacity-40';

function SessionDetail({ id, close }: { id: number; close: () => void }) {
  const t = usePartyText();
  const { locale } = useIntl();
  const [after, setAfter] = useState(0);
  const { data, error } = useSWR<Detail>(
    `/api/v1/watch-party/admin/usage/${id}?after=${after}`,
    { refreshInterval: 15000 }
  );
  if (error)
    return (
      <p role="alert">
        {t(
          'Activity details could not be loaded.',
          'No se pudo cargar el detalle de actividad.'
        )}{' '}
        <button className={button} onClick={close}>
          {t('Back', 'Volver')}
        </button>
      </p>
    );
  if (!data)
    return <p role="status">{t('Loading activity…', 'Cargando actividad…')}</p>;
  const session = data.session,
    end = session.ended || session.updated,
    span = Math.max(1, end - session.started);
  const name = (id: number | null) =>
    id === null
      ? t('Party', 'Grupo')
      : data.users.find((u) => u.id === id)?.name ||
        `${t('Deleted user', 'Usuario eliminado')} #${id}`;
  const time = (value: number) =>
    new Date(value).toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  const labels: Record<string, string> = {
    watched: t('Marked as watched', 'Marcado como visto'),
    started: t('Party started', 'Grupo iniciado'),
    ended: t('Party ended', 'Grupo finalizado'),
    joined: t('Joined', 'Se unió'),
    left: t('Left', 'Salió'),
    playing: t('Playback running', 'Reproducción en curso'),
    paused: t('Playback paused', 'Reproducción pausada'),
    play: t('Play command', 'Orden de reproducir'),
    pause: t('Pause command', 'Orden de pausar'),
    seek: t('Seek command', 'Cambio de posición'),
    switch: t('Change title requested', 'Cambio de título solicitado'),
    media_changed: t('New title', 'Nuevo título'),
  };
  const devices: Record<string, string> = {
    phone: t('Phone', 'Teléfono'),
    tablet: t('Tablet', 'Tableta'),
    desktop: t('Computer', 'Computadora'),
    unknown: t('Unknown device', 'Dispositivo desconocido'),
  };
  return (
    <section
      className="mt-6 rounded-xl border border-purple-500/40 bg-gray-800 p-4 sm:p-6"
      aria-label={t('Session detail', 'Detalle de sesión')}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{session.title}</h2>
          <p className="text-sm text-gray-300">
            {new Date(session.started).toLocaleString(locale)} ·{' '}
            {duration(span)} {t('connected', 'de conexión')} ·{' '}
            {duration(session.playingMs)}{' '}
            {t('estimated playing', 'de reproducción estimada')}
          </p>
        </div>
        <button className={button} onClick={close}>
          {t('Close details', 'Cerrar detalle')}
        </button>
      </div>
      <h3 className="mb-3 mt-6 font-semibold">
        {t('Who was here, and when', 'Quién estuvo y cuándo')}
      </h3>
      <div className="space-y-4">
        {[...new Set(data.visits.map((v) => v.userId))].map((userId) => {
          const visits = data.visits.filter((v) => v.userId === userId);
          return (
            <div key={userId} className="grid gap-2 sm:grid-cols-[10rem_1fr]">
              <div className="break-words text-sm">
                {name(userId)}
                <span className="ml-2 text-gray-400">
                  {duration(
                    visits.reduce((n, v) => n + (v.leftAt || end) - v.joined, 0)
                  )}
                </span>
              </div>
              <div
                className="relative h-7 rounded bg-gray-900"
                aria-label={name(userId)}
              >
                {visits.map((v) => (
                  <div
                    key={v.id}
                    className="absolute h-7 min-w-[2px] rounded bg-purple-500"
                    style={{
                      left: `${Math.max(0, ((v.joined - session.started) / span) * 100)}%`,
                      width: `${Math.min(100, Math.max(0, (((v.leftAt || end) - v.joined) / span) * 100))}%`,
                    }}
                    title={`${time(v.joined)} – ${v.leftAt ? time(v.leftAt) : t('Still connected', 'Sigue conectado')}`}
                  />
                ))}
                <span className="sr-only">
                  {visits
                    .map((v) => `${time(v.joined)} – ${time(v.leftAt || end)}`)
                    .join(', ')}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-gray-400">
        <span>{time(session.started)}</span>
        <span>{time(end)}</span>
      </div>
      <h3 className="mb-3 mt-6 font-semibold">
        {t('Event timeline', 'Cronología de eventos')}
      </h3>
      <ol className="space-y-2">
        {data.events.map((e) => (
          <li
            key={e.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-gray-900/70 px-3 py-2 text-sm"
          >
            <time className="font-mono text-gray-400">{time(e.at)}</time>
            <span className="font-semibold">{name(e.userId)}</span>
            <span>{labels[e.type] || e.type}</span>
            {e.position !== null && (
              <span className="font-mono text-gray-300">
                → {duration(e.position * 1000)}
              </span>
            )}
            {e.title && <span>{e.title}</span>}
            {e.source && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${e.device === 'phone' ? 'bg-purple-700 text-purple-100' : 'bg-gray-700 text-gray-200'}`}
              >
                {e.source === 'player'
                  ? t('Plex player', 'Reproductor Plex')
                  : `${t('Catalogue', 'Catálogo')} · ${devices[e.device || 'unknown']}`}
              </span>
            )}
          </li>
        ))}
      </ol>
      <div className="mt-4 flex gap-3">
        <button
          className={button}
          disabled={!after}
          onClick={() => setAfter(0)}
        >
          {t('First events', 'Primeros eventos')}
        </button>
        <button
          className={button}
          disabled={!data.next}
          onClick={() => setAfter(data.next!)}
        >
          {t('Next events', 'Más eventos')}
        </button>
      </div>
      {session.status === 'interrupted' && (
        <p className="mt-4 text-yellow-300">
          {t(
            'Recording ended at the last saved sample because the relay restarted or stopped.',
            'El registro terminó en la última muestra guardada porque el servidor de sincronización se reinició o se detuvo.'
          )}
        </p>
      )}
    </section>
  );
}

export default function WatchPartyActivity() {
  const t = usePartyText();
  const { locale } = useIntl();
  const { hasPermission } = useUser();
  const [days, setDays] = useState(30),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<number | null>(null);
  const allowed = hasPermission(Permission.ADMIN);
  const { data, error } = useSWR<{
    results: Session[];
    totals: { sessions: number; playingMs: number };
    retentionDays: number;
  }>(
    allowed
      ? `/api/v1/watch-party/admin/usage?days=${days}&page=${page}`
      : null,
    { refreshInterval: 15000 }
  );
  if (!allowed) return null;
  return (
    <>
      <PageTitle title={t('Watch Party Activity', 'Actividad de Ver Juntos')} />
      <h1 className="text-2xl font-bold">
        {t('Watch Party Activity', 'Actividad de Ver Juntos')}
      </h1>
      <p className="mt-2 max-w-3xl text-gray-300">
        {t(
          'Admin-only history of connections and playback controls. Activity starts being recorded when logging is enabled; earlier parties cannot be recovered.',
          'Historial de conexiones y controles, solo para administradores. El registro empieza al activar esta función; no se pueden recuperar los grupos anteriores.'
        )}
      </p>
      <p className="mt-2 max-w-3xl text-sm text-gray-400">
        {t(
          'Retained for 90 days. Playing time is an estimate from relay state, not proof that someone watched. Device labels are browser-reported; commands do not guarantee the player responded.',
          'Se conserva durante 90 días. El tiempo de reproducción es una estimación, no prueba de que alguien haya visto el contenido. El tipo de dispositivo lo informa el navegador; una orden no garantiza que el reproductor haya respondido.'
        )}
      </p>
      <label className="my-5 inline-flex items-center gap-3">
        {t('Period', 'Periodo')}
        <select
          className="rounded-lg bg-gray-800"
          value={days}
          onChange={(e) => {
            setDays(Number(e.target.value));
            setPage(1);
          }}
        >
          {[7, 30, 90].map((n) => (
            <option key={n} value={n}>
              {n} {t('days', 'días')}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <p role="alert" className="text-yellow-300">
          {t(
            'Activity history is unavailable. The relay may be offline or logging may be disabled. This does not mean zero usage.',
            'El historial no está disponible. El servidor puede estar desconectado o el registro desactivado. Esto no significa que no haya uso.'
          )}
        </p>
      ) : !data ? (
        <p role="status">{t('Loading…', 'Cargando…')}</p>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-gray-800 p-4">
              <div className="text-3xl font-bold">{data.totals.sessions}</div>
              <div className="text-gray-300">
                {t('Recorded parties', 'Grupos registrados')}
              </div>
            </div>
            <div className="rounded-xl bg-gray-800 p-4">
              <div className="text-3xl font-bold">
                {duration(data.totals.playingMs)}
              </div>
              <div className="text-gray-300">
                {t(
                  'Estimated party playing time',
                  'Tiempo estimado de reproducción de los grupos'
                )}
              </div>
            </div>
          </div>
          {!data.results.length && (
            <p className="rounded-xl border border-gray-700 p-8 text-gray-300">
              {t(
                'No recorded parties in this period yet.',
                'Todavía no hay grupos registrados en este periodo.'
              )}
            </p>
          )}
          <div className="space-y-3">
            {data.results.map((s) => (
              <article
                key={s.id}
                className={`rounded-xl border p-4 ${selected === s.id ? 'border-purple-500 bg-purple-900/20' : 'border-gray-700 bg-gray-800'}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Link
                      className="font-semibold hover:underline"
                      href={`/${s.mediaType}/${s.tmdbId}`}
                    >
                      {s.title}
                    </Link>
                    <p className="text-sm text-gray-400">
                      {new Date(s.started).toLocaleString(locale)} ·{' '}
                      {s.status === 'active'
                        ? t('Live', 'En vivo')
                        : s.status === 'interrupted'
                          ? t('Interrupted', 'Interrumpido')
                          : t('Ended', 'Finalizado')}
                    </p>
                  </div>
                  <button className={button} onClick={() => setSelected(s.id)}>
                    {t('View timeline', 'Ver cronología')}
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-300">
                  <span>
                    {duration((s.ended || s.updated) - s.started)}{' '}
                    {t('connected', 'de conexión')}
                  </span>
                  <span>
                    {duration(s.playingMs)} {t('playing', 'de reproducción')}
                  </span>
                  <span>
                    {s.participants} {t('people', 'personas')} ·{' '}
                    {t('peak', 'máximo')} {s.peak}
                  </span>
                  <span>
                    {s.controls} {t('controls', 'controles')} ·{' '}
                    {s.phoneControls} {t('from phone', 'desde teléfono')}
                  </span>
                </div>
              </article>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-4">
            <button
              className={button}
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              {t('Previous', 'Anterior')}
            </button>
            <span>{page}</span>
            <button
              className={button}
              disabled={page * 25 >= data.totals.sessions}
              onClick={() => setPage(page + 1)}
            >
              {t('Next', 'Siguiente')}
            </button>
          </div>
        </>
      )}
      {selected !== null && (
        <SessionDetail
          key={selected}
          id={selected}
          close={() => setSelected(null)}
        />
      )}
    </>
  );
}
