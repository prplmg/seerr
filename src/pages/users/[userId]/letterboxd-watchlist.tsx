import Header from '@app/components/Common/Header';
import PageTitle from '@app/components/Common/PageTitle';
import { WatchlistCard } from '@app/components/Reviews/LetterboxdWatchlist';
import { useUser } from '@app/hooks/useUser';
import useVerticalScroll from '@app/hooks/useVerticalScroll';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useIntl } from 'react-intl';
import useSWRInfinite from 'swr/infinite';

type Page = {
  available: boolean;
  stale?: boolean;
  totalPages: number;
  results: { slug: string; title: string }[];
};
export default function LetterboxdWatchlistPage() {
  const router = useRouter();
  const userId = Number(router.query.userId);
  const { user } = useUser({ id: userId });
  const es = useIntl().locale.startsWith('es');
  const title = es
    ? 'Lista de seguimiento de Letterboxd'
    : 'Letterboxd Watchlist';
  const { data, error, size, setSize, isValidating, mutate } =
    useSWRInfinite<Page>(
      (index, previous) =>
        !router.isReady ||
        !Number.isSafeInteger(userId) ||
        userId < 1 ||
        (previous && (!previous.available || index >= previous.totalPages))
          ? null
          : `/api/v1/letterboxd-watchlist/${userId}?page=${index + 1}`,
      { revalidateOnFocus: false }
    );
  const first = data?.[0];
  const more = !!first?.available && size < first.totalPages;
  const loadingPage = !data || data.length < size;
  useVerticalScroll(
    () => setSize((current) => current + 1),
    more && !loadingPage && !isValidating && !error
  );
  const items = [
    ...new Map(
      (data ?? [])
        .flatMap((page) => page.results)
        .map((item) => [item.slug, item])
    ).values(),
  ];
  return (
    <>
      <PageTitle title={[title, user?.displayName ?? '']} />
      <div className="mb-5 mt-1">
        <Header
          subtext={
            <Link href={`/users/${userId}`} className="hover:underline">
              {user?.displayName}
            </Link>
          }
        >
          {title}
        </Header>
      </div>
      {(error || first?.available === false) && (
        <p className="text-yellow-300">
          {es
            ? 'La lista no está disponible temporalmente.'
            : 'Watchlist temporarily unavailable.'}
        </p>
      )}
      {first?.stale && (
        <p className="mb-4 text-yellow-300">
          {es
            ? 'Se muestra la última lista verificada.'
            : 'Showing the last verified watchlist.'}
        </p>
      )}
      {first?.available && !items.length && (
        <p className="text-gray-300">
          {es ? 'Esta lista está vacía.' : 'This watchlist is empty.'}
        </p>
      )}
      <ul className="cards-vertical">
        {items.map((item) => (
          <li key={item.slug}>
            <WatchlistCard userId={userId} item={item} canExpand />
          </li>
        ))}
      </ul>
      {isValidating && (
        <p role="status" className="my-4 text-gray-300">
          {es ? 'Cargando…' : 'Loading…'}
        </p>
      )}
      {error && (
        <button
          className="my-4 rounded-lg border border-gray-600 px-4 py-2 text-white disabled:opacity-50"
          disabled={isValidating}
          onClick={() => mutate()}
        >
          {es ? 'Reintentar' : 'Retry'}
        </button>
      )}
    </>
  );
}
