import CachedImage from '@app/components/Common/CachedImage';
import { usePartyText } from '@app/components/WatchParty/messages';
import { useUser } from '@app/hooks/useUser';
import { Dialog } from '@headlessui/react';
import { ArrowRightIcon, XMarkIcon } from '@heroicons/react/24/outline';
import axios from 'axios';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { listAuthorStyle } from './listAuthorStyle';

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
}: {
  type: 'movie' | 'tv';
  id: number;
  collection?: Collection | null;
  backdropPath?: string | null;
}) {
  const t = usePartyText();
  const { user } = useUser();
  const [open, setOpen] = useState(false);
  // An unopened detail page never starts list/history work. SWR keys are user-scoped.
  const { data, error, mutate } = useSWR<{ results: Membership[] }>(
    open && user
      ? [`/api/v1/discovery-lists/media/${type}/${id}`, user.id]
      : null,
    async ([url]: [string, number]) => (await axios.get(url)).data,
    { revalidateOnFocus: false }
  );
  return (
    <>
      <div
        className={`mb-6 grid min-w-0 gap-3 ${collection ? 'grid-cols-2' : 'grid-cols-1'}`}
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
        <div className="relative mr-1.5 mt-2 min-w-0">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-1.5 -top-2 bottom-2 left-1.5 rounded-xl border border-purple-300/40 bg-gray-800"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-0.5 -top-1 bottom-1 left-0.5 rounded-xl border border-purple-300/40 bg-gray-700"
          />
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(true)}
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
          </button>
        </div>
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        className="relative z-[100]"
      >
        <div className="fixed inset-0 bg-black/60" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-600 bg-gray-800 p-5 text-gray-100 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <Dialog.Title className="text-lg font-semibold">
                {t(
                  'Lists featuring this title',
                  'Listas que incluyen este título'
                )}
              </Dialog.Title>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-2 hover:bg-gray-700"
                aria-label={t('Close', 'Cerrar')}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            {error ? (
              <button
                type="button"
                onClick={() => void mutate()}
                className="text-purple-300"
              >
                {t(
                  'Could not load lists. Retry',
                  'No se pudieron cargar las listas. Reintentar'
                )}
              </button>
            ) : !data ? (
              <p role="status" className="text-gray-400">
                {t('Loading lists…', 'Cargando listas…')}
              </p>
            ) : data.results.length ? (
              <ul className="divide-y divide-gray-700">
                {data.results.map((list) => (
                  <li key={list.id}>
                    <Link
                      href={`/lists/${encodeURIComponent(list.id)}`}
                      onClick={() => setOpen(false)}
                      className="flex min-w-0 items-center gap-3 rounded-lg py-3 hover:bg-gray-700/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="break-words text-purple-200">
                          {list.title}
                        </div>
                        <div
                          className={`mt-1 break-words text-sm ${listAuthorStyle(list.source)}`}
                        >
                          {list.creator}
                        </div>
                        <div className="mt-1 text-xs text-gray-400">
                          {list.total} {t('titles', 'títulos')}
                          {list.saved ? ` · ${t('Saved', 'Guardada')}` : ''}
                        </div>
                      </div>
                      <ArrowRightIcon
                        className="h-4 w-4 shrink-0"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-400">
                {t(
                  'No lists featuring this title yet.',
                  'Todavía no hay listas que incluyan este título.'
                )}
              </p>
            )}
            <Link
              href="/lists/explore"
              onClick={() => setOpen(false)}
              className="mt-5 inline-flex items-center gap-2 text-purple-300"
            >
              {t('Explore lists', 'Explorar listas')}
              <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Dialog.Panel>
        </div>
      </Dialog>
    </>
  );
}
