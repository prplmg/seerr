import CachedImage from '@app/components/Common/CachedImage';
import { usePartyText } from '@app/components/WatchParty/messages';
import { Popover, Portal } from '@headlessui/react';
import type { WatchingPerson } from '@server/interfaces/api/watchParty';
import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  ROSTER_AVATAR_SIZE,
  ROSTER_GAP,
  compactRosterLayout,
} from './compactRosterLayout';

function PersonImage({
  person,
  large = false,
}: {
  person: WatchingPerson;
  large?: boolean;
}) {
  const [failed, setFailed] = useState<string>();
  const size = large ? 32 : ROSTER_AVATAR_SIZE;
  return (
    <span
      title={person.name}
      role="img"
      aria-label={person.name}
      className="inline-flex flex-none items-center justify-center overflow-hidden rounded-full border border-gray-400 bg-gray-700 text-xs text-white"
      style={{ width: size, height: size }}
    >
      {person.avatar && failed !== person.avatar ? (
        <CachedImage
          type="avatar"
          src={person.avatar}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
          onError={() => setFailed(person.avatar)}
        />
      ) : (
        Array.from(person.name)[0]?.toLocaleUpperCase()
      )}
    </span>
  );
}
function PeoplePanel({
  people,
  anchor,
}: {
  people: WatchingPerson[];
  anchor: RefObject<HTMLButtonElement | null>;
}) {
  const t = usePartyText();
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 8, left: 8 });
  useEffect(() => {
    const update = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const height = panel.current?.getBoundingClientRect().height ?? 240;
      const width = panel.current?.getBoundingClientRect().width ?? 240;
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: Math.max(
          8,
          Math.min(rect.bottom + 8, window.innerHeight - height - 8)
        ),
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchor, people.length]);
  return (
    <Popover.Panel
      ref={panel}
      focus
      style={position}
      aria-label={t('More viewers', 'Más espectadores')}
      className="fixed z-[100] max-h-[min(60dvh,20rem)] w-60 max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain rounded-xl border border-gray-600 bg-gray-800 p-3 text-sm text-white shadow-xl"
    >
      <ul className="space-y-2">
        {people.map((person) => (
          <li key={person.id} className="flex min-w-0 items-center gap-2">
            <PersonImage person={person} large />
            <span className="min-w-0 break-words">{person.name}</span>
          </li>
        ))}
      </ul>
    </Popover.Panel>
  );
}

/** List-card-only, single row. The parent reserves space for party controls. */
export default function CompactWatchingRoster({
  people,
}: {
  people: WatchingPerson[];
}) {
  const t = usePartyText();
  const row = useRef<HTMLSpanElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState({ width: 0, overflow: 28 });
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    const update = () =>
      setSize({
        width: element.clientWidth,
        overflow: measure.current?.offsetWidth ?? 28,
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (measure.current) observer.observe(measure.current);
    return () => observer.disconnect();
  }, [people.length]);
  const { visible, hidden } = compactRosterLayout(
    people.length,
    size.width,
    size.overflow
  );
  if (!people.length) return null;
  const overflowClass =
    'inline-flex h-7 min-w-7 flex-none items-center justify-center rounded-full px-1 text-[10px] tabular-nums';
  return (
    <span
      ref={row}
      data-compact-roster
      className="relative inline-flex h-7 min-w-0 max-w-full flex-shrink items-center gap-1"
      style={{
        width: Math.max(
          28,
          people.length * (ROSTER_AVATAR_SIZE + ROSTER_GAP) - ROSTER_GAP
        ),
      }}
    >
      <span
        ref={measure}
        aria-hidden="true"
        className={`invisible absolute ${overflowClass}`}
      >
        +{people.length}
      </span>
      {people.slice(0, visible).map((person) => (
        <PersonImage key={person.id} person={person} />
      ))}
      {hidden > 0 && (
        <Popover className="flex-none">
          {({ open }) => (
            <>
              <Popover.Button
                ref={button}
                className={`${overflowClass} bg-gray-700 text-purple-200 hover:bg-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-300`}
                aria-label={t(
                  `Show ${hidden} more viewers`,
                  `Mostrar ${hidden} espectadores más`
                )}
              >
                +{hidden}
              </Popover.Button>
              {open && (
                <Portal>
                  <PeoplePanel people={people.slice(visible)} anchor={button} />
                </Portal>
              )}
            </>
          )}
        </Popover>
      )}
    </span>
  );
}
