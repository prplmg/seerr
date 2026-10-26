import CachedImage from '@app/components/Common/CachedImage';
import AvatarStack from '@app/components/SocialPeople/AvatarStack';
import { useInView } from 'react-intersection-observer';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

export default function EpisodeWatchers({
  tvId,
  season,
  episode,
}: {
  tvId: number;
  season: number;
  episode?: number;
}) {
  const es = useIntl().locale.startsWith('es');
  const { ref, inView } = useInView({
    triggerOnce: true,
    rootMargin: '100px 0px',
    fallbackInView: true,
  });
  const { data, error } = useSWR<{
    enabled: boolean;
    watchers: {
      id: number;
      name: string;
      avatar: string;
      latestEpisode?: { season: number; episode: number };
    }[];
  }>(inView ? `/api/v1/social/tv/${tvId}` : null, {
    refreshInterval: 120000,
    dedupingInterval: 30000,
    errorRetryCount: 2,
  });
  const users =
    !error && data?.enabled
      ? data.watchers.filter(
          (u) =>
            u.latestEpisode?.season === season &&
            (episode === undefined || u.latestEpisode.episode === episode)
        )
      : [];
  return (
    <span
      ref={ref}
      className="ml-auto flex min-w-0 flex-1 justify-end"
      tabIndex={episode === undefined || !users.length ? undefined : 0}
      aria-label={users.map((u) => u.name).join(', ')}
      title={users.map((u) => u.name).join(', ')}
    >
      <AvatarStack
        size={24}
        items={users.map((u) => ({
          id: u.id,
          name: `${u.name} · ${es ? 'Último episodio visto' : 'Last watched'} S${String(u.latestEpisode!.season).padStart(2, '0')}E${String(u.latestEpisode!.episode).padStart(2, '0')}`,
          image: (
            <CachedImage
              type="avatar"
              src={u.avatar}
              alt={u.name}
              width={24}
              height={24}
              className="h-6 w-6 rounded-full bg-gray-800 ring-1 ring-white"
            />
          ),
        }))}
      />
    </span>
  );
}
