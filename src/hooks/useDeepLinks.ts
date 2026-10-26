import useSettings from '@app/hooks/useSettings';
import { MediaServerType } from '@server/constants/server';
import useSWR from 'swr';
import useMobilePlex from './useMobilePlex';

interface useDeepLinksProps {
  mediaId?: number;
  mediaUrl?: string;
  mediaUrl4k?: string;
  iOSPlexUrl?: string;
  iOSPlexUrl4k?: string;
}

const useDeepLinks = ({ mediaId, mediaUrl, mediaUrl4k }: useDeepLinksProps) => {
  const mobile = useMobilePlex();
  const settings = useSettings();

  const { data } = useSWR<{ url: string | null }>(
    mobile &&
      mediaId &&
      (mediaUrl || mediaUrl4k) &&
      settings.currentSettings.mediaServerType === MediaServerType.PLEX
      ? `/api/v1/media/${mediaId}/plex-watch-url`
      : null,
    { revalidateOnFocus: false, dedupingInterval: 86400000, errorRetryCount: 1 }
  );

  return {
    mediaUrl: mediaUrl ? data?.url || mediaUrl : undefined,
    mediaUrl4k: mediaUrl4k ? data?.url || mediaUrl4k : undefined,
  };
};

export default useDeepLinks;
