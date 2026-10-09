import Button from '@app/components/Common/Button';
import TmdbTitleCard from '@app/components/TitleCard/TmdbTitleCard';
import useVerticalScroll from '@app/hooks/useVerticalScroll';
import catalogueMessages from '@app/components/Discover/catalogueMessages';
import { useIntl } from 'react-intl';
import useSWRInfinite from 'swr/infinite';

type LibraryPage = {
  enabled?: boolean;
  page: number;
  totalPages: number;
  totalResults: number;
  results: { id: number; tmdbId: number; tvdbId?: number; mediaType: 'movie' | 'tv' }[];
};

// Membership and pagination are entirely local. Existing cards lazily hydrate
// their artwork/details only when visible; metadata never determines inclusion.
export default function PlexLibraryList({ type, mode = 'added' }: { type: 'all' | 'movie' | 'tv'; mode?: 'added' | 'watched' }) {
  const intl = useIntl();
  const watched = mode === 'watched';
  const endpoint = watched ? '/api/v1/social/recently-watched' : '/api/v1/media/plex-library';
  const { data, error, setSize, isValidating, mutate } = useSWRInfinite<LibraryPage>(
    (index, previous: LibraryPage | null) =>
      previous && index >= previous.totalPages
        ? null
        : `${endpoint}?type=${type}&page=${index + 1}`,
    { revalidateOnFocus: false, revalidateFirstPage: false, refreshInterval: watched ? 120000 : 0 }
  );
  const items = [...new Map((data ?? []).flatMap((page) => page.results).map((item) => [item.id, item])).values()];
  const finished = !!data && data.length >= data[0].totalPages;
  useVerticalScroll(() => setSize((current) => current + 1), !!data && !isValidating && !error && !finished);
  if (data?.[0].enabled === false) return <p>{intl.formatMessage(catalogueMessages.historyDisabled)}</p>;
  return (
    <>
      <p className="mb-4 text-sm text-gray-400">
        {watched ? intl.formatMessage(catalogueMessages.recentlyWatched) : `${intl.formatMessage(catalogueMessages.alreadyOnPlex)} · ${intl.formatMessage(catalogueMessages.recentlyAdded)}`}{data ? ` · ${intl.formatMessage(catalogueMessages.count, {count: data[0].totalResults})}` : ''}.
        {' '}{intl.formatMessage(watched ? catalogueMessages.historyHelp : catalogueMessages.libraryHelp)}
      </p>
      {error && <div role="alert" className="mb-4">{intl.formatMessage(watched ? catalogueMessages.historyError : catalogueMessages.libraryError)} <Button onClick={() => mutate()}>{intl.formatMessage(catalogueMessages.retry)}</Button></div>}
      {!data && !error && <p role="status">{intl.formatMessage(watched ? catalogueMessages.loading : catalogueMessages.loadingLibrary)}</p>}
      {data && data[0].totalResults === 0 && <p>{intl.formatMessage(watched ? catalogueMessages.emptyHistory : catalogueMessages.emptyLibrary)}</p>}
      <ul className="cards-vertical">
        {(watched && error ? [] : items).map((item) => <li key={item.id}><TmdbTitleCard id={item.id} tmdbId={item.tmdbId} tvdbId={item.tvdbId} type={item.mediaType} canExpand /></li>)}
      </ul>
      {data && !finished && isValidating && <p role="status" className="my-6 text-center">{intl.formatMessage(catalogueMessages.loading)}</p>}
    </>
  );
}
