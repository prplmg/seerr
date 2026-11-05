import { usePartyText } from '@app/components/WatchParty/messages';
import {
  ArrowLeftIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import emojis from '@server/lib/data/emoji-picker.json';
import { useMemo, useState } from 'react';
export default function EmojiPicker({
  onSelect,
  onBack,
  onClose,
  selected = [],
}: {
  onSelect: (emoji: string) => void;
  onBack: () => void;
  onClose: () => void;
  selected?: string[];
}) {
  const t = usePartyText(),
    [search, setSearch] = useState(''),
    [group, setGroup] = useState(emojis[0].group),
    [limit, setLimit] = useState(120);
  const groups = useMemo(() => [...new Set(emojis.map((e) => e.group))], []);
  const matches = useMemo(
    () =>
      emojis.filter((e) =>
        search
          ? `${e.name} ${e.emoji}`
              .toLocaleLowerCase()
              .includes(search.toLocaleLowerCase())
          : e.group === group
      ),
    [search, group]
  );
  return (
    <div className="w-[21rem] min-w-0 max-w-full overflow-hidden rounded-2xl border border-gray-600/70 bg-gray-800 p-3 shadow-2xl ring-1 ring-black/20">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          aria-label={t('Quick reactions', 'Reacciones rápidas')}
          onClick={onBack}
          className="rounded-full p-2 text-gray-400 hover:bg-gray-700 hover:text-white"
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </button>
        <span className="flex-1 text-sm font-semibold">
          {t('Emoji', 'Emojis')}
        </span>
        <button
          type="button"
          aria-label={t('Close emoji picker', 'Cerrar emojis')}
          onClick={onClose}
          className="rounded-full p-2 text-gray-400 hover:bg-gray-700 hover:text-white"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="relative">
        <MagnifyingGlassIcon
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-400"
        />
        <input
          aria-label={t('Search emoji', 'Buscar emoji')}
          placeholder={t('Search emoji…', 'Buscar emoji…')}
          className="w-full min-w-0 rounded-xl border border-gray-700 bg-gray-900/70 py-2 pl-9 pr-3 text-base focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-400"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setLimit(120);
          }}
        />
      </div>
      <div
        role="group"
        aria-label={t('Emoji category', 'Categoría de emoji')}
        className="my-2 flex overflow-x-auto border-b border-gray-700 pb-2 [scrollbar-width:none]"
      >
        {groups.map((g) => (
          <button
            type="button"
            key={g}
            title={g}
            aria-label={g}
            aria-pressed={!search && group === g}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg hover:bg-gray-700 aria-pressed:bg-purple-900/60 aria-pressed:ring-1 aria-pressed:ring-purple-400"
            onClick={() => {
              setGroup(g);
              setSearch('');
              setLimit(120);
            }}
          >
            {emojis.find((e) => e.group === g)?.emoji}
          </button>
        ))}
      </div>
      <p className="mb-2 text-xs font-medium text-gray-400">
        {search ? t('Search results', 'Resultados') : group}
      </p>
      <div className="h-56 max-h-[35dvh] overflow-y-auto overscroll-contain">
        <div className="grid grid-cols-7 gap-0.5">
          {matches.slice(0, limit).map((e) => (
            <button
              type="button"
              key={e.emoji}
              title={e.name}
              aria-pressed={selected.includes(e.emoji)}
              aria-label={e.name}
              className="flex h-10 min-w-0 items-center justify-center rounded-xl text-2xl transition-transform hover:scale-110 hover:bg-gray-700 focus-visible:ring-2 focus-visible:ring-purple-400 aria-pressed:bg-purple-900/60"
              onClick={() => onSelect(e.emoji)}
            >
              {e.emoji}
            </button>
          ))}
        </div>
        {!matches.length && (
          <p className="p-3 text-sm text-gray-400">
            {t('No matching emoji.', 'No hay emojis coincidentes.')}
          </p>
        )}
        {matches.length > limit && (
          <button
            type="button"
            className="mt-2 w-full rounded-lg py-2 text-purple-300"
            onClick={() => setLimit((n) => n + 120)}
          >
            {t('Show more emoji', 'Mostrar más emojis')}
          </button>
        )}
      </div>
    </div>
  );
}
