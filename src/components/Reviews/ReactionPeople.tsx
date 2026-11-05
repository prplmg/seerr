import { usePartyText } from '@app/components/WatchParty/messages';
import { Dialog } from '@headlessui/react';
import axios from 'axios';
import { useState } from 'react';
import useSWR from 'swr';
type Target = { reviewId: string; commentId?: string; viewerId?: number };
function usePeople({ reviewId, commentId, viewerId }: Target) {
  const url =
    '/api/v1/review-interactions/' +
    encodeURIComponent(reviewId) +
    '/reactions';
  return useSWR<{ id: number; name: string | null; emoji: string }[]>(
    [url, commentId ?? '', viewerId],
    async () => (await axios.get(url, { params: { commentId } })).data
  );
}
export function ReactionPeople({
  emoji,
  onChanged,
  ...target
}: Target & { emoji?: string; onChanged?: () => unknown }) {
  const t = usePartyText();
  const { data, error, mutate } = usePeople(target);
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  if (error)
    return (
      <button onClick={() => void mutate()}>
        {t(
          'Could not load reactions. Retry',
          'No se pudieron cargar las reacciones. Reintentar'
        )}
      </button>
    );
  if (!data)
    return (
      <p role="status">{t('Loading reactions…', 'Cargando reacciones…')}</p>
    );
  const people = emoji ? data.filter((p) => p.emoji === emoji) : data;
  if (!emoji && !people.length) return null;
  const mine = people.some((p) => p.id === target.viewerId);
  async function change() {
    setBusy(true);
    setFailed(false);
    try {
      await axios.put(
        '/api/v1/review-interactions/' +
          encodeURIComponent(target.reviewId) +
          '/reactions',
        { emoji, active: !mine, commentId: target.commentId }
      );
      await mutate();
      await onChanged?.();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 text-sm">
      {!emoji && (
        <h4 className="font-semibold">
          {t('Reacted to this review', 'Reaccionaron a esta reseña')}
        </h4>
      )}
      {[...new Set(people.map((p) => p.emoji))].map((e) => (
        <p key={e} className="break-words">
          {e}{' '}
          {people
            .filter((p) => p.emoji === e)
            .map((p) => p.name ?? t('Catalogue member', 'Miembro del catálogo'))
            .join(', ')}
        </p>
      ))}
      {!people.length && (
        <p>{t('No reactions yet.', 'Todavía no hay reacciones.')}</p>
      )}
      {emoji && (
        <button
          disabled={busy}
          className="rounded-full border border-gray-600 px-3 py-1 text-purple-200"
          onClick={() => void change()}
        >
          {mine
            ? t('Remove my reaction', 'Quitar mi reacción')
            : t('Add my reaction', 'Añadir mi reacción')}
        </button>
      )}
      {failed && (
        <p role="alert">
          {t(
            'Could not update reaction. Try again.',
            'No se pudo actualizar la reacción. Intenta de nuevo.'
          )}
        </p>
      )}
    </div>
  );
}
export function ReactionPill({
  reaction,
  className,
  onChanged,
  ...target
}: Target & {
  reaction: { emoji: string; count: number; mine: boolean };
  className: string;
  onChanged: () => unknown;
}) {
  const [open, setOpen] = useState(false);
  const t = usePartyText();
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={className}
        onClick={() => setOpen(true)}
      >
        {reaction.emoji} {reaction.count}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        className="relative z-[110]"
      >
        <div aria-hidden className="fixed inset-0 bg-black/60" />
        <div className="fixed inset-0 flex items-end justify-center sm:items-center">
          <Dialog.Panel className="max-h-[80dvh] w-full max-w-sm overflow-auto rounded-t-2xl bg-gray-800 p-5 text-gray-100 sm:rounded-2xl">
            <header className="mb-3 flex justify-between">
              <Dialog.Title className="font-semibold">
                {reaction.emoji} · {t('Who reacted', 'Quién reaccionó')}
              </Dialog.Title>
              <button
                aria-label={t('Close', 'Cerrar')}
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </header>
            {open && (
              <ReactionPeople
                {...target}
                emoji={reaction.emoji}
                onChanged={onChanged}
              />
            )}
          </Dialog.Panel>
        </div>
      </Dialog>
    </>
  );
}
