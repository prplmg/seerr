import { PencilIcon } from '@heroicons/react/24/outline';
import {
  movieGenres,
  tvGenres,
  type AiFilters,
} from '@server/lib/aiSearchPlan';
import { useState } from 'react';
const genreNames: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Sci-fi',
  10770: 'TV movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
  10759: 'Action & adventure',
  10762: 'Kids',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-fi & fantasy',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War & politics',
};
export default function FilterChips({
  filters,
  group,
  busy,
  onApply,
}: {
  filters: AiFilters;
  group: boolean;
  busy: boolean;
  onApply: (filters: AiFilters) => void;
}) {
  const [editing, setEditing] = useState(0);
  const [draft, setDraft] = useState<AiFilters | null>(null);
  const labels = [
    filters.available ? 'Available' : 'Any availability',
    filters.unwatched
      ? group
        ? 'Unwatched by everyone'
        : 'Unwatched'
      : 'Include watched',
    filters.maxRuntime
      ? `Up to ${filters.maxRuntime} min${filters.type === 'tv' ? ' / episode' : ''}`
      : 'Any length',
    filters.yearFrom || filters.yearTo
      ? `${filters.yearFrom ?? 'Any year'}–${filters.yearTo ?? 'now'}`
      : 'Any release year',
    filters.genres.length
      ? filters.genres.map((g) => genreNames[g]).join(' + ')
      : 'Any genre',
    filters.minLetterboxdRating != null
      ? `LB ≥ ${filters.minLetterboxdRating} ★`
      : 'Any LB rating',
  ];
  return (
    <div className="mb-4">
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="rounded-full bg-gray-800 px-3 py-1.5 text-gray-400">
          {filters.type === 'movie' ? 'Movies' : 'Series'}
        </span>
        {labels.map((label, index) => (
          <button
            type="button"
            disabled={busy}
            key={label}
            onClick={() => {
              setEditing(index);
              setDraft({ ...filters, genres: [...filters.genres] });
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-600 bg-gray-800 px-3 py-1.5 text-purple-200 hover:border-purple-400 disabled:opacity-50"
            aria-label={`Edit ${label}`}
          >
            <span>{label}</span>
            <PencilIcon className="h-3 w-3 shrink-0" />
          </button>
        ))}
      </div>
      {draft && (
        <form
          aria-label="Edit search filters"
          className="mt-3 space-y-3 rounded-xl border border-gray-600 bg-gray-800 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            onApply(draft);
            setDraft(null);
          }}
        >
          <h3 className="font-semibold">
            {
              [
                'Availability',
                'Watched status',
                'Runtime',
                'Release years',
                'Genres',
                'Letterboxd rating',
              ][editing]
            }
          </h3>
          <p className="text-sm text-gray-400">
            Refines this shortlist without asking AI again.
          </p>
          {editing === 0 && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.available}
                onChange={(e) =>
                  setDraft({ ...draft, available: e.target.checked })
                }
              />{' '}
              Available only
            </label>
          )}
          {editing === 1 && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.unwatched || group}
                disabled={group}
                onChange={(e) =>
                  setDraft({ ...draft, unwatched: e.target.checked })
                }
              />{' '}
              Unwatched{group ? ' by everyone selected' : ''}
            </label>
          )}
          {editing === 1 && group && (
            <p className="text-xs text-gray-400">
              Remove other viewers in “Watching with” to include watched titles.
            </p>
          )}
          {editing === 2 && (
            <label className="block text-sm">
              Maximum {draft.type === 'tv' ? 'episode ' : ''}runtime (minutes)
              <input
                className="mt-1 block w-full rounded-lg border border-gray-600 bg-gray-900 p-2"
                type="number"
                min="1"
                max="600"
                placeholder="Any length"
                value={draft.maxRuntime ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    maxRuntime: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </label>
          )}
          {editing === 3 && (
            <div className="grid grid-cols-2 gap-3">
              {(['yearFrom', 'yearTo'] as const).map((key) => (
                <label key={key} className="min-w-0 text-sm">
                  {key === 'yearFrom' ? 'Released from' : 'Released through'}
                  <input
                    className="mt-1 block w-full min-w-0 rounded-lg border border-gray-600 bg-gray-900 p-2"
                    type="number"
                    min={key === 'yearTo' ? (draft.yearFrom ?? 1870) : 1870}
                    max="2100"
                    placeholder="Any year"
                    value={draft[key] ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        [key]: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  />
                </label>
              ))}
            </div>
          )}
          {editing === 4 && (
            <fieldset>
              <legend className="mb-2 text-sm">
                Genres · match all selected (up to 3)
              </legend>
              <div className="flex flex-wrap gap-2">
                {(draft.type === 'movie' ? movieGenres : tvGenres).map((g) => (
                  <button
                    type="button"
                    key={g}
                    aria-pressed={draft.genres.includes(g)}
                    disabled={
                      !draft.genres.includes(g) && draft.genres.length >= 3
                    }
                    className={`rounded-full border px-2.5 py-1 text-xs disabled:opacity-40 ${draft.genres.includes(g) ? 'border-purple-400 bg-purple-900 text-purple-100' : 'border-gray-600 text-gray-300'}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        genres: draft.genres.includes(g)
                          ? draft.genres.filter((id) => id !== g)
                          : [...draft.genres, g],
                      })
                    }
                  >
                    {genreNames[g]}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {editing === 5 && (
            <label className="block text-sm">
              Minimum Letterboxd score (out of 5)
              <input
                type="number"
                min="0"
                max="5"
                step="0.01"
                placeholder="Any rating"
                value={draft.minLetterboxdRating ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    minLetterboxdRating: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
                className="mt-1 block w-full rounded-lg border border-gray-600 bg-gray-900 p-2"
              />
              <span className="mt-2 block text-xs text-gray-400">
                Missing scores are checked before showing matches. Titles
                without a verified score are excluded.
              </span>
            </label>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              className="px-3 py-2 text-gray-300"
              onClick={() => setDraft(null)}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-purple-600 px-4 py-2 font-semibold"
            >
              Apply filters
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
