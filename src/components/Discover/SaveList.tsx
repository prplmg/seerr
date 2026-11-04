import { Transition } from '@headlessui/react';
import Modal from '@app/components/Common/Modal';
import { usePartyText } from '@app/components/WatchParty/messages';
import useDiscovery from '@app/hooks/useDiscovery';
import { useUser } from '@app/hooks/useUser';
import axios from 'axios';
import { useEffect, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
const style =
  'rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-white';
export default function SaveList({
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
    [confirmUnsave, setConfirmUnsave] = useState(false),
    t = usePartyText();
  const { user } = useUser();
  const { mutate: refreshLists } = useSWRConfig();
  const { data, mutate } = useSWR<{ saved: boolean }>(
    enabled && !readOnly && saved === undefined
      ? [`/api/v1/discovery-lists/${id}`, user?.id]
      : null,
    async ([url]) => (await axios.get(url)).data
  );
  useEffect(
    () => setValue(saved ?? data?.saved ?? false),
    [saved, data?.saved, id]
  );
  async function save(next: boolean) {
    setBusy(true);
    setError('');
    try {
      await axios.put(`/api/v1/discovery-lists/${id}/save`, {
        saved: next,
      });
      setValue(next);
      if (data) void mutate({ ...data, saved: next }, false);
      setConfirmUnsave(false);
      void refreshLists((key) => {
        const url = Array.isArray(key) ? key[0] : key;
        return (
          typeof url === 'string' &&
          url.startsWith('/api/v1/discovery-lists?filter=')
        );
      });
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
  }
  if (!enabled || readOnly) return null;
  return (
    <span>
      <button
        className={style}
        disabled={busy || (saved === undefined && !data)}
        aria-pressed={value}
        onClick={() => (value ? setConfirmUnsave(true) : void save(true))}
      >
        {busy
          ? t('Saving…', 'Guardando…')
          : value
            ? t('Saved ✓', 'Guardada ✓')
            : t('Save list', 'Guardar lista')}
      </button>
      {error && <span role="alert">{error}</span>}
      <Transition show={confirmUnsave}>
        <Modal
          title={t('Unsave this list?', '¿Dejar de guardar esta lista?')}
          onCancel={() => !busy && setConfirmUnsave(false)}
          onOk={() => void save(false)}
          okDisabled={busy}
          okText={t('Unsave list', 'Quitar de guardadas')}
          cancelText={t('Keep saved', 'Conservar guardada')}
        >
          <p className="text-gray-300">
            {t(
              'This list will leave your saved lists. Movies found only here may no longer appear in “your lists” sections. Lists you created in Multimeldia move to Unlinked, where you can save them again.',
              'Esta lista saldrá de tus listas guardadas. Las películas que solo aparecen aquí podrían dejar de aparecer en las secciones de «tus listas». Las listas que creaste en Multimeldia pasan a Desvinculadas, donde puedes volver a guardarlas.'
            )}
          </p>
          {error && (
            <p role="alert" className="mt-3 text-red-300">
              {error}
            </p>
          )}
        </Modal>
      </Transition>
    </span>
  );
}
