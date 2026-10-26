import LetterboxdBrowserStatus from '@app/components/Reviews/LetterboxdBrowserStatus';
import LetterboxdSettings from '@app/components/Reviews/LetterboxdSettings';
import SettingsLayout from '@app/components/Settings/SettingsLayout';
import useRouteGuard from '@app/hooks/useRouteGuard';
import { Permission } from '@app/hooks/useUser';
import type { AccountMapping } from '@server/lib/accountMappings';
import axios from 'axios';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

type Sources = {
  avatarEditable: boolean;
  revision: string;
  users: {
    userId: number;
    name: string;
    avatar: string;
    defaultAvatarSource: 'plex' | 'gravatar' | 'current';
    defaultAvatarPlexId: string | null;
    currentAvatarSource: 'gravatar' | 'current';
    mapping: AccountMapping;
  }[];
  profiles: { id: string; title: string }[];
};
export default function AccountMappingsPage() {
  useRouteGuard(Permission.ADMIN);
  const es = useIntl().locale.startsWith('es');
  const { data, error, mutate } = useSWR<Sources>(
    '/api/v1/settings/account-mappings',
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );
  const [selected, setSelected] = useState<number>();
  const [draft, setDraft] = useState<AccountMapping>();
  const [revision, setRevision] = useState('');
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState('');
  useEffect(() => {
    if (data && selected === undefined) setSelected(data.users[0]?.userId);
  }, [data, selected]);
  useEffect(() => {
    setDraft(data?.users.find((u) => u.userId === selected)?.mapping);
    setRevision(data?.revision || '');
  }, [selected, data]);
  async function save() {
    if (!data || !draft) return;
    setBusy(true);
    setStatus('');
    try {
      // Send only this user's explicit override; retain other saved overrides server-side.
      await axios.put('/api/v1/settings/account-mappings', {
        revision,
        document: { version: 1, users: [draft] },
      });
      await mutate();
      setStatus(es ? 'Cambios guardados.' : 'Changes saved.');
    } catch {
      setStatus(
        es
          ? 'No se guardaron los cambios. Actualiza la página y revisa las asignaciones.'
          : 'Changes were not saved. Refresh and check the mappings.'
      );
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    setBusy(true);
    setStatus('');
    try {
      const { data: result } = await axios.post(
        '/api/v1/settings/account-mappings/check'
      );
      setStatus(
        es
          ? `${result.checked} imágenes verificadas; ${result.changed} cambiarían. No se modificó ninguna cuenta.`
          : `${result.checked} avatars verified; ${result.changed} would change. No accounts were modified.`
      );
    } catch {
      setStatus(
        es
          ? 'No se pudo completar la verificación. No se modificó ninguna cuenta.'
          : 'Verification could not complete. No accounts were modified.'
      );
    } finally {
      setBusy(false);
    }
  }
  const style =
    'w-full rounded-lg border border-gray-600 bg-gray-900 p-3 text-white';
  const selectedUser = data?.users.find((user) => user.userId === selected);
  const defaultAvatarLabel =
    selectedUser?.defaultAvatarSource === 'plex'
      ? `${es ? 'Cuenta Plex vinculada' : 'Linked Plex account'}: ${data?.profiles.find((p) => p.id === selectedUser.defaultAvatarPlexId)?.title || selectedUser.name}`
      : selectedUser?.defaultAvatarSource === 'gravatar'
        ? 'Gravatar'
        : es
          ? 'Imagen actual de la cuenta'
          : 'Current account avatar';
  return (
    <SettingsLayout>
      <div className="space-y-6 text-white">
        <h1 className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-3xl font-bold text-transparent">
          {es ? 'Asignación de cuentas' : 'Account mappings'}
        </h1>
        <p className="text-gray-300">
          {es
            ? 'Las imágenes, la reproducción y las listas de seguimiento se configuran por separado. Los perfiles compartidos no fusionan el historial.'
            : 'Avatar, playback and watchlist sources are independent. Shared profiles do not merge watched history.'}
        </p>
        {error ? (
          <p role="alert">
            {es
              ? 'No se pudieron consultar las cuentas.'
              : 'Account sources could not be loaded.'}
          </p>
        ) : !data ? (
          <p>{es ? 'Cargando…' : 'Loading…'}</p>
        ) : (
          <>
            <label className="block">
              {es ? 'Usuario de Multimeldia' : 'Multimeldia user'}
              <select
                disabled={busy}
                className={style}
                value={selected}
                onChange={(e) => {
                  setStatus('');
                  setSelected(Number(e.target.value));
                }}
              >
                {data.users.map((u) => (
                  <option key={u.userId} value={u.userId}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            {selectedUser && (
              <div className="flex items-center gap-3">
                {/* Match the existing user avatar URL; no additional profile lookup. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedUser.avatar}
                  alt=""
                  className="h-12 w-12 rounded-full"
                />
                <div>
                  <p className="font-semibold">{selectedUser.name}</p>
                  <p className="text-sm text-gray-300">
                    {selectedUser.currentAvatarSource === 'gravatar'
                      ? 'Gravatar'
                      : selectedUser.mapping.avatarPlexId
                        ? `${es ? 'Perfil Plex asignado' : 'Mapped Plex profile'}: ${data.profiles.find((p) => p.id === selectedUser.mapping.avatarPlexId)?.title || selectedUser.mapping.avatarPlexId}`
                        : defaultAvatarLabel}
                  </p>
                </div>
              </div>
            )}
            {draft && (
              <div className="grid gap-5 rounded-xl border border-gray-700 bg-gray-800 p-5 md:grid-cols-3">
                <p className="text-gray-400 md:col-span-3">{es ? 'Listas y Para ti están disponibles para todos.' : 'Lists and For you are available to everyone.'}</p>
                {selectedUser && <Link className="text-purple-300 md:col-span-3" href={`/for-you?previewUserId=${selectedUser.userId}`}>
                  {es ? 'Vista previa de Para ti (solo lectura)' : 'Preview For you (read-only)'}
                </Link>}
                {(
                  ['avatarPlexId', 'playbackPlexId', 'watchlistPlexId'] as const
                ).map((field) => (
                  <label key={field} className="block">
                    {
                      {
                        avatarPlexId: es
                          ? `Imagen de perfil${data.avatarEditable ? '' : ' (migración pendiente)'}`
                          : `Avatar source${data.avatarEditable ? '' : ' (migration pending)'}`,
                        playbackPlexId: es
                          ? 'Perfil de reproducción Plex'
                          : 'Plex playback profile',
                        watchlistPlexId: es
                          ? 'Lista de seguimiento Plex'
                          : 'Plex watchlist account',
                      }[field]
                    }
                    <select
                      disabled={
                        (field === 'avatarPlexId' && !data.avatarEditable) ||
                        busy
                      }
                      className={style}
                      value={
                        field === 'avatarPlexId' &&
                        draft.avatarSource === 'gravatar'
                          ? 'gravatar'
                          : (draft[field] ?? '')
                      }
                      onChange={(e) => {
                        const next = {
                          ...draft,
                          [field]: e.target.value || null,
                        };
                        if (field === 'avatarPlexId') {
                          delete next.avatarSource;
                          if (e.target.value === 'gravatar') {
                            next.avatarSource = 'gravatar';
                            next.avatarPlexId = null;
                          }
                        }
                        setDraft(next);
                      }}
                    >
                      <option value="">
                        {field === 'avatarPlexId'
                          ? defaultAvatarLabel
                          : es
                            ? 'Sin asignación explícita'
                            : 'No explicit mapping'}
                      </option>
                      {field === 'avatarPlexId' && (
                        <option value="gravatar">Gravatar</option>
                      )}
                      {data.profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title} ({p.id})
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
            <button
              className="rounded-lg bg-purple-600 px-5 py-3 font-semibold disabled:opacity-50"
              disabled={busy || !draft}
              onClick={save}
            >
              {es ? 'Guardar asignaciones' : 'Save mappings'}
            </button>
            <button
              className="rounded-lg border border-gray-600 px-5 py-3 font-semibold disabled:opacity-50"
              disabled={busy}
              onClick={check}
            >
              {es
                ? 'Verificar imágenes guardadas (sin cambios)'
                : 'Check saved avatars (no changes)'}
            </button>
            <p role="status">{status}</p>
            {selected && (
              <LetterboxdSettings key={selected} userId={selected} />
            )}
            {selected && (
              <LetterboxdBrowserStatus
                key={`browser-${selected}`}
                userId={selected}
              />
            )}
          </>
        )}
      </div>
    </SettingsLayout>
  );
}
