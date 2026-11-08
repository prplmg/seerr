import FilterChips from '@app/components/AiSearch/FilterChips';
import {
  readSearchScreen,
  saveSearchScreen,
  searchEntry,
} from '@app/components/AiSearch/navigationState';
import { searchStream } from '@app/components/AiSearch/searchStream';
import CachedImage from '@app/components/Common/CachedImage';
import PageTitle from '@app/components/Common/PageTitle';
import TitleCard from '@app/components/TitleCard';
import { useUser } from '@app/hooks/useUser';
import { Popover } from '@headlessui/react';
import { ClockIcon, UsersIcon } from '@heroicons/react/24/outline';
import type { SearchHistoryEntry } from '@server/lib/aiSearchHistory';
import {
  letterboxdFilterLabel,
  type AiFilters,
} from '@server/lib/aiSearchPlan';
import type { MovieResult, TvResult } from '@server/models/Search';
import axios from 'axios';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

interface SearchResponse {
  results: {
    media: MovieResult | TvResult;
    reason: string;
    runtime?: number | null;
    letterboxdRating?: number;
  }[];
  filters: AiFilters;
  note: string;
  ratingCoverage?: { checked: number; unknown: number };
  people?: { id: number; name: string }[];
}
const searchPlaceholder =
  'Adult stop motion movies from the 2010s, under two hours, with a Letterboxd score between 3.5 and 4.5';
