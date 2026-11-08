import CachedImage from '@app/components/Common/CachedImage';
import PageTitle from '@app/components/Common/PageTitle';
import TitleCard from '@app/components/TitleCard';
import { useUser } from '@app/hooks/useUser';
import { ClockIcon } from '@heroicons/react/24/outline';
import type { SearchHistoryEntry } from '@server/lib/aiSearchHistory';
import type { AiFilters } from '@server/lib/aiSearchPlan';
import type { MovieResult, TvResult } from '@server/models/Search';
import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

interface SearchResponse {
  results: {
    media: MovieResult | TvResult;
    reason: string;
    runtime?: number | null;
  }[];
  filters: AiFilters;
  note: string;
  people?: { id: number; name: string }[];
}
export default function AiSearchPage() {
  const { user } = useUser();
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [submitted, setSubmitted] = useState('');
  useEffect(() => {
    if (!user || restoredFor.current === user.id) return;
    restoredFor.current = user.id;
    setQuery('');
    setPeople([]);
    setResponse(null);
    setSubmitted('');
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(`ai-search:${user.id}`) || 'null'
      );
      if (saved && saved.at > Date.now() - 7 * 86400000) {
        setQuery(saved.query);
        setPeople(saved.people);
        setResponse(saved.response);
        setSubmitted(saved.submitted);
      }
    } catch {
      /* Storage may be disabled. Search still works. */
    }
  }, [user]);
  useEffect(() => {
    if (!user || restoredFor.current !== user.id) return;
    // Cleanup captures the latest screen when leaving, including edited drafts.
    const save = () => {
      try {
        sessionStorage.setItem(
          `ai-search:${user.id}`,
          JSON.stringify({ query, people, response, submitted, at: Date.now() })
        );
      } catch {
        /* Storage is an optional navigation convenience. */
      }
    };
    window.addEventListener('pagehide', save);
    return () => {
      save();
      window.removeEventListener('pagehide', save);
    };
  }, [user, query, people, response, submitted]);
  async function search(searchQuery = query, selectedPeople = people) {
    if (busy || !searchQuery.trim()) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await axios.post<SearchResponse>('/api/v1/ai-search', {
        query: searchQuery.trim(),
        people: selectedPeople,
      });
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
          : 'Search failed. Please try again.'
      );
    } finally {
      setBusy(false);
    }
  }
  const f = response?.filters;
  return (
    <>
      <PageTitle title="AI Search" />
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-purple-300">AI Search</h1>
        <button
          type="button"
          aria-expanded={historyOpen}
          aria-controls="ai-search-history"
          onClick={() => setHistoryOpen(!historyOpen)}
          className="flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm text-purple-300 hover:bg-gray-800"
        >
          History <ClockIcon className="h-5 w-5" />
        </button>
      </div>
      {historyOpen && (
        <section
          id="ai-search-history"
          aria-label="Search history"
          className="mb-4 rounded-2xl border border-gray-700 bg-gray-800 p-4"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-semibold">Last 7 days</h2>
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
                    className="w-full rounded-xl bg-gray-900 p-3 text-left hover:bg-gray-700 disabled:opacity-50"
                    onClick={() => {
                      setQuery(entry.query);
                      setPeople(entry.people);
                      setHistoryOpen(false);
                      void search(entry.query, entry.people);
                    }}
                  >
                    <span className="block break-words">{entry.query}</span>
                    <span className="mt-1 block text-xs text-gray-400">
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
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
        className="mb-6 rounded-2xl border border-gray-700 bg-gray-800 p-4"
      >
        <label htmlFor="ai-query" className="mb-2 block font-semibold">
          What are you in the mood for?
        </label>
        <textarea
          id="ai-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={1000}
          rows={3}
          className="w-full rounded-xl border border-gray-600 bg-gray-900 p-3 text-white"
          placeholder="A horror movie like The Witch, from the 2010s, under two hours, available and unwatched by prplmg and I…"
        />
        <details className="mt-3 rounded-lg border border-gray-700 px-3 py-2">
          <summary className="cursor-pointer text-sm text-purple-300">
            Watching with · {people.length ? `You + ${people.length}` : 'You'}
          </summary>
          <p className="my-2 text-xs text-gray-400">
            You’re included. Choose up to five others to exclude anything any of
            you has watched.
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
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {peopleData.users
                .filter((u) => u.id !== peopleData.selfId)
                .map((u) => (
                  <label
                    key={u.id}
                    className="flex min-w-0 items-center gap-2 rounded-lg bg-gray-900 p-2"
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
                        busy || (people.length >= 5 && !people.includes(u.id))
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
        </details>
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
      {error && (
        <p
          role="alert"
          className="mb-5 rounded-xl border border-red-600 p-3 text-red-300"
        >
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="mb-5 text-purple-300">
          Finding titles and checking catalogue matches…
        </p>
      )}
      {response && f && (
        <section aria-label="Search results" aria-busy={busy}>
          <p className="mb-3 break-words text-gray-300">
            Results for “{submitted}”
          </p>
          <div className="mb-4 flex flex-wrap gap-2 text-sm">
            {[
              f.type === 'movie' ? 'Movies' : 'Series',
              f.available ? 'Available' : null,
              f.unwatched
                ? `Unwatched${response.people?.length ? ' by ' + response.people.map((p) => p.name).join(', ') : ''}`
                : null,
              f.maxRuntime
                ? `Up to ${f.maxRuntime} min${f.type === 'tv' ? ' / episode' : ''}`
                : null,
              f.yearFrom || f.yearTo
                ? `${f.yearFrom ?? 'Any year'}–${f.yearTo ?? 'now'}`
                : null,
            ]
              .filter(Boolean)
              .map((t) => (
                <span key={t} className="rounded-full bg-gray-700 px-3 py-1">
                  {t}
                </span>
              ))}
          </div>
          {response.note && (
            <p className="mb-4 text-amber-200">{response.note}</p>
          )}
          {!response.results.length && (
            <p className="py-8 text-gray-300">
              No verified matches in this shortlist. Try a broader description.
            </p>
          )}
          <ul className="cards-vertical">
            {response.results.map(({ media: m, reason, runtime }) => (
              <li key={`${m.mediaType}:${m.id}`} className="min-w-0">
                <TitleCard
                  posterBadge={
                    f.maxRuntime !== null && runtime
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
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
