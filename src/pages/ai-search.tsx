import PageTitle from '@app/components/Common/PageTitle';
import TitleCard from '@app/components/TitleCard';
import type { AiFilters } from '@server/lib/aiSearchPlan';
import type { MovieResult, TvResult } from '@server/models/Search';
import axios from 'axios';
import { useState } from 'react';

interface SearchResponse {
  results: { media: MovieResult | TvResult; reason: string }[];
  filters: AiFilters;
  note: string;
}
export default function AiSearchPage() {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [submitted, setSubmitted] = useState('');
  async function search() {
    if (busy || !query.trim()) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await axios.post<SearchResponse>('/api/v1/ai-search', {
        query: query.trim(),
      });
      setResponse(data);
      setSubmitted(query.trim());
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
      <h1 className="mb-3 text-3xl font-bold text-purple-300">AI Search</h1>
      <p className="mb-6 text-gray-300">
        Describe what you feel like watching.
      </p>
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
          placeholder="A clever sci-fi movie under two hours, available and unwatched…"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm text-gray-400">
            Only searches when you submit.
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
              f.unwatched ? 'Unwatched' : null,
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
          <p className="mb-5 text-sm text-gray-400">
            A shortlist, not an exhaustive search. Edit your description to
            refine it. AI suggestions can miss the mark.
          </p>
          {!response.results.length && (
            <p className="py-8 text-gray-300">
              No verified matches in this shortlist. Try a broader description.
            </p>
          )}
          <ul className="cards-vertical">
            {response.results.map(({ media: m, reason }) => (
              <li key={`${m.mediaType}:${m.id}`} className="min-w-0">
                <TitleCard
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
