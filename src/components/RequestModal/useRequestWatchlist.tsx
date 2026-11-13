import useToasts from '@app/hooks/useToasts';
import { useUser } from '@app/hooks/useUser';
import axios from 'axios';
import { useCallback, useState } from 'react';
import { mutate } from 'swr';

export default function useRequestWatchlist() {
  const { user, revalidate } = useUser();
  const [choice, setChoice] = useState<{
    userId: number;
    enabled: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const enabled =
    choice && choice.userId === user?.id
      ? choice.enabled
      : (user?.settings?.requestAddToWatchlist ?? false);
  const saveChoice = async (value: boolean) => {
    if (!user || saving) return;
    const previous = enabled;
    setChoice({ userId: user.id, enabled: value });
    setSaving(true);
    try {
      await axios.put(`/api/v1/user/${user.id}/settings/request-watchlist`, {
        enabled: value,
      });
      await revalidate(
        {
          ...user,
          settings: {
            ...user.settings,
            notificationTypes: user.settings?.notificationTypes ?? {},
            requestAddToWatchlist: value,
          },
        },
        false
      );
    } catch {
      setChoice({ userId: user.id, enabled: previous });
      addToast('Could not save your watchlist preference. Please try again.', {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setSaving(false);
    }
  };
  const { addToast } = useToasts();
  const addRequested = useCallback(
    async (type: 'movie' | 'tv', id: number) => {
      if (!enabled) return;
      try {
        const url = `/api/v1/watchlist/plex/${type}/${id}`;
        const result = await axios.put(url, { added: true });
        await mutate(url, result.data, false);
        await mutate(
          (key) =>
            typeof key === 'string' &&
            /^\/api\/v1\/user\/\d+\/watchlist/.test(key)
        );
      } catch {
        addToast(
          'Request submitted, but could not add to your watchlist. Please try the bookmark button again.',
          { appearance: 'warning', autoDismiss: true }
        );
      }
    },
    [enabled, addToast]
  );
  const checkbox = (
    <label className="my-4 flex items-center gap-2 text-gray-200">
      <input
        type="checkbox"
        checked={enabled}
        disabled={!user || saving}
        onChange={(event) => void saveChoice(event.target.checked)}
      />
      <span>Add to watchlist</span>
    </label>
  );
  return { checkbox, addRequested };
}
