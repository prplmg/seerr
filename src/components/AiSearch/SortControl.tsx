import { Popover } from '@headlessui/react';
import { ArrowsUpDownIcon } from '@heroicons/react/24/outline';
import {
  sortLabel,
  type AiSort,
  type SortField,
} from '@server/lib/aiSearchSort';
import { useState } from 'react';
const names = {
  rating: 'Letterboxd score',
  runtime: 'Runtime',
  year: 'Release year',
};
export default function SortControl({
  value,
  suggested,
  busy,
  onApply,
}: {
  value: AiSort;
  suggested: AiSort;
  busy: boolean;
  onApply: (value: AiSort) => void;
}) {
  const [draft, setDraft] = useState<AiSort>(value);
  const select =
    'mt-1 w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-gray-100';
  const field = (index: number, next: string) =>
    setDraft((old) => {
      if (!next) return old.slice(0, index);
      const row = {
        field: next as SortField,
        direction: next === 'runtime' ? ('asc' as const) : ('desc' as const),
      };
      return index === 0
        ? [row, ...old.slice(1).filter((s) => s.field !== next)]
        : [old[0], row];
    });
  return (
    <Popover className="relative ml-auto shrink-0">
      <Popover.Button
        disabled={busy}
        onClick={() => setDraft(value)}
        aria-label={`Sort: ${sortLabel(value)}`}
        className="inline-flex min-h-[36px] items-center gap-2 rounded-full px-3 py-1.5 text-sm text-purple-200 hover:bg-gray-700 disabled:opacity-50"
      >
        <ArrowsUpDownIcon className="h-4 w-4" />
        <span>{sortLabel(value)}</span>
      </Popover.Button>
      <Popover.Panel
        focus
        className="absolute right-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-gray-600 bg-gray-800 p-4 text-gray-100 shadow-xl"
      >
        {({ close }) => (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onApply(draft);
              close();
            }}
          >
            <h3 className="font-semibold text-gray-100">Sort results</h3>
            <p className="mt-1 text-xs text-gray-400">
              {JSON.stringify(value) === JSON.stringify(suggested)
                ? 'Suggested from your search'
                : 'Your selected order'}{' '}
              · This shortlist only
            </p>
            {[0, ...(draft.length ? [1] : [])].map((i) => (
              <div key={i} className="mt-4">
                <label className="block text-sm text-gray-300">
                  {i ? 'Then by' : 'Sort by'}
                  <select
                    aria-label={i ? 'Then by' : 'Sort by'}
                    className={select}
                    value={draft[i]?.field || ''}
                    onChange={(e) => field(i, e.target.value)}
                  >
                    <option value="">{i ? 'None' : 'Best match'}</option>
                    {Object.entries(names)
                      .filter(([key]) => !i || key !== draft[0]?.field)
                      .map(([key, name]) => (
                        <option key={key} value={key}>
                          {name}
                        </option>
                      ))}
                  </select>
                </label>
                {draft[i] && (
                  <label className="mt-2 block text-sm text-gray-300">
                    Direction
                    <select
                      aria-label={i ? 'Secondary direction' : 'Direction'}
                      className={select}
                      value={draft[i].direction}
                      onChange={(e) =>
                        setDraft(
                          draft.map((s, j) =>
                            j === i
                              ? {
                                  ...s,
                                  direction: e.target.value as 'asc' | 'desc',
                                }
                              : s
                          )
                        )
                      }
                    >
                      <option value="desc">
                        {draft[i].field === 'year'
                          ? 'Newest first'
                          : draft[i].field === 'runtime'
                            ? 'Longest first'
                            : 'Highest first'}
                      </option>
                      <option value="asc">
                        {draft[i].field === 'year'
                          ? 'Oldest first'
                          : draft[i].field === 'runtime'
                            ? 'Shortest first'
                            : 'Lowest first'}
                      </option>
                    </select>
                  </label>
                )}
              </div>
            ))}
            <p className="mt-3 text-xs text-gray-400">
              Missing values go last. Sorting doesn’t ask AI again.
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => close()}
                className="px-2 py-2 text-sm text-gray-300"
              >
                Cancel
              </button>
              <button className="rounded-full bg-purple-600 px-4 py-2 text-sm font-semibold text-white">
                Apply
              </button>
            </div>
          </form>
        )}
      </Popover.Panel>
    </Popover>
  );
}
