import CachedImage from '@app/components/Common/CachedImage';
import { usePartyText } from '@app/components/WatchParty/messages';
import { ChatBubbleOvalLeftIcon } from '@heroicons/react/24/outline';
import axios from 'axios';
import { Suspense, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import QuickEmojiPicker from './QuickEmojiPicker';
import { ReactionPeople, ReactionPill } from './ReactionPeople';
export type InteractionSummary = {
  comments: number;
  reactions: { emoji: string; count: number; mine: boolean }[];
};
type Comment = {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  reactions?: InteractionSummary['reactions'];
  canEdit: boolean;
  canDelete: boolean;
  user: { id: number; name: string; avatar: string } | null;
};
const controlBase =
  'rounded-full border border-gray-600 px-3 py-2 text-sm hover:bg-gray-700 disabled:opacity-50';
const control = controlBase + ' text-purple-200';
export default function ReviewInteractions({
  reviewId,
  viewerId,
  summary,
  initiallyOpen = false,
  threadOnly = false,
  onChanged,
}: {
  initiallyOpen?: boolean;
  threadOnly?: boolean;
  reviewId: string;
  viewerId?: number;
  summary?: InteractionSummary;
  onChanged: () => unknown;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const t = usePartyText(),
    [open, setOpen] = useState(threadOnly || initiallyOpen),
    [picker, setPicker] = useState<string | null>(null),
    [page, setPage] = useState(1),
    [draft, setDraft] = useState(''),
    [draftId, setDraftId] = useState(''),
    [editing, setEditing] = useState<Comment | null>(null),
    [editText, setEditText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const { mutate: refreshPeople } = useSWRConfig();
  const base = `/api/v1/review-interactions/${encodeURIComponent(reviewId)}`;
  const {
    data,
    mutate,
    error: loadError,
  } = useSWR<{ results: Comment[]; total: number; page: number }>(
    open ? [`${base}/comments?page=${page}`, viewerId] : null,
    async ([url]: [string, number | undefined]) => (await axios.get(url)).data
  );
  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await work();
      await Promise.all([
        mutate(),
        onChanged(),
        refreshPeople(
          (key) =>
            Array.isArray(key) &&
            key[0] === base + '/reactions' &&
            key[2] === viewerId
        ),
      ]);
    } catch (reason) {
      setError(
        (axios.isAxiosError(reason) && reason.response?.data?.message) ||
          t(
            'Could not save this change. Your text is kept—please retry.',
            'No se pudo guardar el cambio. Tu texto se conserva; intenta de nuevo.'
          )
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label={t('Review interactions', 'Interacciones de la reseña')}
      className="mt-4 min-w-0 border-t border-gray-700 pt-3"
    >
      <div className={threadOnly ? 'hidden' : 'flex items-center gap-2'}>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [&>button]:shrink-0">
          {summary?.reactions.map((r) => (
            <ReactionPill
              key={r.emoji}
              reaction={r}
              reviewId={reviewId}
              viewerId={viewerId}
              className={
                control + (r.mine ? ' border-purple-400 bg-purple-900/40' : '')
              }
              onChanged={onChanged}
            />
          ))}
          <button
            type="button"
            disabled={busy || !summary}
            className={control}
            aria-label={t('＋ React', '＋ Reaccionar')}
            aria-expanded={picker === reviewId}
            onClick={(event) => {
              setAnchor(event.currentTarget);
              setPicker((v) => (v === reviewId ? null : reviewId));
            }}
          >
            ＋
          </button>
        </div>
        <button
          type="button"
          aria-label={
            t('Comments', 'Comentarios') + ' · ' + (summary?.comments ?? 0)
          }
          className={`${controlBase} inline-flex shrink-0 items-center gap-1 ${
            (summary?.comments ?? 0) > 0 ? 'text-purple-200' : 'text-gray-400'
          }`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <ChatBubbleOvalLeftIcon className="h-4 w-4" />
          {summary?.comments ?? '…'}
        </button>
      </div>
      {picker === reviewId && (
        <Suspense
          fallback={
            <p role="status" className="mt-3 text-sm text-gray-400">
              {t('Loading emoji…', 'Cargando emojis…')}
            </p>
          }
        >
          <QuickEmojiPicker
            anchor={anchor}
            onClose={() => setPicker(null)}
            viewerId={viewerId}
            selected={summary?.reactions
              .filter((r) => r.mine)
              .map((r) => r.emoji)}
            onSelect={(emoji) => {
              setPicker(null);
              void act(() =>
                axios.put(`${base}/reactions`, { emoji, active: true })
              );
            }}
          />
        </Suspense>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {open && (
        <div className="mt-4 min-w-0 space-y-4">
          <ReactionPeople reviewId={reviewId} viewerId={viewerId} />
          <p className="text-xs text-gray-400">
            {t(
              'Comments and reactions stay in Multimeldia.',
              'Los comentarios y las reacciones se quedan en Multimeldia.'
            )}
          </p>
          {loadError ? (
            <p role="alert">
              {t(
                'Comments could not be loaded.',
                'No se pudieron cargar los comentarios.'
              )}{' '}
              <button className="text-purple-300" onClick={() => void mutate()}>
                {t('Retry', 'Reintentar')}
              </button>
            </p>
          ) : !data ? (
            <p role="status">
              {t('Loading comments…', 'Cargando comentarios…')}
            </p>
          ) : !data.total ? (
            <p className="text-sm text-gray-400">
              {t('Start the conversation.', 'Inicia la conversación.')}
            </p>
          ) : (
            data.results.map((c) => (
              <article
                key={c.id}
                className="min-w-0 rounded-lg bg-gray-900/60 p-3"
              >
                <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2 text-sm">
                  {c.user?.avatar && (
                    <CachedImage
                      type="avatar"
                      src={c.user.avatar}
                      alt=""
                      width={24}
                      height={24}
                      className="h-6 w-6 rounded-full"
                    />
                  )}
                  <span className="break-all font-semibold text-gray-100">
                    {c.user?.name || t('Former member', 'Exmiembro')}
                  </span>
                  <time
                    className="text-xs text-gray-400"
                    dateTime={c.createdAt}
                  >
                    {new Date(c.createdAt).toLocaleDateString()}
                  </time>
                  {c.updatedAt !== c.createdAt && (
                    <span className="text-xs text-gray-400">
                      {t('edited', 'editado')}
                    </span>
                  )}
                </div>
                {editing?.id === c.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(async () => {
                        await axios.patch(`${base}/comments/${c.id}`, {
                          text: editText,
                          revision: c.updatedAt,
                        });
                        setEditing(null);
                      });
                    }}
                  >
                    <textarea
                      aria-label={t('Edit comment', 'Editar comentario')}
                      maxLength={4000}
                      rows={3}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="w-full min-w-0 rounded-lg border border-gray-600 bg-gray-800 p-2 text-base"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        disabled={busy || !editText.trim()}
                        className={control}
                      >
                        {t('Save', 'Guardar')}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className={control}
                        onClick={() => setEditing(null)}
                      >
                        {t('Cancel', 'Cancelar')}
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <p
                      className="whitespace-pre-wrap break-words text-sm text-gray-200"
                      style={{ overflowWrap: 'anywhere' }}
                    >
                      {c.text}
                    </p>
                    <div className="mt-2 flex items-center gap-3 text-xs leading-4 text-purple-300">
                      {c.canEdit && (
                        <button
                          disabled={busy}
                          onClick={() => {
                            setEditing(c);
                            setEditText(c.text);
                          }}
                        >
                          {t('Edit', 'Editar')}
                        </button>
                      )}
                      {c.canDelete && (
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                t(
                                  'Delete this comment from Multimeldia?',
                                  '¿Eliminar este comentario de Multimeldia?'
                                )
                              )
                            )
                              void act(() =>
                                axios.delete(`${base}/comments/${c.id}`)
                              );
                          }}
                        >
                          {t('Delete', 'Eliminar')}
                        </button>
                      )}
                      <div className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto">
                        {c.reactions?.map((r) => (
                          <ReactionPill
                            key={r.emoji}
                            reaction={r}
                            reviewId={reviewId}
                            viewerId={viewerId}
                            commentId={c.id}
                            className="shrink-0 rounded-full border border-gray-600 px-2 py-0.5 text-xs leading-4 text-purple-200 hover:bg-gray-700"
                            onChanged={mutate}
                          />
                        ))}
                      </div>
                      <button
                        className="relative shrink-0 rounded-full border border-gray-600 px-2 py-0.5 text-xs leading-4 text-purple-200 after:absolute after:-inset-1 hover:bg-gray-700"
                        disabled={busy}
                        aria-label={t(
                          'React to comment',
                          'Reaccionar al comentario'
                        )}
                        aria-expanded={picker === c.id}
                        onClick={(event) => {
                          setAnchor(event.currentTarget);
                          setPicker(picker === c.id ? null : c.id);
                        }}
                      >
                        ＋
                      </button>
                    </div>
                    {picker === c.id && (
                      <Suspense fallback={null}>
                        <QuickEmojiPicker
                          anchor={anchor}
                          onClose={() => setPicker(null)}
                          viewerId={viewerId}
                          selected={c.reactions
                            ?.filter((r) => r.mine)
                            .map((r) => r.emoji)}
                          onSelect={(emoji) => {
                            setPicker(null);
                            void act(() =>
                              axios.put(base + '/reactions', {
                                commentId: c.id,
                                emoji,
                                active: true,
                              })
                            );
                          }}
                        />
                      </Suspense>
                    )}
                  </>
                )}
              </article>
            ))
          )}
          {data && data.total > 20 && (
            <div className="flex items-center justify-between gap-2 text-sm">
              <button
                disabled={page <= 1 || busy}
                className={control}
                onClick={() => setPage((p) => p - 1)}
              >
                {t('Previous', 'Anterior')}
              </button>
              <span>
                {page} / {Math.ceil(data.total / 20)}
              </span>
              <button
                disabled={page * 20 >= data.total || busy}
                className={control}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('Next', 'Siguiente')}
              </button>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const id = draftId || crypto.randomUUID();
              setDraftId(id);
              void act(async () => {
                await axios.post(`${base}/comments`, { id, text: draft });
                setDraft('');
                setDraftId('');
                if (data) setPage(Math.ceil((data.total + 1) / 20));
              });
            }}
          >
            <label
              htmlFor={`comment-${reviewId}`}
              className="mb-2 block text-sm font-medium text-gray-200"
            >
              {t('Add a comment', 'Añadir un comentario')}
            </label>
            <textarea
              id={`comment-${reviewId}`}
              disabled={busy}
              rows={3}
              maxLength={4000}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
              }}
              placeholder={t('Write a comment...', 'Escribe un comentario...')}
              className="w-full min-w-0 rounded-lg border border-gray-600 bg-gray-900 p-3 text-base focus:border-purple-400"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-xs text-gray-400">
                {draft.length}/4,000
              </span>
              <button
                disabled={busy || !draft.trim()}
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy
                  ? t('Saving…', 'Guardando…')
                  : t('Post comment', 'Publicar comentario')}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
