import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import Modal from '@app/components/Common/Modal';
import { partyBridge } from '@app/components/WatchParty/bridge';
import { usePartyText } from '@app/components/WatchParty/messages';
import { Transition } from '@headlessui/react';
import { PauseIcon, PlayIcon, UsersIcon } from '@heroicons/react/24/solid';
import type {
  WatchingParty,
  WatchingPerson,
  WatchingResponse,
  WatchingTitle,
} from '@server/interfaces/api/watchParty';
import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

export function useWatchingNow() {
  return useSWR<WatchingResponse>('/api/v1/watch-party', {
    refreshInterval: (data) =>
      data?.results.some((r) => r.parties.some((p) => p.mine)) ? 2000 : 10000,
    dedupingInterval: 1000,
    errorRetryCount: 2,
    refreshWhenHidden: false,
    revalidateOnFocus: true,
  });
}
function Avatar({ person }: { person: WatchingPerson }) {
  return (
    <img
      src={person.avatar}
      alt={person.name}
      title={person.name}
      className="h-5 w-5 flex-none rounded-full border border-gray-400 object-cover"
    />
  );
}
export function PartyPill({
  party,
  hasOwnParty,
}: {
  party: WatchingParty;
  hasOwnParty: boolean;
}) {
  const t = usePartyText();
  return (
    <span
      title={`${party.mine ? t('Your party', 'Tu grupo') + ': ' : ''}${party.members.map((p) => p.name).join(', ')}`}
      className={`inline-flex max-w-full flex-wrap items-center gap-1 rounded-full border px-1.5 py-1 ${!hasOwnParty || party.mine ? 'border-purple-400 bg-purple-600/25' : 'border-gray-500 bg-gray-600/30'}`}
    >
      {party.members.map((p) => (
        <Avatar key={p.id} person={p} />
      ))}
      {party.mine && (
        <span className="sr-only">{t('Your party', 'Tu grupo')}</span>
      )}
    </span>
  );
}
export function WatchingPeople({
  item,
  list = false,
}: {
  item: WatchingTitle;
  list?: boolean;
}) {
  const own = item.parties.some((p) => p.mine);
  if (!item.parties.length && list)
    return (
      <div className="flex flex-col gap-1.5">
        {item.viewers.map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-xs">
            <Avatar person={p} />
            <span className="truncate">{p.name}</span>
          </div>
        ))}
      </div>
    );
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {item.viewers.map((p) => (
        <Avatar key={p.id} person={p} />
      ))}
      {item.parties.map((p) => (
        <PartyPill key={p.id} party={p} hasOwnParty={own} />
      ))}
    </div>
  );
}
const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  return `${h ? `${h}:` : ''}${h ? String(Math.floor(s / 60) % 60).padStart(2, '0') : Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
// Lucide rotate-cw / rotate-ccw, ISC licensed (lucide-icons/lucide).
function RotateIcon({ clockwise = false }: { clockwise?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d={
          clockwise
            ? 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8'
            : 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'
        }
      />
      <path d={clockwise ? 'M21 3v5h-5' : 'M3 3v5h5'} />
    </svg>
  );
}
export function PartyControls({ party }: { party: WatchingParty }) {
  const t = usePartyText();
  const [position, setPosition] = useState(party.position);
  const [paused, setPaused] = useState(party.paused);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(false);
  const optimistic = useRef({
    position: party.position,
    paused: party.paused,
    at: Date.now(),
    until: 0,
  });
  const queue = useRef(Promise.resolve());
  const revision = useRef(0);
  const authoritative = useRef(party);
  authoritative.current = party;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const current = optimistic.current;
    const expected =
      current.position +
      (current.paused ? 0 : (Date.now() - current.at) / 1000);
    if (
      Date.now() >= current.until ||
      (Math.abs(party.position - expected) < 2 &&
        party.paused === current.paused)
    ) {
      optimistic.current = {
        position: party.position,
        paused: party.paused,
        at: Date.now(),
        until: 0,
      };
      if (!dragging) setPosition(party.position);
      setPaused(party.paused);
    }
  }, [party.position, party.paused, dragging]);
  useEffect(() => {
    const timer = setInterval(() => {
      const current = optimistic.current;
      if (!dragging && !current.paused)
        setPosition(
          Math.min(
            party.duration,
            current.position + (Date.now() - current.at) / 1000
          )
        );
    }, 250);
    return () => clearInterval(timer);
  }, [dragging, party.duration]);
  const command = (action: string, targetTime?: number) => {
    const now = Date.now();
    const current = optimistic.current;
    const nextPosition =
      action === 'seek'
        ? targetTime!
        : current.position + (current.paused ? 0 : (now - current.at) / 1000);
    const nextPaused =
      action === 'pause' ? true : action === 'play' ? false : current.paused;
    optimistic.current = {
      position: nextPosition,
      paused: nextPaused,
      at: now,
      until: now + 15000,
    };
    setPosition(nextPosition);
    setPaused(nextPaused);
    const ownRevision = ++revision.current;
    setError(false);
    queue.current = queue.current
      .then(async () => {
        if (!mounted.current) return;
        const { data: result } = await axios.post(
          '/api/v1/watch-party/control',
          {
            roomId: party.id,
            action,
            targetTime,
            requestId: crypto.randomUUID(),
          },
          { timeout: 7000 }
        );
        if (!['ok', 'ok_solo'].includes(result.status))
          throw Error('Control rejected');
      })
      .catch(() => {
        if (!mounted.current) return;
        setError(true);
        if (ownRevision === revision.current) {
          const latest = authoritative.current;
          optimistic.current = {
            position: latest.position,
            paused: latest.paused,
            at: Date.now(),
            until: 0,
          };
          setPosition(latest.position);
          setPaused(latest.paused);
        }
      });
  };
  const skip = (delta: number) => {
    const current = optimistic.current;
    const live =
      current.position +
      (current.paused ? 0 : (Date.now() - current.at) / 1000);
    command('seek', Math.max(0, Math.min(party.duration, live + delta)));
  };
  return (
    <div className="w-full min-w-0" data-testid="party-controls">
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          aria-label={t('Back 10 seconds', 'Retroceder 10 segundos')}
          onClick={() => skip(-10)}
          className="rounded p-1 text-xs hover:bg-gray-700"
        >
          <span className="flex items-center gap-1">
            <RotateIcon />
            10
          </span>
        </button>
        <button
          type="button"
          aria-label={paused ? t('Play', 'Reproducir') : t('Pause', 'Pausar')}
          onClick={() => command(optimistic.current.paused ? 'play' : 'pause')}
          className="rounded p-1 hover:bg-gray-700"
        >
          {paused ? (
            <PlayIcon className="h-5 w-5" />
          ) : (
            <PauseIcon className="h-5 w-5" />
          )}
        </button>
        <button
          type="button"
          aria-label={t('Forward 10 seconds', 'Avanzar 10 segundos')}
          onClick={() => skip(10)}
          className="rounded p-1 text-xs hover:bg-gray-700"
        >
          <span className="flex items-center gap-1">
            10
            <RotateIcon clockwise />
          </span>
        </button>
      </div>
      <input
        className="block h-3 w-full accent-purple-500"
        type="range"
        aria-label={t('Seek', 'Posición de reproducción')}
        min={0}
        max={Math.max(1, party.duration)}
        step={1}
        value={position}
        disabled={!party.duration}
        onChange={(e) => {
          setDragging(true);
          setPosition(Number(e.target.value));
        }}
        onPointerUp={() => {
          setDragging(false);
          command('seek', position);
        }}
        onKeyUp={(e) => {
          if (
            [
              'ArrowLeft',
              'ArrowRight',
              'Home',
              'End',
              'PageUp',
              'PageDown',
            ].includes(e.key)
          ) {
            setDragging(false);
            command('seek', position);
          }
        }}
      />
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>{clock(position)}</span>
        <span>{clock(party.duration)}</span>
      </div>
      {error && (
        <p
          role="alert"
          className="whitespace-normal break-words text-xs leading-tight text-amber-300"
        >
          {t(
            'Control failed. Check your desktop connection and party permissions.',
            'Falló el control. Revisa la conexión de tu computadora y los permisos del grupo.'
          )}
        </p>
      )}
    </div>
  );
}
export function WatchingDetail({
  id,
  type,
}: {
  id: number;
  type: 'movie' | 'tv';
}) {
  const { data, error } = useWatchingNow();
  const t = usePartyText();
  const item =
    !error && data?.enabled
      ? data.results.find((r) => r.tmdbId === id && r.mediaType === type)
      : undefined;
  if (!item) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 xl:justify-start">
      <span className="text-xs text-gray-300">
        {t('Watching now', 'Viendo ahora')}
      </span>
      <WatchingPeople item={item} />
    </div>
  );
}
export function DetailPartyControls({
  id,
  type,
}: {
  id: number;
  type: 'movie' | 'tv';
}) {
  const { data, error } = useWatchingNow();
  const t = usePartyText();
  const party =
    !error && data?.enabled
      ? data.results
          .find((r) => r.tmdbId === id && r.mediaType === type)
          ?.parties.find((p) => p.mine)
      : undefined;
  if (!party) return null;
  return (
    <div className="order-1 my-2 w-full max-w-sm self-center rounded-lg border border-purple-500/50 bg-gray-900/60 p-2 xl:self-start">
      <div className="text-xs text-purple-300">
        {t('Your party', 'Tu grupo')}
      </div>
      <PartyControls key={party.id} party={party} />
    </div>
  );
}

export function InstallInstructions({
  onCheck,
  busy,
}: {
  onCheck: () => void;
  busy: boolean;
}) {
  const t = usePartyText();
  const [browser, setBrowser] = useState('chrome');
  const firefox = browser === 'firefox';
  const url = firefox
    ? 'about:debugging#/runtime/this-firefox'
    : `${browser}://extensions`;
  return (
    <div>
      <div
        className="mb-4 flex gap-2"
        role="group"
        aria-label={t('Browser family', 'Familia del navegador')}
      >
        <button
          type="button"
          className={`flex-1 rounded-lg border p-2 ${!firefox ? 'border-purple-400 bg-purple-600/25' : 'border-gray-600'}`}
          onClick={() => setBrowser('chrome')}
        >
          <span className="flex items-center justify-center gap-2">
            <img src="/browser-icons/chrome.svg" className="h-6 w-6" alt="" />
            Chrome / Brave / Edge
          </span>
        </button>
        <button
          type="button"
          className={`flex-1 rounded-lg border p-2 ${firefox ? 'border-purple-400 bg-purple-600/25' : 'border-gray-600'}`}
          onClick={() => setBrowser('firefox')}
        >
          <span className="flex items-center justify-center gap-2">
            <img src="/browser-icons/firefox.svg" className="h-6 w-6" alt="" />
            Firefox
          </span>
        </button>
      </div>
      {!firefox && (
        <div className="mb-4 flex gap-2">
          {['chrome', 'brave', 'edge'].map((b) => (
            <button
              type="button"
              key={b}
              aria-pressed={browser === b}
              onClick={() => setBrowser(b)}
              className={`rounded border px-3 py-1 capitalize ${browser === b ? 'border-purple-400' : 'border-gray-600'}`}
            >
              <span className="flex items-center gap-2">
                <img
                  src={`/browser-icons/${b}.svg`}
                  className="h-5 w-5"
                  alt=""
                />
                {b}
              </span>
            </button>
          ))}
        </div>
      )}
      <ol className="ml-5 list-decimal space-y-3 text-sm text-gray-200">
        <li>
          {t(
            'Download and unzip the extension into a permanent folder.',
            'Descarga y descomprime la extensión en una carpeta permanente.'
          )}
        </li>
        <li>
          {t('Type', 'Escribe')}{' '}
          <code className="break-all rounded bg-gray-900 px-1">{url}</code>{' '}
          {t(
            'in the URL bar and press Enter.',
            'en la barra de direcciones y presiona Enter.'
          )}
        </li>
        <li>
          {firefox
            ? t(
                'Click Load Temporary Add-on.',
                'Haz clic en Cargar complemento temporal.'
              )
            : browser === 'edge'
              ? t(
                  'Turn on Developer mode in the sidebar.',
                  'Activa el modo de desarrollador en la barra lateral.'
                )
              : t(
                  'Turn on Developer mode (top right).',
                  'Activa el modo de desarrollador (arriba a la derecha).'
                )}
        </li>
        <li>
          {firefox
            ? t(
                'Select manifest.json in the extracted folder.',
                'Selecciona manifest.json en la carpeta extraída.'
              )
            : t(
                'Click Load unpacked and select the extracted folder.',
                'Haz clic en Cargar descomprimida y selecciona la carpeta extraída.'
              )}
        </li>
        <li>
          {t(
            'Return here and click Check again. When updating, replace the extracted files and reload the extension on the extensions page first.',
            'Regresa aquí y haz clic en Comprobar de nuevo. Al actualizar, reemplaza los archivos extraídos y recarga primero la extensión en la página de extensiones.'
          )}
        </li>
      </ol>
      <p className="my-4 rounded border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
        {firefox
          ? t(
              'Temporary test install: reinstall after restarting Firefox. Keep the extracted folder.',
              'Instalación temporal de prueba: vuelve a instalar después de reiniciar Firefox. Conserva la carpeta extraída.'
            )
          : t(
              'Keep this folder. The extension runs from it—do not move or delete it.',
              'Conserva esta carpeta. La extensión se ejecuta desde ella: no la muevas ni la elimines.'
            )}
      </p>
      <div className="flex gap-3">
        <a
          href={`/api/v1/watch-party/extension/${firefox ? 'firefox' : 'chrome'}`}
          className="rounded-lg border border-gray-500 px-4 py-2"
        >
          {t('Download ZIP', 'Descargar ZIP')}
        </a>
        <Button buttonType="primary" disabled={busy} onClick={onCheck}>
          {t('Check again', 'Comprobar de nuevo')}
        </Button>
      </div>
    </div>
  );
}

