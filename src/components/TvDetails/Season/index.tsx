import AirDateBadge from '@app/components/AirDateBadge';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import { MovieReviews } from '@app/components/Reviews';
import useMobilePlex from '@app/hooks/useMobilePlex';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import type { SeasonWithEpisodes } from '@server/models/Tv';
import { useRouter } from 'next/router';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';
import EpisodeWatchers from './EpisodeWatchers';

const messages = defineMessages('components.TvDetails.Season', {
  somethingwentwrong: 'Something went wrong while retrieving season data.',
  noepisodes: 'Episode list unavailable.',
});

type SeasonProps = {
  seasonNumber: number;
  tvId: number;
};

const Season = ({ seasonNumber, tvId }: SeasonProps) => {
  const intl = useIntl();
  const mobile = useMobilePlex();
  const es = intl.locale.startsWith('es');
  const router = useRouter();
  const [selected, setSelected] = useState<number | null>(null);
  const openedLink = useRef<string | null>(null);
  const { data: ratings, mutate: refreshRatings } = useSWR<{
    results: {
      seasonNumber: number;
      episodeNumber: number;
      average: number | null;
      count: number;
    }[];
  }>(`/api/v1/reviews/episodes/${tvId}`);
  const { data: links } = useSWR<{
    results: { episode: number; url: string; mobileUrl?: string | null }[];
  }>(`/api/v1/social/episodes/${tvId}/${seasonNumber}`);
  const { data, error } = useSWR<SeasonWithEpisodes>(
    `/api/v1/tv/${tvId}/season/${seasonNumber}`
  );
  useEffect(() => {
    const episode = Number(
      router.query.reviewEpisode ?? router.query.viewEpisode
    );
    if (
      Number(router.query.reviewSeason) !== seasonNumber ||
      !Number.isSafeInteger(episode) ||
      episode < 1
    ) {
      openedLink.current = null;
      return;
    }
    const key = `${tvId}:${seasonNumber}:${episode}`;
    if (
      openedLink.current === key ||
      !data?.episodes.some((e) => e.episodeNumber === episode)
    )
      return;
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(
        `episode-${tvId}-${seasonNumber}-${episode}`
      );
      if (!element) return;
      // Position the page before the modal captures/locks its scroll position.
      element.scrollIntoView({ block: 'start', behavior: 'instant' });
      openedLink.current = key;
      if (router.query.reviewEpisode) setSelected(episode);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    data,
    tvId,
    seasonNumber,
    router.query.reviewSeason,
    router.query.reviewEpisode,
    router.query.viewEpisode,
  ]);

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <div>{intl.formatMessage(messages.somethingwentwrong)}</div>;
  }

  return (
    <div className="flex flex-col justify-center divide-y divide-gray-700">
      {selected !== null &&
        data.episodes.some((e) => e.episodeNumber === selected) && (
          <Transition show appear as={Fragment}>
            <Modal
              title={`S${String(seasonNumber).padStart(2, '0')}E${String(selected).padStart(2, '0')} · ${data.episodes.find((e) => e.episodeNumber === selected)?.name}`}
              onCancel={() => setSelected(null)}
              cancelText={es ? 'Cerrar' : 'Close'}
            >
              <MovieReviews
                key={`${seasonNumber}:${selected}`}
                movieId={tvId}
                mediaType="tv"
                seasonNumber={seasonNumber}
                episodeNumber={selected}
                onSaved={() => {
                  void refreshRatings();
                }}
              />
            </Modal>
          </Transition>
        )}
      {data.episodes.length === 0 ? (
        <p>{intl.formatMessage(messages.noepisodes)}</p>
      ) : (
        data.episodes
          .slice()
          .sort((a, b) => a.episodeNumber - b.episodeNumber)
          .map((episode) => {
            const rating = ratings?.results.find(
              (r) =>
                r.seasonNumber === seasonNumber &&
                r.episodeNumber === episode.episodeNumber
            );
            const plexLink = links?.results.find(
              (r) => r.episode === episode.episodeNumber
            );
            const plexUrl = mobile
              ? plexLink?.mobileUrl || plexLink?.url
              : plexLink?.url;
            return (
              <div
                id={`episode-${tvId}-${seasonNumber}-${episode.episodeNumber}`}
                style={{ scrollMarginTop: 96 }}
                className="flex flex-col space-y-4 py-4 xl:flex-row xl:space-x-4 xl:space-y-4"
                key={`season-${seasonNumber}-episode-${episode.episodeNumber}`}
              >
                <div className="flex-1">
                  <div className="flex flex-col space-y-2">
                    <h3 className="text-lg">
                      {episode.episodeNumber} - {episode.name}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 pb-2">
                      {episode.airDate && (
                        <AirDateBadge airDate={episode.airDate} />
                      )}
                      <button
                        className="text-sm text-purple-300 hover:text-purple-200"
                        onClick={() => setSelected(episode.episodeNumber)}
                        aria-label={
                          es
                            ? 'Calificar o reseñar este episodio'
                            : 'Rate or review this episode'
                        }
                      >
                        {rating?.average != null
                          ? `★ ${Number(rating.average.toFixed(1))}/5`
                          : '☆'}
                      </button>
                      <EpisodeWatchers
                        tvId={tvId}
                        season={seasonNumber}
                        episode={episode.episodeNumber}
                      />
                    </div>
                  </div>
                  {episode.overview && <p>{episode.overview}</p>}
                </div>
                <div className="flex flex-col gap-2 xl:w-56 xl:flex-none">
                  {episode.stillPath && (
                    <div className="relative aspect-video">
                      <CachedImage
                        type="tmdb"
                        className="rounded-lg object-contain"
                        src={episode.stillPath}
                        alt=""
                        fill
                      />
                    </div>
                  )}
                  {plexUrl && (
                    <a
                      href={plexUrl}
                      target={
                        mobile && plexLink?.mobileUrl ? undefined : '_blank'
                      }
                      rel="noopener noreferrer"
                      className="text-sm text-purple-300 hover:underline"
                    >
                      {es ? 'Abrir en Plex ↗' : 'Open in Plex ↗'}
                    </a>
                  )}
                </div>
              </div>
            );
          })
      )}
    </div>
  );
};

export default Season;
