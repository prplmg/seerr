import Button from '@app/components/Common/Button';
import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
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
  return (
    <div className="text-white">
      <PageTitle title={intl.formatMessage(messages.title)} />
      <div className="mb-6">
        <Header>{intl.formatMessage(messages.title)}</Header>
      </div>
      {error ? (
        <p role="alert" className="text-red-300">
          {intl.formatMessage(messages.error)}
        </p>
      ) : !data ? (
        <LoadingSpinner />
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {data.results.map((user) => (
            <Link
              key={user.id}
              href={`/users/${user.id}`}
              className="flex min-w-0 items-center gap-3 rounded-lg border border-gray-700 bg-gray-800 p-4 text-white transition hover:border-gray-500 hover:bg-gray-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
            >
              {/* User avatars use the same trusted URLs as profile headers. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={user.avatar}
                alt=""
                className="h-10 w-10 shrink-0 rounded-full"
              />
              <span className="min-w-0 break-words font-medium">
                {user.displayName}
              </span>
            </Link>
          ))}
        </div>
      )}
      <div className="mt-6 flex gap-4">
        <Button
          disabled={!page}
          onClick={() => setPage(page - 1)}
          className="disabled:cursor-not-allowed"
        >
          {intl.formatMessage(messages.previous)}
        </Button>
        <Button
          disabled={!data || page + 1 >= data.pageInfo.pages}
          onClick={() => setPage(page + 1)}
          className="disabled:cursor-not-allowed"
        >
          {intl.formatMessage(messages.next)}
        </Button>
      </div>
    </div>
  );
}
