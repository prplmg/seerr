import CachedImage from '@app/components/Common/CachedImage';
import { usePartyText } from '@app/components/WatchParty/messages';
import useDiscovery from '@app/hooks/useDiscovery';
import { useUser } from '@app/hooks/useUser';
import { ArrowRightIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useEffect, useState } from 'react';
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
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Hydration has committed; allow the initial paint before this optional read.
    // No viewport or first-input dependency: scrolling quickly finds it ready.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);
  const { data } = useSWR<{ results: Membership[] }>(
    enabled && user && ready
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
        className={`${collection || hasLists ? 'mb-6' : ''} grid min-w-0 grid-cols-1 gap-3`}
      >
        {collection && (
          <Link
            href={`/collection/${collection.id}`}
            className="group relative block min-w-0 overflow-hidden rounded-lg bg-gray-800 shadow-md ring-1 ring-gray-700 transition hover:ring-gray-500 focus-visible:ring-2 focus-visible:ring-purple-400"
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
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  'linear-gradient(180deg, rgba(31, 41, 55, 0.47) 0%, rgba(31, 41, 55, 0.80) 100%)',
              }}
            />
            <div className="relative flex items-center justify-between gap-3 p-4 text-gray-200 group-hover:text-white">
              <span className="min-w-0 break-words">{collection.name}</span>
              <span className="button-sm inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-gray-600 bg-gray-800/80 px-2.5 py-1.5 text-xs font-medium leading-5">
                {t('View', 'Ver')}
              </span>
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
              className="relative flex min-h-[80px] w-full min-w-0 items-center justify-between gap-3 overflow-hidden rounded-xl border border-gray-600 bg-gray-800 p-4 text-left text-gray-100 hover:border-purple-300 focus-visible:ring-2 focus-visible:ring-purple-400"
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
              <div className="relative min-w-0">
                <div className="mb-1 text-xs text-gray-300">
                  {type === 'movie'
                    ? t('Featuring this film', 'Con esta película')
                    : t('Featuring this series', 'Con esta serie')}
                </div>
                <div className="break-words text-lg font-semibold leading-tight">
                  {t('Explore lists', 'Explorar listas')}
                </div>
              </div>
              <ArrowRightIcon
                className="relative h-7 w-7 shrink-0 rounded-full border border-purple-200/40 bg-gray-900/40 p-1 text-purple-200"
                aria-hidden="true"
              />
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
