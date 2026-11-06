import CachedImage from '@app/components/Common/CachedImage';
import { usePartyText } from '@app/components/WatchParty/messages';
import useDiscovery from '@app/hooks/useDiscovery';
import { useUser } from '@app/hooks/useUser';
import { ArrowRightIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useInView } from 'react-intersection-observer';
import useSWR from 'swr';

type Membership = {
  id: string;
  title: string;
  creator: string;
  source: 'curated' | 'letterboxd' | 'catalogue';
  total: number;
  saved: boolean;
};
type Collection = { id: number; name: string; backdropPath?: string | null };

export default function MediaLists({
  type,
  id,
  collection,
  backdropPath,
  title,
}: {
  type: 'movie' | 'tv';
  id: number;
  collection?: Collection | null;
  backdropPath?: string | null;
  title?: string;
}) {
  const t = usePartyText();
  const { user } = useUser();
  const { enabled, read, href, previewUserId } = useDiscovery();
  const { ref, inView } = useInView({ triggerOnce: true });
  const { data } = useSWR<{ results: Membership[] }>(
    enabled && user && inView
      ? [`/api/v1/discovery-lists/media/${type}/${id}`, user.id, previewUserId]
      : null,
    read,
    { revalidateOnFocus: false, dedupingInterval: 15000 }
  );
  const hasLists = !!data?.results.length;
  const listsHref = href(
    `/lists/explore?${new URLSearchParams({ mediaType: type, mediaId: String(id), ...(title ? { mediaTitle: title } : {}) })}`
  );
  return (
    <>
      <div
        ref={ref}
        className={`${collection || hasLists ? 'mb-6' : 'min-h-px'} grid min-w-0 gap-3 ${collection && hasLists ? 'grid-cols-2' : 'grid-cols-1'}`}
      >
        {collection && (
          <Link
            href={`/collection/${collection.id}`}
            className="relative mt-2 flex min-h-[112px] min-w-0 items-end overflow-hidden rounded-xl border border-gray-600 bg-gray-800 p-3 text-gray-100 hover:border-gray-400 focus-visible:ring-2 focus-visible:ring-purple-400"
          >
            {collection.backdropPath && (
              <CachedImage
                type="tmdb"
                src={`https://image.tmdb.org/t/p/w1440_and_h320_multi_faces/${collection.backdropPath}`}
                alt=""
                fill
                style={{ objectFit: 'cover' }}
              />
            )}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/50 to-gray-900/30" />
            <ArrowRightIcon
              className="absolute right-3 top-3 h-6 w-6 rounded-full border border-purple-200/40 bg-gray-900/40 p-1 text-purple-200"
              aria-hidden="true"
            />
            <div className="relative min-w-0 pt-8">
              <div className="mb-1 text-xs text-gray-300">
                {t('Collection', 'Colección')}
              </div>
              <div className="break-words text-lg font-semibold leading-tight">
                {collection.name}
              </div>
            </div>
          </Link>
        )}
        {hasLists && (
          <div className="relative mr-1.5 mt-2 min-w-0">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-1.5 -top-2 bottom-2 left-1.5 rounded-xl border border-purple-300/40 bg-gray-800"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-0.5 -top-1 bottom-1 left-0.5 rounded-xl border border-purple-300/40 bg-gray-700"
            />
            <Link
              href={listsHref}
              className="relative flex h-full min-h-[112px] w-full min-w-0 items-end overflow-hidden rounded-xl border border-gray-600 bg-gray-800 p-3 text-left text-gray-100 hover:border-purple-300 focus-visible:ring-2 focus-visible:ring-purple-400"
            >
              {backdropPath && (
                <CachedImage
                  type="tmdb"
                  src={`https://image.tmdb.org/t/p/w1440_and_h320_multi_faces/${backdropPath}`}
                  alt=""
                  fill
                  style={{ objectFit: 'cover' }}
                />
              )}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/50 to-gray-900/30" />
              <ArrowRightIcon
                className="absolute right-3 top-3 h-6 w-6 rounded-full border border-purple-200/40 bg-gray-900/40 p-1 text-purple-200"
                aria-hidden="true"
              />
              <div className="relative min-w-0 pt-8">
                <div className="mb-1 text-xs text-gray-300">
                  {type === 'movie'
                    ? t('Featuring this film', 'Con esta película')
                    : t('Featuring this series', 'Con esta serie')}
                </div>
                <div className="break-words text-lg font-semibold leading-tight">
                  {t('Explore lists', 'Explorar listas')}
                </div>
              </div>
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
