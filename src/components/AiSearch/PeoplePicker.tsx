import CachedImage from '@app/components/Common/CachedImage';
import { Popover } from '@headlessui/react';
import { UsersIcon } from '@heroicons/react/24/outline';
import type { ReactNode } from 'react';
import useSWR from 'swr';
export default function PeoplePicker({
  people,
  onChange,
  children,
  trailing,
  compact = false,
}: {
  people: number[];
  onChange: (ids: number[]) => void;
  children: ReactNode;
  trailing?: ReactNode;
  compact?: boolean;
}) {
  const {
    data: peopleData,
    error: peopleError,
    mutate: retryPeople,
  } = useSWR<{
    selfId: number;
    users: { id: number; name: string; avatar?: string }[];
  }>('/api/v1/ai-search/people');
  return (
    <Popover
      className={`relative mb-2 flex items-center justify-between ${compact ? 'gap-1' : 'gap-2'}`}
    >
      {children}
      <Popover.Button
        type="button"
        aria-label={`Watching with: you${people.length ? ` and ${people.length} others` : ''}`}
        title="Choose who’s watching"
        className={`relative flex h-11 ${compact ? 'w-8' : 'w-11'} shrink-0 items-center justify-center rounded-full text-purple-300 focus-visible:ring-2 focus-visible:ring-purple-400 disabled:opacity-50 ${people.length ? 'bg-purple-900/40' : 'hover:bg-gray-700'}`}
      >
        <UsersIcon className="h-6 w-6" aria-hidden="true" />
        {people.length > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-purple-500 px-1 text-[10px] font-bold text-white"
          >
            {people.length}
          </span>
        )}
      </Popover.Button>
      {trailing}
      <Popover.Panel
        focus
        className="absolute right-0 top-full z-40 mt-2 w-80 max-w-full rounded-2xl border border-gray-600 bg-gray-800 p-3 shadow-xl"
      >
        {({ close }) => (
          <>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-gray-100">Who’s watching?</h2>
              <button
                type="button"
                onClick={() => close()}
                className="rounded-full px-3 py-2 text-sm text-purple-300"
              >
                Done
              </button>
            </div>
            <p className="my-2 text-xs text-gray-400">
              You’re included. Choose up to five others to exclude anything any
              of you has watched.
            </p>
            {peopleError ? (
              <button
                type="button"
                onClick={() => void retryPeople()}
                className="text-sm text-purple-300"
              >
                Couldn’t load people. Retry
              </button>
            ) : !peopleData ? (
              <p role="status" className="text-sm text-gray-400">
                Loading people…
              </p>
            ) : (
              <div className="max-h-[45vh] space-y-2 overflow-y-auto overscroll-contain">
                {peopleData.users
                  .filter((u) => u.id !== peopleData.selfId)
                  .map((u) => (
                    <label
                      key={u.id}
                      className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-lg bg-gray-900 p-2"
                    >
                      {u.avatar ? (
                        <CachedImage
                          type="avatar"
                          src={u.avatar}
                          alt=""
                          width={28}
                          height={28}
                          className="h-7 w-7 rounded-full object-cover"
                        />
                      ) : (
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-700">
                          {u.name.slice(0, 1)}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 break-words text-sm">
                        {u.name}
                      </span>
                      <input
                        type="checkbox"
                        aria-label={u.name}
                        checked={people.includes(u.id)}
                        disabled={people.length >= 5 && !people.includes(u.id)}
                        onChange={(e) =>
                          onChange(
                            e.target.checked
                              ? [...people, u.id]
                              : people.filter((id) => id !== u.id)
                          )
                        }
                      />
                    </label>
                  ))}
              </div>
            )}

            {peopleData &&
              peopleData.users.filter((u) => u.id !== peopleData.selfId)
                .length === 0 && (
                <p className="py-2 text-sm text-gray-400">
                  No other viewers are available.
                </p>
              )}
          </>
        )}
      </Popover.Panel>
    </Popover>
  );
}
