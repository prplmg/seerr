import { usePartyText } from '@app/components/WatchParty/messages';
import emojis from '@server/lib/data/emoji-picker.json';
import { useMemo, useState } from 'react';
export default function EmojiPicker({
  onSelect,
}: {
  onSelect: (emoji: string) => void;
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
    <div className="mt-3 w-full min-w-0 rounded-xl border border-gray-600 bg-gray-900 p-3">
      <input
        aria-label={t('Search emoji', 'Buscar emoji')}
        placeholder={t('Search emoji…', 'Buscar emoji…')}
        className="w-full min-w-0 rounded-lg border border-gray-600 bg-gray-800 p-2 text-base"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setLimit(120);
        }}
      />
      <select
        aria-label={t('Emoji category', 'Categoría de emoji')}
        className="my-2 w-full min-w-0 rounded-lg border border-gray-600 bg-gray-800 p-2 text-sm"
        value={group}
        onChange={(e) => {
          setGroup(e.target.value);
          setSearch('');
          setLimit(120);
        }}
      >
        {groups.map((g) => (
          <option key={g}>{g}</option>
        ))}
      </select>
      <div className="max-h-56 overflow-y-auto overscroll-contain">
        <div className="grid grid-cols-6 gap-1 sm:grid-cols-8">
          {matches.slice(0, limit).map((e) => (
            <button
              type="button"
              key={e.emoji}
              title={e.name}
              aria-label={e.name}
              className="flex h-11 min-w-0 items-center justify-center rounded-lg text-2xl hover:bg-gray-700 focus-visible:ring-2 focus-visible:ring-purple-400"
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
