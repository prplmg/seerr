import useSearchInput from '@app/hooks/useSearchInput';
import defineMessages from '@app/utils/defineMessages';
import { XCircleIcon } from '@heroicons/react/24/outline';
import { MagnifyingGlassIcon } from '@heroicons/react/24/solid';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useId } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Layout.SearchInput', {
  searchPlaceholder: 'Search Movies & Series',
  searchPlaceholderShort: 'Search Titles',
});

const SearchInput = () => {
  const intl = useIntl();
  const router = useRouter();
  const gradientId = `ai-search-${useId().replace(/:/g, '')}`;
  const { searchValue, setSearchValue, setIsOpen, clear } = useSearchInput();
  return (
    <div className="flex min-w-0 flex-1 items-center">
      <div
        className="flex w-full min-w-0"
        style={{ containerType: 'inline-size', containerName: 'search-field' }}
      >
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
              paddingRight: searchValue.length > 0 ? '2.5rem' : '1rem',
            }}
            className="peer block min-h-[44px] w-full min-w-0 rounded-full border border-gray-600 bg-gray-900/80 py-2 pl-10 text-white placeholder-transparent hover:border-gray-500 focus:border-gray-500 focus:bg-gray-900 focus:placeholder-transparent focus:outline-none focus:ring-0 sm:text-base"
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
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-10 right-4 hidden overflow-hidden whitespace-nowrap text-gray-300 peer-placeholder-shown:block"
          >
            <span className="search-placeholder-full">
              {intl.formatMessage(messages.searchPlaceholder)}
            </span>
            <span className="search-placeholder-short">
              {intl.formatMessage(messages.searchPlaceholderShort)}
            </span>
          </span>
          {searchValue.length > 0 && (
            <button
              className="absolute inset-y-0 right-2 m-auto h-7 w-7 border-none p-1 text-gray-400 outline-none transition hover:text-white focus:border-none focus:outline-none"
              aria-label="Clear search"
              onClick={() => clear()}
            >
              <XCircleIcon className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
      <Link
        href="/ai-search"
        aria-label="AI Search"
        title="AI Search"
        aria-current={router.pathname === '/ai-search' ? 'page' : undefined}
        className={`ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-purple-300 transition hover:bg-gray-700 hover:text-purple-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${router.pathname === '/ai-search' ? 'bg-purple-500/15' : ''}`}
      >
        <svg className="absolute h-0 w-0" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#c4b5fd" />
              <stop offset="50%" stopColor="#c084fc" />
              <stop offset="100%" stopColor="#f9a8d4" />
            </linearGradient>
          </defs>
        </svg>
        <svg
          className="h-6 w-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="9.5" cy="10.5" r="6.5" />
          <path d="m14.2 15.2 6.3 6.3M18 1.5l.9 2.6 2.6.9-2.6.9L18 8.5l-.9-2.6-2.6-.9 2.6-.9ZM21 10v3m-1.5-1.5h3" />
        </svg>
      </Link>
    </div>
  );
};

export default SearchInput;
