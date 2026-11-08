import FilterChips from '@app/components/AiSearch/FilterChips';
import PeoplePicker from '@app/components/AiSearch/PeoplePicker';
import SortControl from '@app/components/AiSearch/SortControl';
import PageTitle from '@app/components/Common/PageTitle';
import TitleCard from '@app/components/TitleCard';
import { useUser } from '@app/hooks/useUser';
import { LightBulbIcon } from '@heroicons/react/24/outline';
import type { AiFilters } from '@server/lib/aiSearchPlan';
import type { AiSort } from '@server/lib/aiSearchSort';
import type { LibraryRow } from '@server/lib/libraryBrowse';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { useInView } from 'react-intersection-observer';
type Page = {
  id: string;
  ready: boolean;
  message: string;
  results?: LibraryRow[];
  total?: number;
  next?: number | null;
  unknown?: number;
};
const initial: AiFilters = {
  type: 'movie',
  available: true,
  unwatched: true,
  maxRuntime: null,
  yearFrom: null,
  yearTo: null,
  genres: [],
};
export default function FindToWatch() {
  const { user } = useUser();
  const userId = user?.id;
  const { ref: loadMoreRef, inView } = useInView({ rootMargin: '200px' });
  const [filters, setFilters] = useState(initial),
    [people, setPeople] = useState<number[]>([]),
    [sort, setSort] = useState<AiSort>([]),
    [page, setPage] = useState(0),
    [data, setData] = useState<Page | null>(null),
    [busy, setBusy] = useState(true),
    [status, setStatus] = useState('Checking available titles…'),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setBusy(true);
    setError('');
    setStatus(page ? 'Loading more titles…' : 'Updating filters…');
    const run = async () => {
      try {
        let result = (
          await axios.post<Page>(
            '/api/v1/find-to-watch',
            { filters, people, sort, page },
            { signal: controller.signal }
          )
        ).data;
        while (!result.ready) {
          if (controller.signal.aborted) return;
          setStatus(result.message);
          await new Promise<void>((resolve) => {
            const finish = () => {
              clearTimeout(timer);
              controller.signal.removeEventListener('abort', finish);
              resolve();
            };
            timer = setTimeout(finish, 1500);
            controller.signal.addEventListener('abort', finish, { once: true });
          });
          if (controller.signal.aborted) return;
          result = (
            await axios.get<Page>(`/api/v1/find-to-watch/${result.id}`, {
              params: { page },
              signal: controller.signal,
            })
          ).data;
        }
        if (!controller.signal.aborted)
          setData((previous) =>
            page === 0
              ? result
              : {
                  ...result,
                  results: [
                    ...new Map(
                      [
                        ...(previous?.results ?? []),
                        ...(result.results ?? []),
                      ].map((row) => [
                        `${row.media.mediaType}:${row.media.id}`,
                        row,
                      ])
                    ).values(),
                  ],
                }
          );
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            axios.isAxiosError(e)
              ? e.response?.data?.message || 'Could not load available titles.'
              : 'Could not load available titles.'
          );
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    };
    timer = setTimeout(() => void run(), 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [userId, filters, people, sort, page, retry]);
  useEffect(() => {
    if (inView && !busy && !error && data?.next != null) setPage(data.next);
  }, [inView, busy, error, data?.next]);
  const apply = (f: AiFilters) => {
    setData(null);
    setPage(0);
    setFilters({ ...f, available: true });
  };
  return (
    <div className="text-gray-100">
      <PageTitle title="Find something to watch" />
      <div className="my-5">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-purple-300">
          <LightBulbIcon className="h-7 w-7 shrink-0" />
          Find something to watch
        </h1>
        <p className="mt-1 text-sm text-gray-400">Available in Multimeldia</p>
      </div>
      <PeoplePicker
        people={people}
        onChange={(next) => {
          setPeople(next);
          apply({ ...filters, unwatched: true });
        }}
      >
        <div className="flex gap-2" aria-label="Title type">
          {(['movie', 'tv'] as const).map((type) => (
            <button
              type="button"
              key={type}
              aria-pressed={filters.type === type}
              onClick={() => apply({ ...filters, type, genres: [] })}
              className={`rounded-full border px-4 py-2 text-sm ${filters.type === type ? 'border-purple-400 bg-purple-900/30 text-purple-200' : 'border-gray-600 text-gray-300'}`}
            >
              {type === 'movie' ? 'Movies' : 'Series'}
            </button>
          ))}
        </div>
      </PeoplePicker>
      <FilterChips
        key={JSON.stringify(filters)}
        filters={filters}
        availableOnly
        group={people.length > 0}
        busy={false}
        onApply={apply}
        sortControl={
          <SortControl
            value={sort}
            suggested={[]}
            busy={false}
            onApply={(next) => {
              setData(null);
              setPage(0);
              setSort(next);
            }}
          />
        }
      />
      {busy && page === 0 && (
        <div
          role="status"
          className="my-4 flex items-center gap-2 text-sm text-purple-200"
        >
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-purple-300 border-t-transparent" />
          {status}
        </div>
      )}
      {error && (
        <div role="alert" className="my-4 text-amber-200">
          {error}{' '}
          <button className="underline" onClick={() => setRetry((v) => v + 1)}>
            Retry
          </button>
        </div>
      )}
      {data && (
        <>
          <p className="mb-3 text-sm text-gray-400">
            {data.total} matching{' '}
            {filters.type === 'movie' ? 'movies' : 'series'}
            {(data.unknown ?? 0) > 0
              ? ` · ${data.unknown} metadata checks unavailable; retry to check again.`
              : ''}
          </p>
          {!data.results?.length && data.next == null && (
            <p className="py-6 text-gray-300">
              No matches found. Try fewer filters.
            </p>
          )}
          <ul className="cards-vertical">
            {data.results?.map(({ media: m, runtime, letterboxdRating }) => (
              <li key={`${m.mediaType}:${m.id}`} className="min-w-0">
                <TitleCard
                  id={m.id}
                  mediaType={m.mediaType}
                  title={m.mediaType === 'movie' ? m.title : m.name}
                  year={
                    m.mediaType === 'movie' ? m.releaseDate : m.firstAirDate
                  }
                  image={m.posterPath}
                  summary={m.overview}
                  userScore={m.voteAverage}
                  canExpand
                  posterBadge={
                    letterboxdRating != null
                      ? `★ ${letterboxdRating.toFixed(2)}${runtime && (filters.maxRuntime != null || sort.some((s) => s.field === 'runtime')) ? ` · ${runtime} min` : ''}`
                      : runtime &&
                          (filters.maxRuntime != null ||
                            sort.some((s) => s.field === 'runtime'))
                        ? `${runtime} min`
                        : undefined
                  }
                />
              </li>
            ))}
          </ul>
          {busy && page > 0 && (
            <div
              role="status"
              className="my-4 flex items-center gap-2 text-sm text-purple-200"
            >
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-purple-300 border-t-transparent" />
              {status}
            </div>
          )}
          {data.next != null && (
            <div ref={loadMoreRef} className="h-8" aria-hidden="true" />
          )}
        </>
      )}
    </div>
  );
}
