import CachedImage from '@app/components/Common/CachedImage';
import { usePartyText } from '@app/components/WatchParty/messages';
import { ShareIcon, XMarkIcon } from '@heroicons/react/24/outline';
import {
  catalogueOrigin,
  listSharePath,
} from '@server/interfaces/api/listShare';
import axios from 'axios';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

type Access = Record<string, 'viewer' | 'editor'>;
type Sharing = {
  revision: number;
  collaborators: Access;
  users: { id: number; name: string; avatar?: string }[];
};
const control =
  'rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white';
export default function ListSharing({
  id,
  owned,
  onChange,
}: {
  id: string;
  owned: boolean;
  onChange: () => void;
}) {
  const t = usePartyText();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Access | null>(null);
  const [revision, setRevision] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved && !copied) return;
    const timer = window.setTimeout(() => {
      setSaved(false);
      setCopied(false);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [saved, copied]);
  const endpoint = `/api/v1/discovery-lists/created/${encodeURIComponent(id)}/sharing`;
  const { data, error, mutate } = useSWR<Sharing>(
    open && owned ? endpoint : null
  );
  const link = () => catalogueOrigin + listSharePath(id);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link());
      setCopyFailed(false);
      setCopied(true);
    } catch {
      setCopyFailed(true);
      setCopied(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setMessage('');
    try {
      await axios.put(endpoint, { revision, collaborators: draft });
      setDraft(null);
      await mutate();
      onChange();
      setSaved(true);
    } catch (e) {
      setConflict(axios.isAxiosError(e) && e.response?.status === 409);
      setMessage(
        axios.isAxiosError(e)
          ? e.response?.data?.message || 'Could not save access.'
          : 'Could not save access.'
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        className="inline-flex items-center gap-2 rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-white"
        onClick={() => {
          setOpen(!open);
          setCopyFailed(false);
          setCopied(false);
        }}
        aria-expanded={open}
      >
        <ShareIcon className="h-5 w-5" />
        {t('Share', 'Compartir')}
      </button>
      {open && (
        <section
          aria-label={t('Share list', 'Compartir lista')}
          className="mt-3 w-full max-w-xl rounded-2xl border border-gray-600 bg-gray-800 p-4 text-gray-100"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-white">
              {t('Share list', 'Compartir lista')}
            </h2>
            <button
              aria-label={t('Close sharing', 'Cerrar')}
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
          <p className="my-3 text-sm text-gray-400">
            {t(
              'A link opens the list; it does not grant access. Public lists are visible to all Multimeldia users.',
              'El enlace abre la lista; no concede acceso. Las listas públicas son visibles para todos los usuarios.'
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className={control} onClick={() => void copy()}>
              {copied
                ? t('Copied ✓', 'Copiado ✓')
                : t('Copy link', 'Copiar enlace')}
            </button>
            {typeof navigator !== 'undefined' && !!navigator.share && (
              <button
                className={control}
                onClick={() =>
                  void navigator.share({ url: link() }).catch(() => {})
                }
              >
                {t('Share link…', 'Compartir enlace…')}
              </button>
            )}
          </div>
          {copyFailed && (
            <div className="mt-2">
              <p role="alert" className="text-sm text-gray-300">
                {t(
                  'Could not copy. Select this link to copy it manually.',
                  'No se pudo copiar. Selecciona el enlace para copiarlo manualmente.'
                )}
              </p>
              <input
                aria-label={t('List link', 'Enlace de lista')}
                className={`${control} mt-2 w-full text-sm`}
                readOnly
                value={typeof window === 'undefined' ? '' : link()}
                onFocus={(e) => e.target.select()}
              />
            </div>
          )}
          {owned && (
            <>
              <p className="mb-2 mt-4 text-sm text-gray-300">
                {t(
                  'Added people see this list in Shared with you automatically. Saving it remains their choice.',
                  'Las personas añadidas ven la lista en Compartidas contigo automáticamente. Guardarla sigue siendo su decisión.'
                )}
              </p>
              {error && (
                <p role="alert">
                  {t(
                    'Could not load sharing settings.',
                    'No se pudo cargar el acceso.'
                  )}
                </p>
              )}
              {!data && !error && (
                <p role="status">{t('Loading…', 'Cargando…')}</p>
              )}
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {data?.users.map((u) => (
                  <label
                    key={u.id}
                    className="flex items-center gap-3 rounded-xl bg-gray-900 p-2"
                  >
                    <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-gray-700">
                      {u.avatar ? (
                        <CachedImage
                          src={u.avatar}
                          type="avatar"
                          alt=""
                          width={32}
                          height={32}
                        />
                      ) : (
                        <span className="flex h-full items-center justify-center">
                          {u.name[0]}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{u.name}</span>
                    <select
                      aria-label={`${t('Access for', 'Acceso de')} ${u.name}`}
                      className={`${control} max-w-[50%] text-sm`}
                      disabled={busy}
                      value={(draft ?? data.collaborators)[u.id] ?? ''}
                      onChange={(e) => {
                        const next = { ...(draft ?? data.collaborators) };
                        if (e.target.value)
                          next[u.id] = e.target.value as 'viewer' | 'editor';
                        else delete next[u.id];
                        if (draft === null) setRevision(data.revision);
                        setDraft(next);
                        setSaved(false);
                        if (!conflict) setMessage('');
                      }}
                    >
                      <option value="">{t('Not added', 'Sin añadir')}</option>
                      <option value="viewer">
                        {t('Can view', 'Puede ver')}
                      </option>
                      <option value="editor">
                        {t('Can edit', 'Puede editar')}
                      </option>
                    </select>
                  </label>
                ))}
              </div>
              <div className="mt-3 flex justify-end gap-3">
                <button
                  className="rounded-full bg-purple-600 px-4 py-2 text-white disabled:opacity-50"
                  disabled={busy || !draft || conflict}
                  onClick={() => void save()}
                >
                  {saved
                    ? t('Saved ✓', 'Guardado ✓')
                    : t('Save access', 'Guardar acceso')}
                </button>
              </div>
            </>
          )}
          {message && (
            <div role="alert" className="mt-3 text-sm text-purple-200">
              <p>{message}</p>
              {conflict && (
                <button
                  className={`${control} mt-2`}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const latest = await mutate();
                      if (!latest) throw Error('No sharing settings');
                      setDraft(null);
                      setRevision(latest.revision);
                      setConflict(false);
                      setMessage('');
                    } catch {
                      setMessage(
                        t(
                          'Could not reload. Try again.',
                          'No se pudo recargar. Reintenta.'
                        )
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t('Reload latest', 'Recargar versión actual')}
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </>
  );
}
