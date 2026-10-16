import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import defineMessages from '@app/utils/defineMessages';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.UserDirectory', {
  title: 'Users',
  previous: 'Previous',
  next: 'Next',
  error: 'Could not load users.',
});
export default function UserDirectory() {
  const intl = useIntl();
  const [page, setPage] = useState(0);
  const { data, error } = useSWR<{
    results: { id: number; displayName: string; avatar: string }[];
    pageInfo: { pages: number };
  }>(`/api/v1/user?take=20&skip=${page * 20}&sort=displayname`);
  if (error) return <p role="alert">{intl.formatMessage(messages.error)}</p>;
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">
        {intl.formatMessage(messages.title)}
      </h1>
      {!data ? (
        <LoadingSpinner />
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {data.results.map((user) => (
            <Link
              key={user.id}
              href={`/users/${user.id}`}
              className="flex items-center gap-3 rounded-lg bg-gray-800 p-4 hover:bg-gray-700 hover:underline"
            >
              {/* User avatars use the same trusted URLs as profile headers. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={user.avatar}
                alt=""
                className="h-10 w-10 rounded-full"
              />
              <span className="break-words">{user.displayName}</span>
            </Link>
          ))}
        </div>
      )}
      <div className="mt-6 flex gap-4">
        <button
          disabled={!page}
          onClick={() => setPage(page - 1)}
          className="disabled:opacity-40"
        >
          {intl.formatMessage(messages.previous)}
        </button>
        <button
          disabled={!data || page + 1 >= data.pageInfo.pages}
          onClick={() => setPage(page + 1)}
          className="disabled:opacity-40"
        >
          {intl.formatMessage(messages.next)}
        </button>
      </div>
    </>
  );
}
