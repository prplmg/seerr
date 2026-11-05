import { usePartyText } from '@app/components/WatchParty/messages';
import { PlusIcon } from '@heroicons/react/24/outline';
import { quickReactions } from '@server/constants/quickReactions';
import axios from 'axios';
import { lazy, Suspense, useState } from 'react';
import useSWR from 'swr';

const FullPicker = lazy(() => import('./EmojiPicker'));

export default function QuickEmojiPicker({
  viewerId,
  onSelect,
  selected = [],
}: {
  viewerId?: number;
  onSelect: (emoji: string) => void;
  selected?: string[];
}) {
  const t = usePartyText();
  const { data: recent } = useSWR<string[]>(
    viewerId ? ['/api/v1/review-interactions/recent-emoji', viewerId] : null,
    async ([url]: [string, number]) => (await axios.get(url)).data,
    { dedupingInterval: 0 }
  );
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
      className="mt-2 flex w-fit max-w-[min(100%,18.25rem)] items-center rounded-full border border-gray-600 bg-gray-900 p-1 shadow-lg"
    >
      <div className="flex min-w-0 items-center overflow-x-auto overscroll-x-contain">
        {[...quickReactions, ...(recent || [])].map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-pressed={selected.includes(emoji)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl hover:bg-gray-700 focus-visible:ring-2 focus-visible:ring-purple-400 aria-pressed:bg-purple-900"
            onClick={() => onSelect(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-label={t('More emoji', 'Más emojis')}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-200 hover:bg-gray-700 focus-visible:ring-2 focus-visible:ring-purple-400"
        onClick={() => setExpanded(true)}
      >
        <PlusIcon className="h-5 w-5" />
      </button>
    </div>
  );
}
