import Header from '@app/components/Common/Header';
import PageTitle from '@app/components/Common/PageTitle';
import PlexLibraryList from '@app/components/Discover/PlexLibraryList';
import catalogueMessages from '@app/components/Discover/catalogueMessages';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useIntl } from 'react-intl';

export default function CatalogueBrowse({ mode }: { mode: 'added' | 'watched' }) {
  const intl = useIntl();
  const router = useRouter();
  const type = router.query.type === 'movie' || router.query.type === 'tv' ? router.query.type : 'all';
  const title = intl.formatMessage(mode === 'watched' ? catalogueMessages.recentlyWatched : catalogueMessages.recentlyAdded);
  const base = mode === 'watched' ? '/discover/recently-watched' : '/discover/recently-added';
  return <>
    <PageTitle title={title} />
    <Header>{title}</Header>
    <nav aria-label={intl.formatMessage(catalogueMessages.mediaType)} className="my-4 flex flex-wrap gap-2">
      {(['all', 'movie', 'tv'] as const).map(value => <Link
        key={value}
        href={value === 'all' ? base : `${base}?type=${value}`}
        aria-current={type === value ? 'page' : undefined}
        className={`rounded-md border px-4 py-2 ${type === value ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-600 bg-gray-800 text-gray-200 hover:bg-gray-700'}`}
      >{intl.formatMessage(value === 'all' ? catalogueMessages.all : value === 'movie' ? catalogueMessages.movies : catalogueMessages.series)}</Link>)}
    </nav>
    {router.isReady && <PlexLibraryList key={`${mode}:${type}`} type={type} mode={mode} />}
  </>;
}
