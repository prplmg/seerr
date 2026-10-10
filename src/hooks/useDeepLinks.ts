import useSettings from '@app/hooks/useSettings';
import { MediaServerType } from '@server/constants/server';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

interface useDeepLinksProps {
  mediaId?: number;
  mediaUrl?: string;
  mediaUrl4k?: string;
  iOSPlexUrl?: string;
  iOSPlexUrl4k?: string;
}

const useDeepLinks = ({
  mediaId,
  mediaUrl,
  mediaUrl4k,
}: useDeepLinksProps) => {
  const [mobile, setMobile] = useState(false);
  const settings = useSettings();

  useEffect(() => {
    setMobile(/Android|iPad|iPhone|iPod/i.test(navigator.userAgent) ||
      (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1));
  }, []);
  const { data } = useSWR<{ url: string | null }>(
    mobile && mediaId && (mediaUrl || mediaUrl4k) && settings.currentSettings.mediaServerType === MediaServerType.PLEX
      ? `/api/v1/media/${mediaId}/plex-watch-url` : null,
    { revalidateOnFocus: false, dedupingInterval: 86400000, errorRetryCount: 1 }
  );

  return { mediaUrl: mediaUrl ? data?.url || mediaUrl : undefined, mediaUrl4k: mediaUrl4k ? data?.url || mediaUrl4k : undefined };
};

export default useDeepLinks;
