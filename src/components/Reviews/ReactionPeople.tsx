import { usePartyText } from '@app/components/WatchParty/messages';
import { Dialog } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
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
      {emoji ? (
        <ul
          className="max-h-[40dvh] space-y-1 overflow-y-auto overscroll-contain"
          aria-label={t('People who reacted', 'Personas que reaccionaron')}
        >
          {people.map((person) => {
            const name =
              person.name ?? t('Catalogue member', 'Miembro del catálogo');
            return (
              <li
                key={person.id}
                className="flex min-w-0 items-center gap-3 rounded-xl px-2 py-2"
              >
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-400/10 text-sm font-semibold text-purple-200"
                >
                  {Array.from(name)[0]?.toLocaleUpperCase()}
                </span>
                <span className="min-w-0 flex-1 break-words font-medium">
                  {name}
                </span>
                {person.id === target.viewerId && (
                  <span className="shrink-0 text-xs text-gray-400">
                    {t('You', 'Tú')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-wrap gap-2">
          {[...new Set(people.map((p) => p.emoji))].map((e) => (
            <div
              key={e}
              className="flex max-w-full items-start gap-2 rounded-2xl bg-gray-900/40 px-3 py-2"
            >
              <span className="text-lg leading-5">{e}</span>
              <span className="min-w-0 break-words text-xs leading-5 text-gray-300">
                {people
                  .filter((p) => p.emoji === e)
                  .map(
                    (p) =>
                      p.name ?? t('Catalogue member', 'Miembro del catálogo')
                  )
                  .join(', ')}
              </span>
            </div>
          ))}
        </div>
      )}
      {!people.length && (
        <p>{t('No reactions yet.', 'Todavía no hay reacciones.')}</p>
      )}
      {emoji && (
        <button
          disabled={busy}
          className="mt-2 w-full rounded-full border border-purple-400/25 bg-purple-400/10 px-4 py-2.5 text-sm font-medium text-purple-200 transition-colors hover:bg-purple-400/20 focus-visible:ring-2 focus-visible:ring-purple-400 disabled:opacity-50"
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
        <div
          aria-hidden
          className="fixed inset-0 bg-black/40 backdrop-blur-sm"
        />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="max-h-[80dvh] w-full max-w-xs overflow-auto rounded-2xl border border-gray-600/70 bg-gray-800 p-4 text-gray-100 shadow-2xl">
            <header className="mb-3 flex items-center gap-3 border-b border-gray-700 pb-3">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-900/60 text-2xl"
              >
                {reaction.emoji}
              </span>
              <Dialog.Title className="flex-1 text-sm font-semibold">
                {t('Who reacted', 'Quién reaccionó')}
              </Dialog.Title>
              <button
                aria-label={t('Close', 'Cerrar')}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-700 hover:text-white focus-visible:ring-2 focus-visible:ring-purple-400"
                onClick={() => setOpen(false)}
              >
                <XMarkIcon className="h-4 w-4" />
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
