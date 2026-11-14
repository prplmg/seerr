import { usePartyText } from '@app/components/WatchParty/messages';
import { Dialog } from '@headlessui/react';
import { ChatBubbleOvalLeftIcon, XMarkIcon } from '@heroicons/react/24/outline';
import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import QuickEmojiPicker from './QuickEmojiPicker';
import { ReactionPill } from './ReactionPeople';
import ReviewInteractions, {
  type InteractionSummary,
} from './ReviewInteractions';
import { useReviewDialogViewport } from './useReviewDialogViewport';
const pillBase =
  'shrink-0 rounded-full border border-gray-600 px-2 leading-5 disabled:opacity-50';
const pill = pillBase + ' text-purple-200';

export default function DiscoveryReviewFooter({
  initiallyOpen = false,
  reviewId,
  viewerId,
  title,
  author,
  children,
  summary,
  onChanged,
}: {
  initiallyOpen?: boolean;
  reviewId: string;
  viewerId?: number;
  title?: string;
  author?: string;
  children: React.ReactNode;
  summary?: InteractionSummary;
  onChanged: () => unknown;
}) {
  const t = usePartyText();
  const [sheet, setSheet] = useState<'comments' | 'picker' | null>(
    initiallyOpen ? 'comments' : null
  );
  const closeButton = useRef<HTMLButtonElement>(null);
  const commentContent = useRef<HTMLDivElement>(null);
  const viewport = useReviewDialogViewport(
    sheet === 'comments',
    commentContent
  );
  useEffect(() => {
    if (initiallyOpen) setSheet('comments');
  }, [initiallyOpen]);
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
        <div className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto">
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
          data-analytics-action="open_reaction_picker"
          aria-label={t('Add reaction', 'Añadir reacción')}
          onClick={(event) => {
            setAnchor(event.currentTarget);
            setSheet('picker');
          }}
        >
          ＋
        </button>
        <button
          data-analytics-action="open_comments"
          aria-label={
            t('Comments', 'Comentarios') + ' · ' + (summary?.comments ?? 0)
          }
          className={`${pillBase} inline-flex items-center gap-1 ${
            (summary?.comments ?? 0) > 0 ? 'text-purple-200' : 'text-gray-400'
          }`}
          onClick={() => setSheet('comments')}
        >
          <ChatBubbleOvalLeftIcon className="h-4 w-4" />
          {summary?.comments ?? '…'}
        </button>
      </div>
      {error && sheet !== 'comments' && <span role="alert">{error}</span>}
      <Dialog
        initialFocus={closeButton}
        open={sheet === 'comments'}
        onClose={() => setSheet(null)}
        className="relative z-[100]"
      >
        <div aria-hidden className="fixed inset-0 bg-black/60" />
        <div
          style={{
            ...viewport,
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
          }}
          className="fixed inset-x-0 top-0 flex h-[100dvh] items-end justify-center overflow-hidden sm:items-center sm:p-4"
        >
          <Dialog.Panel className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-gray-600 bg-gray-800 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-gray-100 sm:rounded-2xl">
            <header className="flex shrink-0 items-center justify-between gap-2">
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
                ref={closeButton}
                aria-label={t('Close', 'Cerrar')}
                className={`${pill} flex h-11 w-11 items-center justify-center self-start`}
                onClick={() => setSheet(null)}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </header>
            <div
              ref={commentContent}
              className="min-h-0 overflow-y-auto overscroll-contain"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
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
            </div>
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
