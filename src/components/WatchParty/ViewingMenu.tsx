import { useWatchingNow } from '@app/components/WatchParty';
import { usePartyText } from '@app/components/WatchParty/messages';
import { Menu, Portal } from '@headlessui/react';
import { EllipsisVerticalIcon } from '@heroicons/react/24/solid';
import type { WatchingTitle } from '@server/interfaces/api/watchParty';
import axios from 'axios';
import { useState } from 'react';
import { useSWRConfig } from 'swr';

export default function ViewingMenu({ item }: { item: WatchingTitle }) {
  const t = usePartyText();
  const { mutate } = useWatchingNow();
  const { mutate: refresh } = useSWRConfig();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  if (!item.sessions?.length) return null;
  async function change(sessionId: string, action: string) {
    setBusy(true);
    setFailed(false);
    try {
      await axios.post('/api/v1/watch-party/attribution', {
        sessionId,
        action,
      });
      await Promise.all([
        mutate(),
        refresh(
          (key) => typeof key === 'string' && key.startsWith('/api/v1/social/')
        ),
      ]);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="absolute right-1 top-1 z-30">
      <Menu as="div" className="relative">
        <Menu.Button
          disabled={busy}
          aria-label={t('Viewing options', 'Opciones de visualización')}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setPosition({
              top: Math.min(rect.bottom + 4, window.innerHeight - 240),
              left: Math.max(
                8,
                Math.min(rect.right - 240, window.innerWidth - 248)
              ),
            });
          }}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-900/80 text-white hover:bg-gray-700 focus-visible:ring-2 focus-visible:ring-purple-400"
        >
          <EllipsisVerticalIcon className="h-5 w-5" />
        </Menu.Button>
        <Portal>
          <Menu.Items
            style={position}
            className="fixed z-50 max-h-56 w-60 overflow-y-auto rounded-lg border border-gray-600 bg-gray-800 p-1 text-sm text-white shadow-xl focus:outline-none"
          >
            {item.sessions.map((session, index) => (
              <div key={session.id}>
                {item.sessions!.length > 1 && (
                  <p className="px-3 py-2 text-xs text-gray-300">
                    {t('Playback session', 'Sesión de reproducción')}{' '}
                    {index + 1}
                    {session.names.length
                      ? ` · ${session.names.join(', ')}`
                      : ''}
                  </p>
                )}
                {session.canClaim && (
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        disabled={busy}
                        className={`w-full rounded px-3 py-2 text-left ${active ? 'bg-gray-700' : ''}`}
                        onClick={() =>
                          change(session.id, session.isMe ? 'unclaim' : 'claim')
                        }
                      >
                        {session.isMe
                          ? t('This is not me', 'No soy yo')
                          : t('This is me', 'Soy yo')}
                      </button>
                    )}
                  </Menu.Item>
                )}
                <Menu.Item>
                  {({ active }) => (
                    <button
                      disabled={busy}
                      className={`w-full rounded px-3 py-2 text-left ${active ? 'bg-gray-700' : ''}`}
                      onClick={() =>
                        change(session.id, session.joined ? 'leave' : 'join')
                      }
                    >
                      {session.joined
                        ? t('I’m not watching anymore', 'Ya no estoy viendo')
                        : t('I’m watching too!', '¡Estoy viendo también!')}
                    </button>
                  )}
                </Menu.Item>
              </div>
            ))}
          </Menu.Items>
        </Portal>
      </Menu>
      {failed && (
        <p
          role="alert"
          className="absolute right-0 top-10 w-60 rounded-lg bg-gray-800 p-3 text-sm text-yellow-300"
        >
          {t(
            'Could not update. Refresh and try again.',
            'No se pudo actualizar. Actualiza la página e inténtalo de nuevo.'
          )}
        </p>
      )}
    </div>
  );
}
