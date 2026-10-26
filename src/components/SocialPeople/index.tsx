import LetterboxdLogo from '@app/assets/services/letterboxd.svg';
import Tooltip from '@app/components/Common/Tooltip';
import MarkWatched from '@app/components/Reviews/MarkWatched';
import { usePartyText } from '@app/components/WatchParty/messages';
import type { ReactElement, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import AvatarStack from './AvatarStack';

type Person = {
  id: number;
  name: string;
  avatar: string;
  lastWatched?: number;
  seasons?: number[];
  watchedSource?: 'letterboxd' | 'catalogue' | 'both';
};
type Props = {
  id: number;
  type: string;
  kind?: 'watchers' | 'requesters';
  card?: boolean;
  vertical?: boolean;
  balanced?: boolean;
};
function DetailTooltip({
  card,
  content,
  children,
}: {
  card: boolean;
  content: ReactNode;
  children: ReactElement;
}) {
  if (card) return <>{children}</>;
  return (
    <Tooltip
      tooltipConfig={{
        followCursor: false,
        placement: 'bottom',
        trigger: ['hover', 'focus'],
      }}
      content={content}
    >
      {children}
    </Tooltip>
  );
}
export default function SocialPeople({
  id,
  type,
  kind = 'watchers',
  card = false,
  vertical = false,
  balanced = false,
}: Props) {
  const t = usePartyText();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!card);
  useEffect(() => {
    if (!ref.current || !card) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(
      ref.current.closest('[role="link"]') ||
        ref.current.parentElement ||
        ref.current
    );
    return () => observer.disconnect();
  }, [card]);
  const { data, error } = useSWR(
    visible && ['movie', 'tv'].includes(type)
      ? `/api/v1/social/${type}/${id}`
      : null,
    async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) throw Error('Unavailable');
      return response.json();
    },
    { refreshInterval: 120000, dedupingInterval: 30000, errorRetryCount: 2 }
  );
  // Server retains stale raw history and reapplies privacy. HTTP/policy failures fail closed.
  const people: Person[] = !error && data?.enabled ? data[kind] || [] : [];
  const label =
    kind === 'watchers'
      ? t('Watched by', 'Visto por')
      : t('Requested by', 'Solicitado por');
  const [diameter, setDiameter] = useState(card ? 16 : 26);
  useEffect(() => {
    if (card) {
      const breakpoint = window.matchMedia('(min-width: 640px)');
      const update = () => setDiameter(breakpoint.matches ? 20 : 16);
      update();
      breakpoint.addEventListener('change', update);
      return () => breakpoint.removeEventListener('change', update);
    }
    const status = ref.current
      ?.closest('.media-title')
      ?.querySelector('.media-status');
    if (!status) return;
    const update = () => {
      const h = status.firstElementChild?.getBoundingClientRect().height;
      if (h && h > 12 && h < 64) setDiameter(h);
    };
    const observer = new ResizeObserver(update);
    observer.observe(status);
    update();
    return () => observer.disconnect();
  }, [card, people.length]);
  return (
    <div
      ref={ref}
      className="social-people [--social-size:16px] sm:[--social-size:20px]"
      style={{
        display:
          people.length || (!card && kind === 'watchers') ? 'flex' : 'none',
        alignItems: 'center',
        gap: 8,
        position: 'relative',
        zIndex: 45,
        flexShrink: 1,
        minWidth: 0,
        justifyContent: card && !balanced ? 'flex-start' : 'center',
        width: card ? '100%' : undefined,
        maxWidth: '100%',
      }}
    >
      {!card && (
        <span style={{ fontSize: 12, color: '#d1d5db', whiteSpace: 'nowrap' }}>
          {label}
        </span>
      )}
      {!!people.length && (
        <DetailTooltip
          card={card}
          content={
            <div style={{ maxWidth: 280, maxHeight: 300, overflowY: 'auto' }}>
              <strong>{label}</strong>
              {kind === 'watchers' && type === 'tv' && (
                <div className="text-xs text-gray-400">
                  {t(
                    'At least one episode watched; not necessarily the whole series',
                    'Se ha visto al menos un episodio; no necesariamente toda la serie'
                  )}
                </div>
              )}
              {people.map((p) => (
                <div key={p.id} className="py-1">
                  <div className="flex items-center gap-2">
                    <span>{p.name}</span>
                    {kind === 'watchers' && (
                      <span className="inline-flex flex-none items-center gap-1.5">
                        {p.watchedSource !== 'letterboxd' && (
                          <img
                            src="/favicon-32x32.png"
                            alt="Multimeldia"
                            title="Multimeldia"
                            className="h-4 w-4 object-contain"
                          />
                        )}
                        {(p.watchedSource === 'letterboxd' ||
                          p.watchedSource === 'both') && (
                          <span
                            role="img"
                            aria-label="Letterboxd"
                            title="Letterboxd"
                            className="inline-flex"
                          >
                            <LetterboxdLogo
                              aria-hidden="true"
                              className="h-4 w-6"
                            />
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  {!!p.seasons?.length && (
                    <div className="text-xs text-gray-400">
                      {t('Seasons', 'Temporadas')} {p.seasons.join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          }
        >
          <span
            tabIndex={card ? undefined : 0}
            aria-label={`${label}: ${people.map((p) => p.name).join(', ')}`}
            style={{
              display: 'flex',
              flexDirection: vertical ? 'column' : 'row',
              pointerEvents: card ? 'none' : undefined,
              minWidth: 0,
              flexShrink: 1,
              maxWidth: '100%',
            }}
          >
            <AvatarStack
              size={diameter}
              vertical={vertical}
              items={people.map((p) => ({
                id: p.id,
                name: p.name,
                image: (
                  <img
                    src={p.avatar}
                    alt={p.name}
                    style={{
                      width: diameter,
                      height: diameter,
                      borderRadius: '50%',
                      boxSizing: 'border-box',
                      objectFit: 'cover',
                      opacity: 1,
                      background: '#334155',
                      border: `1px solid ${kind !== 'watchers' ? '#cbd5e1' : p.watchedSource === 'both' ? '#c084fc' : p.watchedSource === 'letterboxd' ? '#00e054' : '#ffffff'}`,
                    }}
                  />
                ),
              }))}
            />
          </span>
        </DetailTooltip>
      )}
      {!card && kind === 'watchers' && (type === 'movie' || type === 'tv') && (
        <MarkWatched id={id} type={type} size={diameter} />
      )}
    </div>
  );
}