export default function AiSearchPage() {
  const { user } = useUser();
  const router = useRouter();
  const entry = useRef<string | undefined>(undefined);
  const [historyOpen, setHistoryOpen] = useState(false);
  const {
    data: history,
    error: historyError,
    mutate: refreshHistory,
  } = useSWR<{ searches: SearchHistoryEntry[] }>(
    historyOpen && user ? ['/api/v1/ai-search/history', user.id] : null,
    async ([url]: [string, number]) => (await axios.get(url)).data
  );
  const restoredFor = useRef<number | undefined>(undefined);
  const {
    data: peopleData,
    error: peopleError,
    mutate: retryPeople,
  } = useSWR<{
    users: { id: number; name: string; avatar?: string }[];
    selfId: number;
  }>('/api/v1/ai-search/people');
  const [people, setPeople] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const queryInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const input = queryInput.current;
    if (!input) return;
    const resize = () => {
      const mirror = input.cloneNode() as HTMLTextAreaElement;
      mirror.value = input.value || input.placeholder;
      Object.assign(mirror.style, {
        position: 'absolute',
        visibility: 'hidden',
        pointerEvents: 'none',
        left: '-9999px',
        height: '0px',
        minHeight: '0px',
        maxHeight: 'none',
        width: `${input.getBoundingClientRect().width}px`,
      });
      mirror.removeAttribute('id');
      mirror.setAttribute('aria-hidden', 'true');
      mirror.tabIndex = -1;
      document.body.appendChild(mirror);
      const height = Math.max(128, Math.min(320, mirror.scrollHeight + 2));
      mirror.remove();
      input.style.height = `${height}px`;
    };
    resize();
    let width = input.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = input.getBoundingClientRect().width;
      if (next !== width) {
        width = next;
        resize();
      }
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [query, historyOpen]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('Finding titles…');
  const [error, setError] = useState('');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [submitted, setSubmitted] = useState('');
  useEffect(() => {
    if (!router.isReady || !user || restoredFor.current === user.id) return;
    restoredFor.current = user.id;
    entry.current = searchEntry(window.history);
    const saved = readSearchScreen<{
      query: string;
      people: number[];
      response: SearchResponse | null;
      submitted: string;
    }>(user.id, entry.current);
    setQuery(saved?.query ?? '');
    setPeople(saved?.people ?? []);
    setResponse(saved?.response ?? null);
    setSubmitted(saved?.submitted ?? '');
  }, [user, router.isReady]);
  useEffect(() => {
    if (!user || restoredFor.current !== user.id || !entry.current) return;
    // Capture the departing entry, never the destination's history state.
    const currentEntry = entry.current;
    return () => {
      saveSearchScreen(user.id, currentEntry, {
        query,
        people,
        response,
        submitted,
      });
    };
  }, [user, query, people, response, submitted]);
  async function search(
    searchQuery = query,
    selectedPeople = people,
    filters?: AiFilters
  ) {
    if (busy || !searchQuery.trim()) return;
    setBusy(true);
    setProgress('Checking your catalogue…');
    setError('');
    try {
      const data = await searchStream<SearchResponse>(
        {
          query: searchQuery.trim(),
          people: selectedPeople,
          filters,
          stream: true,
        },
        setProgress
      );
      setResponse(data);
      if (data.people && peopleData)
        setPeople(
          data.people.filter((p) => p.id !== peopleData.selfId).map((p) => p.id)
        );
      setSubmitted(searchQuery.trim());
      void refreshHistory();
    } catch (e) {
      setError(
        axios.isAxiosError(e)
          ? e.response?.data?.message || 'Search failed. Please try again.'
          : e instanceof Error
            ? e.message
            : 'Search failed. Please try again.'
      );
    } finally {
      setBusy(false);
    }
  }
  const f = response?.filters;
  return (
    <div className="text-gray-100">
      <PageTitle title="AI Search" />
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-purple-300">AI Search</h1>
        <button
          type="button"
          aria-expanded={historyOpen}
          aria-controls="ai-search-history"
          onClick={() => setHistoryOpen(!historyOpen)}
          className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-sm text-purple-300 ${historyOpen ? 'border-purple-400/50 bg-gray-800' : 'border-transparent hover:bg-gray-800'}`}
        >
          History <ClockIcon className="h-5 w-5" />
        </button>
      </div>
      {historyOpen && (
        <section
          id="ai-search-history"
          aria-label="Search history"
          className="relative mb-4 rounded-2xl border border-purple-400/50 bg-gray-800 p-4 before:absolute before:-top-2 before:right-8 before:h-3 before:w-3 before:rotate-45 before:border-l before:border-t before:border-purple-400/50 before:bg-gray-800"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-semibold text-gray-100">
              Search history · Last 7 days
            </h2>
            <button
              type="button"
              onClick={() => setHistoryOpen(false)}
              className="text-sm text-purple-300"
            >
              Close
            </button>
          </div>
          <p className="mb-3 text-sm text-gray-400">
            Only you can see these searches. Reopening rechecks current
            availability and watched status.
          </p>
          {historyError ? (
            <button
              type="button"
              onClick={() => void refreshHistory()}
              className="text-purple-300"
            >
              Couldn’t load history. Retry
            </button>
          ) : !history ? (
            <p role="status">Loading searches…</p>
          ) : !history.searches.length ? (
            <p className="text-gray-400">Your searches will appear here.</p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {history.searches.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    disabled={busy}
                    className="w-full min-w-0 rounded-xl bg-gray-900 p-3 text-left text-gray-100 hover:bg-gray-700 disabled:opacity-50"
                    onClick={() => {
                      setQuery(entry.query);
                      setPeople(entry.people);
                      setHistoryOpen(false);
                      void search(entry.query, entry.people, entry.filters);
                    }}
                  >
                    <span className="block whitespace-normal break-words">
                      {entry.query}
                    </span>
                    {entry.filters && (
                      <span className="mt-1 block whitespace-normal break-words text-xs text-purple-200">
                        {[
                          entry.filters.available ? 'Available' : null,
                          entry.filters.unwatched ? 'Unwatched' : null,
                          entry.filters.maxRuntime
                            ? `≤ ${entry.filters.maxRuntime} min`
                            : null,
                          entry.filters.yearFrom || entry.filters.yearTo
                            ? `${entry.filters.yearFrom ?? 'Any year'}–${entry.filters.yearTo ?? 'now'}`
                            : null,
                          entry.filters.minLetterboxdRating != null ||
                          entry.filters.maxLetterboxdRating != null
                            ? letterboxdFilterLabel(entry.filters)
                            : null,
                          entry.filters.genres.length
                            ? `${entry.filters.genres.length} genres`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'Custom filters'}
                      </span>
                    )}
                    <span className="mt-1 block whitespace-normal text-xs text-gray-400">
                      {new Date(entry.searchedAt).toLocaleString()}
                      {entry.people.length
                        ? ` · You + ${entry.people.length}`
                        : ' · Just you'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {!historyOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
          className="mb-6 rounded-2xl border border-gray-700 bg-gray-800 p-4"
        >
          <Popover className="relative mb-2 flex items-center justify-between gap-2">
            <label htmlFor="ai-query" className="min-w-0 font-semibold">
              What are you in the mood for?
            </label>
            <Popover.Button
              type="button"
              disabled={busy}
              aria-label={`Watching with: you${people.length ? ` and ${people.length} others` : ''}`}
              title="Choose who’s watching"
              className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-purple-300 focus-visible:ring-2 focus-visible:ring-purple-400 disabled:opacity-50 ${people.length ? 'bg-purple-900/40' : 'hover:bg-gray-700'}`}
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
            <Popover.Panel
              focus
              className="absolute right-0 top-full z-40 mt-2 w-80 max-w-full rounded-2xl border border-gray-600 bg-gray-800 p-3 shadow-xl"
            >
              {({ close }) => (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-semibold text-gray-100">
                      Who’s watching?
                    </h2>
                    <button
                      type="button"
                      onClick={() => close()}
                      className="rounded-full px-3 py-2 text-sm text-purple-300"
                    >
                      Done
                    </button>
                  </div>
                  <p className="my-2 text-xs text-gray-400">
                    You’re included. Choose up to five others to exclude
                    anything any of you has watched.
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
                              disabled={
                                busy ||
                                (people.length >= 5 && !people.includes(u.id))
                              }
                              onChange={(e) =>
                                setPeople(
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
          <textarea
            id="ai-query"
            ref={queryInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={1000}
            rows={4}
            className="min-h-32 w-full resize-none rounded-xl border border-gray-600 bg-gray-900 p-3 text-white"
            placeholder={searchPlaceholder}
          />

          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-sm text-gray-400">
              AI makes mistakes. Edit to refine results
            </span>
            <button
              type="submit"
              disabled={busy || !query.trim()}
              className="rounded-full bg-purple-600 px-6 py-2 font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Searching…' : 'Search'}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p
          role="alert"
          className="mb-5 rounded-xl border border-red-600 p-3 text-red-300"
        >
          {error}
        </p>
      )}
      {busy && (
        <p
          role="status"
          className="mb-5 flex items-center gap-2 text-purple-300"
        >
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-purple-300 border-t-transparent"
          />
          {progress}
        </p>
      )}
      {!historyOpen && response && f && (
        <section aria-label="Search results" aria-busy={busy}>
          <p className="mb-3 break-words text-gray-300">
            Results for “{submitted}”
          </p>
          <FilterChips
            key={JSON.stringify([submitted, f])}
            filters={f}
            busy={busy}
            group={people.length > 0}
            onApply={(filters) => void search(submitted, people, filters)}
          />
          {response.ratingCoverage && response.ratingCoverage.unknown > 0 && (
            <p className="mb-4 text-sm text-amber-200">
              {response.ratingCoverage.unknown} titles had no verified
              Letterboxd score in time and were excluded. Results cover this
              shortlist, not every matching title.
            </p>
          )}
          {response.note && (
            <p className="mb-4 text-amber-200">{response.note}</p>
          )}
          {!response.results.length && (
            <p className="py-8 text-gray-300">
              No verified matches in this shortlist. Try a broader description.
            </p>
          )}
          <ul className="cards-vertical">
            {response.results.map(
              ({ media: m, reason, runtime, letterboxdRating }) => (
                <li key={`${m.mediaType}:${m.id}`} className="min-w-0">
                  <TitleCard
                    posterBadge={
                      letterboxdRating !== undefined
                        ? `★ ${letterboxdRating.toFixed(2)}${f.maxRuntime !== null && runtime ? ` · ${runtime} min` : ''}`
                        : f.maxRuntime !== null && runtime
                          ? `${runtime} min`
                          : undefined
                    }
                    id={m.id}
                    image={m.posterPath}
                    status={m.mediaInfo?.status}
                    summary={m.overview}
                    title={m.mediaType === 'movie' ? m.title : m.name}
                    userScore={m.voteAverage}
                    year={
                      m.mediaType === 'movie' ? m.releaseDate : m.firstAirDate
                    }
                    mediaType={m.mediaType}
                    canExpand
                  />
                  {reason && (
                    <p className="mt-2 break-words text-sm text-gray-300">
                      {reason}
                    </p>
                  )}
                </li>
              )
            )}
          </ul>
        </section>
      )}
    </div>
  );
}
