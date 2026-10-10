import Tooltip from '@app/components/Common/Tooltip';
import { usePartyText } from '@app/components/WatchParty/messages';
import type { ReactElement, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

type Person = { id: number; name: string; avatar: string; lastWatched?: number; seasons?: number[] };
type Props = { id: number; type: string; kind?: 'watchers' | 'requesters'; card?: boolean; vertical?: boolean };
function DetailTooltip({ card, content, children }: { card: boolean; content: ReactNode; children: ReactElement }) {
  if (card) return <>{children}</>;
  return <Tooltip tooltipConfig={{ followCursor: false, placement: 'bottom', trigger: ['hover', 'focus'] }} content={content}>{children}</Tooltip>;
}
export default function SocialPeople({ id, type, kind = 'watchers', card = false, vertical = false }: Props) {
  const t = usePartyText();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!card);
  useEffect(() => {
    if (!ref.current || !card) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } });
    observer.observe(ref.current.closest('[role="link"]') || ref.current.parentElement || ref.current);
    return () => observer.disconnect();
  }, [card]);
  const { data, error } = useSWR(visible && ['movie', 'tv'].includes(type) ? `/api/v1/social/${type}/${id}` : null,
    async (url: string) => { const response = await fetch(url); if (!response.ok) throw Error('Unavailable'); return response.json(); },
    { refreshInterval: 120000, dedupingInterval: 30000, errorRetryCount: 2 });
  // Server retains stale raw history and reapplies privacy. HTTP/policy failures fail closed.
  const people: Person[] = !error && data?.enabled ? data[kind] || [] : [];
  const label = kind === 'watchers' ? t('Watched by', 'Visto por') : t('Requested by', 'Solicitado por');
  const [diameter, setDiameter] = useState(card ? 20 : 26);
  useEffect(() => {
    const status = ref.current?.closest('.media-title')?.querySelector('.media-status');
    if (card || !status) return;
    const update = () => { const h = status.firstElementChild?.getBoundingClientRect().height; if (h && h > 12 && h < 64) setDiameter(h); };
    const observer = new ResizeObserver(update); observer.observe(status); update(); return () => observer.disconnect();
  }, [card, people.length]);
  const step = people.length <= 1 ? 1 : Math.min(vertical ? 0.32 : 0.55, (card ? 1.4 : 5) / (people.length - 1));
  return <div ref={ref} className="social-people [--social-size:16px] sm:[--social-size:20px]" style={{ display: people.length ? 'flex' : 'none', alignItems: 'center', gap: 8, position: 'relative', zIndex: 45, flexShrink: 1, minWidth: 0, justifyContent: 'center' }}>
    {!card && <span style={{ fontSize: 12, color: '#d1d5db', whiteSpace: 'nowrap' }}>{label}</span>}
    {!!people.length && <DetailTooltip card={card} content={<div style={{ maxWidth: 280, maxHeight: 300, overflowY: 'auto' }}>
      <strong>{label}</strong>
      {kind === 'watchers' && type === 'tv' && <div className="text-xs text-gray-400">{t('At least one episode watched; not necessarily the whole series', 'Se ha visto al menos un episodio; no necesariamente toda la serie')}</div>}
      {people.map(p => <div key={p.id} className="py-1"><span>{p.name}</span>{!!p.seasons?.length && <div className="text-xs text-gray-400">{t('Seasons', 'Temporadas')} {p.seasons.join(', ')}</div>}</div>)}
    </div>}><span tabIndex={card ? undefined : 0} aria-label={`${label}: ${people.map(p => p.name).join(', ')}`} style={{ display: 'flex', flexDirection: vertical ? 'column' : 'row', pointerEvents: card ? 'none' : undefined }}>
      {people.map((p, i) => <img key={p.id} src={p.avatar} alt={p.name} className={card ? 'h-4 w-4 sm:h-5 sm:w-5' : ''} style={{ ...(card ? {} : { width: diameter, height: diameter }), boxSizing: 'border-box', borderRadius: '50%', border: '1px solid #cbd5e1', objectFit: 'cover', background: '#334155', flexShrink: 0, position: 'relative', zIndex: people.length - i, opacity: kind === 'watchers' && i > 0 ? 0.65 : 1, ...(i ? vertical ? { marginTop: `calc(-1 * var(--social-size, 20px) * ${1-step})` } : { marginLeft: card ? `calc(-1 * var(--social-size, 20px) * ${1-step})` : -diameter*(1-step) } : {}) }} />)}
    </span></DetailTooltip>}
  </div>;
}
