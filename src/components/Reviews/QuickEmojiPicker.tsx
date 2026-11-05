import { usePartyText } from '@app/components/WatchParty/messages';
import { Dialog } from '@headlessui/react';
import { PlusIcon } from '@heroicons/react/24/outline';
import { quickReactions } from '@server/constants/quickReactions';
import axios from 'axios';
import { Suspense, lazy, useLayoutEffect, useRef, useState } from 'react';
import useSWR from 'swr';

const FullPicker = lazy(() => import('./EmojiPicker'));

export default function QuickEmojiPicker({
  anchor,
  onClose,
  viewerId,
  onSelect,
  selected = [],
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
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
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor || !panel.current) return;
      const rect = anchor.getBoundingClientRect();
      const box = panel.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft || 0;
      const top = viewport?.offsetTop || 0;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      setPosition({
        left: Math.max(
          left + 8,
          Math.min(rect.right - box.width, left + width - box.width - 8)
        ),
        top: Math.max(
          top + 8,
          Math.min(
            rect.top >= top + box.height + 8
              ? rect.top - box.height - 8
              : rect.bottom + 8,
            top + height - box.height - 8
          )
        ),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
    };
  }, [anchor, expanded]);
  return (
    <Dialog open onClose={onClose} className="relative z-[150]">
      <div className="fixed inset-0" aria-hidden="true" />
      <Dialog.Panel
        ref={panel}
        style={{ position: 'fixed', ...position }}
        className="max-w-[calc(100vw-1rem)] text-gray-100"
      >
        <Dialog.Title className="sr-only">
          {t('Add reaction', 'Añadir reacción')}
        </Dialog.Title>
        {expanded ? (
          <Suspense
            fallback={
              <div className="rounded-2xl bg-gray-800 p-4" role="status">
                {t('Loading emoji…', 'Cargando emojis…')}
              </div>
            }
          >
            <FullPicker
              onSelect={onSelect}
              selected={selected}
              onBack={() => setExpanded(false)}
              onClose={onClose}
            />
          </Suspense>
        ) : (
          <div
            role="group"
            aria-label={t('Quick reactions', 'Reacciones rápidas')}
            className="flex w-[19rem] max-w-full items-center rounded-full border border-gray-600/70 bg-gray-800 p-1 shadow-2xl ring-1 ring-black/20"
          >
            <div className="flex min-w-0 items-center overflow-x-auto overscroll-x-contain [scrollbar-width:none]">
              {[
                ...quickReactions,
                ...[...new Set(recent || [])]
                  .filter((emoji) => !quickReactions.includes(emoji))
                  .slice(0, 6),
              ].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-pressed={selected.includes(emoji)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-2xl transition-transform hover:scale-110 hover:bg-gray-700 focus-visible:ring-2 focus-visible:ring-purple-400 aria-pressed:bg-purple-900"
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
        )}
      </Dialog.Panel>
    </Dialog>
  );
}
