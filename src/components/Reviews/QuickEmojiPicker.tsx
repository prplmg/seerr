import { usePartyText } from '@app/components/WatchParty/messages';
import { PlusIcon } from '@heroicons/react/24/outline';
import { lazy, Suspense, useState } from 'react';

const FullPicker = lazy(() => import('./EmojiPicker'));
const favorites = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export default function QuickEmojiPicker({
  onSelect,
  selected = [],
}: {
  onSelect: (emoji: string) => void;
  selected?: string[];
}) {
  const t = usePartyText();
  const [expanded, setExpanded] = useState(false);
  if (expanded)
    return (
      <Suspense
        fallback={
          <span role="status">{t('Loading emoji…', 'Cargando emojis…')}</span>
        }
      >
        <FullPicker onSelect={onSelect} />
      </Suspense>
    );
  return (
    <div
      role="group"
      aria-label={t('Quick reactions', 'Reacciones rápidas')}
      className="mt-2 flex w-fit max-w-full items-center rounded-full border border-gray-600 bg-gray-900 p-1 shadow-lg"
    >
      {favorites.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-pressed={selected.includes(emoji)}
          className="flex h-10 w-10 min-w-0 items-center justify-center rounded-full text-xl hover:bg-gray-700 focus-visible:ring-2 focus-visible:ring-purple-400 aria-pressed:bg-purple-900"
          onClick={() => onSelect(emoji)}
        >
          {emoji}
        </button>
      ))}
      <button
        type="button"
        aria-label={t('More emoji', 'Más emojis')}
        className="flex h-10 w-10 min-w-0 items-center justify-center rounded-full text-gray-200 hover:bg-gray-700 focus-visible:ring-2 focus-visible:ring-purple-400"
        onClick={() => setExpanded(true)}
      >
        <PlusIcon className="h-5 w-5" />
      </button>
    </div>
  );
}
