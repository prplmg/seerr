import Button from '@app/components/Common/Button';
import { usePartyText } from '@app/components/WatchParty/messages';
import { useUser } from '@app/hooks/useUser';
import axios from 'axios';
import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';

export default function MarkWatched({
  id,
  type,
  size = 26,
}: {
  id: number;
  type: 'movie' | 'tv';
  size?: number;
}) {
  const { user } = useUser();
  const t = usePartyText();
  const { mutate: refresh } = useSWRConfig();
  const endpoint = `/api/v1/reviews/watched/${id}?mediaType=${type}`;
  const { data, mutate } = useSWR<{ watched: boolean }>(
    user ? [endpoint, user.id] : null,
    async ([url]) => (await axios.get(url)).data
  );
  const { data: social } = useSWR<{ watchers: { id: number }[] }>(
    `/api/v1/social/${type}/${id}`
  );
  const watched =
    data?.watched || social?.watchers?.some((w) => w.id === user?.id);
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  if (!user || watched) return null;
  return (
    <span className="flex flex-col">
      <Button
        className="flex-none rounded-full p-0 text-lg"
        style={{ width: size, height: size }}
        aria-label={t('Mark as watched', 'Marcar como vista')}
        title={t('Mark as watched', 'Marcar como vista')}
        disabled={!data || watched || busy}
        onClick={async () => {
          if (!window.confirm(t('Mark as watched?', '¿Marcar como vista?')))
            return;
          setBusy(true);
          setFailed(false);
          try {
            await mutate(
              (await axios.put(endpoint, { watched: true })).data,
              false
            );
            await refresh(
              (key) =>
                typeof key === 'string' &&
                key.startsWith(`/api/v1/social/${type}/${id}`)
            );
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <span aria-hidden="true">{busy ? '…' : '+'}</span>
      </Button>
      {failed && (
        <span role="alert">
          {t(
            'Could not save. Try again.',
            'No se pudo guardar. Intenta de nuevo.'
          )}
        </span>
      )}
    </span>
  );
}