export default function WatchTogether({
  id,
  type,
  title,
  poster,
}: {
  id: number;
  type: 'movie' | 'tv';
  title: string;
  poster?: string;
}) {
  const t = usePartyText();
  const { data } = useWatchingNow();
  const [open, setOpen] = useState(false);
  const [install, setInstall] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [hint, setHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string | null | undefined>();
  const [episodeKey, setEpisodeKey] = useState('');
  const { data: episodes } = useSWR<{
    results: { key: string; title: string; season: number; episode: number }[];
  }>(open && type === 'tv' ? `/api/v1/watch-party/episodes/${id}` : null);
  useEffect(() => {
    setMobile(
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  }, []);
  const item = data?.results.find(
    (r) => r.tmdbId === id && r.mediaType === type
  );
  const launch = async (partyId?: string) => {
    setBusy(true);
    setError('');
    try {
      const detected = await partyBridge('ping').catch(() => null);
      if (detected?.status !== 'ok') {
        setError(
          t(
            'Extension not detected. Enable multimeldia sync and allow access to this site, then click Check again. Refresh this page only if it still cannot connect.',
            'No se detectó la extensión. Activa multimeldia sync y permite el acceso a este sitio; luego pulsa Comprobar de nuevo. Recarga esta página solo si todavía no se conecta.'
          )
        );
        setPending(partyId ?? null);
        setInstall(true);
        return;
      }
      if (detected.version !== data?.extensionVersion) {
        setPending(partyId ?? null);
        setInstall(true);
        setError(
          t(
            `Update multimeldia sync to ${data?.extensionVersion || 'the current version'} (installed: ${detected.version || 'unknown'}). Replace the extracted files, reload the extension, then click Check again.`,
            `Actualiza multimeldia sync a ${data?.extensionVersion || 'la versión actual'} (instalada: ${detected.version || 'desconocida'}). Reemplaza los archivos, recarga la extensión y pulsa Comprobar de nuevo.`
          )
        );
        return;
      }
      const result = await axios.post(
        '/api/v1/watch-party/launch',
        {
          tmdbId: id,
          mediaType: type,
          partyId,
          episodeKey: episodeKey || undefined,
        },
        { timeout: 30000 }
      );
      const response = await partyBridge('launch', result.data);
      if (response.status !== 'ok') throw Error('Launch rejected');
      setOpen(false);
      setPending(undefined);
      setInstall(false);
    } catch {
      setError(
        t(
          'Could not start the party. Check the relay, Plex access, and episode selection.',
          'No se pudo iniciar el grupo. Revisa el relay, el acceso a Plex y el episodio seleccionado.'
        )
      );
    } finally {
      setBusy(false);
    }
  };
  // Not exposed until the administrator configures a relay. Normal pages keep loading.
  if (!data?.partiesEnabled) return null;
  return (
    <>
      <span className="relative ml-2 inline-flex">
        <Button
          buttonType="primary"
          aria-disabled={mobile}
          className={mobile ? 'opacity-50' : ''}
          onClick={() => (mobile ? setHint(!hint) : setOpen(true))}
        >
          <UsersIcon />
          <span>{t('Watch Together', 'Ver Juntos')}</span>
        </Button>
        {hint && (
          <span
            role="tooltip"
            className="absolute right-0 top-full z-50 mt-2 w-56 max-w-[calc(100vw-2rem)] rounded border border-gray-600 bg-gray-800 p-3 text-sm leading-relaxed text-gray-100 shadow-lg"
          >
            {t(
              'Only available on desktop web browsers',
              'Solo disponible en navegador de computadora'
            )}
          </span>
        )}
      </span>
      <Transition show={open}>
        <Modal
          title={
            install
              ? t('Install the extension', 'Instala la extensión')
              : t('Watch Together', 'Ver Juntos')
          }
          subTitle={title}
          onCancel={() => {
            setOpen(false);
            setInstall(false);
            setPending(undefined);
          }}
          dialogClass="sm:!max-w-lg"
        >
          {!install && (
            <>
              {poster && (
                <div className="mx-auto mb-4 w-20">
                  <CachedImage
                    type="tmdb"
                    src={`https://image.tmdb.org/t/p/w185${poster}`}
                    alt=""
                    width={80}
                    height={120}
                    className="rounded"
                  />
                </div>
              )}
              <h3 className="mb-3 font-semibold">
                {t('Join a party', 'Únete a un grupo')}
              </h3>
              <div className="space-y-2">
                {item?.parties.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 rounded-lg border border-gray-600 p-3"
                  >
                    <PartyPill
                      party={p}
                      hasOwnParty={!!item.parties.some((r) => r.mine)}
                    />
                    <span className="min-w-0 flex-1 text-xs">
                      {p.members.map((m) => m.name).join(' · ')}
                    </span>
                    <Button
                      buttonType="success"
                      buttonSize="sm"
                      disabled={busy || p.mine}
                      onClick={() => launch(p.id)}
                    >
                      {p.mine ? t('Joined', 'Dentro') : t('Join', 'Unirme')}
                    </Button>
                  </div>
                ))}
              </div>
              {!item?.parties.length && (
                <p className="text-sm text-gray-400">
                  {t(
                    'No parties yet. Create the first one.',
                    'Todavía no hay grupos. Crea el primero.'
                  )}
                </p>
              )}
              <div className="my-4 border-t border-gray-600" />
              {type === 'tv' && (
                <label className="mb-3 block text-sm">
                  {t('Choose an episode', 'Elige un episodio')}
                  <select
                    value={episodeKey}
                    onChange={(e) => setEpisodeKey(e.target.value)}
                    className="mt-1 w-full rounded bg-gray-900"
                  >
                    <option value="">
                      {t('Select an episode', 'Selecciona un episodio')}
                    </option>
                    {episodes?.results.map((e) => (
                      <option key={e.key} value={e.key}>
                        S{String(e.season).padStart(2, '0')}E
                        {String(e.episode).padStart(2, '0')} · {e.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Button
                buttonType="primary"
                className="w-full"
                disabled={
                  busy ||
                  !!item?.parties.some((p) => p.mine) ||
                  (type === 'tv' && !/^\d+$/.test(episodeKey))
                }
                onClick={() => launch()}
              >
                {t('Create a party', 'Crear un grupo')}
              </Button>
              <p className="mt-3 text-center text-xs text-gray-400">
                {t(
                  'Choose Resume or Restart in Plex.',
                  'Elige Reanudar o Empezar de nuevo en Plex.'
                )}
              </p>
            </>
          )}
          {install && (
            <InstallInstructions
              busy={busy}
              onCheck={() => launch(pending ?? undefined)}
            />
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-amber-300">
              {error}
            </p>
          )}
        </Modal>
      </Transition>
    </>
  );
}
