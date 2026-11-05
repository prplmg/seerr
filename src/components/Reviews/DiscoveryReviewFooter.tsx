import { usePartyText } from '@app/components/WatchParty/messages';
import { Dialog } from '@headlessui/react';
import { ChatBubbleOvalLeftIcon, XMarkIcon } from '@heroicons/react/24/outline';
import axios from 'axios';
import { useState } from 'react';
import QuickEmojiPicker from './QuickEmojiPicker';
import { ReactionPill } from './ReactionPeople';
import ReviewInteractions, {
  type InteractionSummary,
} from './ReviewInteractions';
const pill =
  'shrink-0 rounded-full border border-gray-600 px-2 leading-5 text-purple-200 disabled:opacity-50';

export default function DiscoveryReviewFooter({
  reviewId,
  viewerId,
  title,
  author,
  children,
  summary,
  onChanged,
}: {
  reviewId: string;
  viewerId?: number;
  title?: string;
  author?: string;
  children: React.ReactNode;
  summary?: InteractionSummary;
  onChanged: () => unknown;
}) {
  const t = usePartyText();
  const [sheet, setSheet] = useState<'comments' | 'picker' | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function react(emoji: string, active: boolean) {
    setBusy(true);
    setError('');
    try {
      await axios.put(
        '/api/v1/review-interactions/' +
          encodeURIComponent(reviewId) +
          '/reactions',
        { emoji, active }
      );
      setSheet(null);
      await onChanged();
    } catch {
      setError(
        t(
          'Could not update reaction. Try again.',
          'No se pudo actualizar la reacción. Intenta de nuevo.'
        )
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-auto flex-none pt-1 text-sm">
      <div className="flex items-center gap-1">
        {children}
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {summary?.reactions.map((r) => (
            <ReactionPill
              key={r.emoji}
              reaction={r}
              reviewId={reviewId}
              viewerId={viewerId}
              className={
                pill + (r.mine ? ' border-purple-400 bg-purple-900/40' : '')
              }
              onChanged={onChanged}
            />
          ))}
        </div>
        <button
          className={pill}
          disabled={busy}
          aria-label={t('Add reaction', 'Añadir reacción')}
          onClick={(event) => {
            setAnchor(event.currentTarget);
            setSheet('picker');
          }}
        >
          ＋
        </button>
        <button
          aria-label={
            t('Comments', 'Comentarios') + ' · ' + (summary?.comments ?? 0)
          }
          className={pill + ' inline-flex items-center gap-1'}
          onClick={() => setSheet('comments')}
        >
          <ChatBubbleOvalLeftIcon className="h-4 w-4" />
          {summary?.comments ?? '…'}
        </button>
      </div>
      {error && sheet !== 'comments' && <span role="alert">{error}</span>}
      <Dialog
        open={sheet === 'comments'}
        onClose={() => setSheet(null)}
        className="relative z-[100]"
      >
        <div aria-hidden className="fixed inset-0 bg-black/60" />
        <div className="fixed inset-0 flex items-end justify-center sm:items-center">
          <Dialog.Panel className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-gray-600 bg-gray-800 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-gray-100 sm:rounded-2xl">
            <header className="flex items-center justify-between gap-2">
              <Dialog.Title className="text-lg font-semibold">
                {sheet === 'comments'
                  ? author
                    ? t(`${author}’s review`, `Reseña de ${author}`)
                    : t('Review comments', 'Comentarios de la reseña')
                  : t('React', 'Reaccionar')}
                {title && (
                  <span className="block break-words text-sm font-normal text-gray-300">
                    {title}
                  </span>
                )}
              </Dialog.Title>
              <button
                aria-label={t('Close', 'Cerrar')}
                className={pill}
                onClick={() => setSheet(null)}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </header>
            {sheet === 'comments' && (
              <ReviewInteractions
                threadOnly
                reviewId={reviewId}
                viewerId={viewerId}
                summary={summary}
                onChanged={onChanged}
              />
            )}
            {sheet && error && <p role="alert">{error}</p>}
          </Dialog.Panel>
        </div>
      </Dialog>
      {sheet === 'picker' && (
        <QuickEmojiPicker
          anchor={anchor}
          onClose={() => setSheet(null)}
          viewerId={viewerId}
          selected={summary?.reactions
            .filter((r) => r.mine)
            .map((r) => r.emoji)}
          onSelect={(emoji) => {
            if (!busy) void react(emoji, true);
          }}
        />
      )}
    </div>
  );
}
