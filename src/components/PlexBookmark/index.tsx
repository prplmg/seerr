import Button from '@app/components/Common/Button';
import defineMessages from '@app/utils/defineMessages';
import { BookmarkIcon } from '@heroicons/react/24/outline';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.PlexBookmark', {
  add: 'Add to Plex Watchlist',
  remove: 'Remove from Plex Watchlist',
  unavailable: 'Plex Watchlist is temporarily unavailable.',
  failed: 'Could not update Plex Watchlist. Please try again.',
});
export default function PlexBookmark({
  id,
  type,
}: {
  id: number;
  type: 'movie' | 'tv';
}) {
  const intl = useIntl();
  const url = `/api/v1/watchlist/plex/${type}/${id}`;
  const {
    data,
    error,
    mutate: refresh,
  } = useSWR<{ added: boolean }>(url, { refreshInterval: 30000 });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const label = intl.formatMessage(
    error ? messages.unavailable : data?.added ? messages.remove : messages.add
  );
  return (
    <div className="flex flex-col gap-1">
      <Button
        buttonType="ghost"
        aria-label={label}
        title={label}
        aria-pressed={data?.added ?? false}
        disabled={!data || !!error || busy}
        onClick={async () => {
          if (!data || busy) return;
          setBusy(true);
          setFailed(false);
          try {
            const result = await axios.put(url, { added: !data.added });
            await refresh(result.data, false);
            await mutate(
              (key) =>
                typeof key === 'string' &&
                /^\/api\/v1\/user\/\d+\/watchlist/.test(key)
            );
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <BookmarkIcon
          aria-hidden="true"
          className={data?.added ? 'fill-current text-purple-400' : ''}
        />
      </Button>
      {(failed || error) && (
        <span role="status" className="max-w-xs text-xs text-yellow-300">
          {intl.formatMessage(failed ? messages.failed : messages.unavailable)}
        </span>
      )}
    </div>
  );
}
