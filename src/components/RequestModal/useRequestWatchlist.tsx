import useToasts from '@app/hooks/useToasts';
import axios from 'axios';
import { useCallback, useState } from 'react';
import { mutate } from 'swr';

export default function useRequestWatchlist() {
  const [enabled, setEnabled] = useState(true);
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
        onChange={(event) => setEnabled(event.target.checked)}
      />
      <span>Add to watchlist</span>
    </label>
  );
  return { checkbox, addRequested };
}
