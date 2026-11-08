import useSearchInput from '@app/hooks/useSearchInput';
import defineMessages from '@app/utils/defineMessages';
import { SparklesIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { MagnifyingGlassIcon } from '@heroicons/react/24/solid';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useId } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Layout.SearchInput', {
  searchPlaceholder: 'Search Movies & Series',
});

const SearchInput = () => {
  const intl = useIntl();
  const router = useRouter();
  const gradientId = `ai-search-${useId().replace(/:/g, '')}`;
  const { searchValue, setSearchValue, setIsOpen, clear } = useSearchInput();
  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex w-full min-w-0">
        <label htmlFor="search_field" className="sr-only">
          Search
        </label>
        <div className="relative flex w-full items-center text-white focus-within:text-gray-200">
          <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center">
            <MagnifyingGlassIcon className="h-5 w-5" />
          </div>
          <input
            id="search_field"
            style={{
              paddingRight: searchValue.length > 0 ? '5.25rem' : '3rem',
            }}
            className="block min-h-[44px] w-full min-w-0 rounded-full border border-gray-600 bg-gray-900/80 py-2 pl-10 text-white placeholder-gray-300 hover:border-gray-500 focus:border-gray-500 focus:bg-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-0 sm:text-base"
            placeholder={intl.formatMessage(messages.searchPlaceholder)}
            type="search"
            autoComplete="off"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onFocus={() => setIsOpen(true)}
            onBlur={() => {
              if (searchValue === '') {
                setIsOpen(false);
              }
            }}
            onKeyUp={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          <Link
            href="/ai-search"
            aria-label="AI Search"
            title="AI Search"
            aria-current={router.pathname === '/ai-search' ? 'page' : undefined}
            className={`absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-full text-purple-300 transition hover:bg-gray-700 hover:text-purple-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${router.pathname === '/ai-search' ? 'bg-purple-500/15' : ''}`}
          >
            <svg
              className="absolute h-0 w-0"
              aria-hidden="true"
              focusable="false"
            >
              <defs>
                <linearGradient
                  id={gradientId}
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="#c4b5fd" />
                  <stop offset="50%" stopColor="#c084fc" />
                  <stop offset="100%" stopColor="#f9a8d4" />
                </linearGradient>
              </defs>
            </svg>
            <SparklesIcon
              className="h-5 w-5"
              style={{ stroke: `url(#${gradientId})` }}
              aria-hidden="true"
            />
          </Link>
          {searchValue.length > 0 && (
            <button
              className="absolute inset-y-0 right-12 m-auto h-7 w-7 border-none p-1 text-gray-400 outline-none transition hover:text-white focus:border-none focus:outline-none"
              aria-label="Clear search"
              onClick={() => clear()}
            >
              <XCircleIcon className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SearchInput;
