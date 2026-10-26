import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { stackLayout } from './stackLayout';

// The flex parent supplies the available width. Never shrink faces or wrap them.
export default function AvatarStack({
  items,
  size,
  vertical = false,
}: {
  items: { id: number; name: string; image: ReactNode }[];
  size: number;
  vertical?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const extra =
    Math.max(0, items.length - 1) * (vertical ? size * 0.32 : size + 3);
  const desired = size + (vertical ? Math.min(extra, size * 1.4) : extra);
  const [available, setAvailable] = useState(size);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const card = element.closest('[role="link"]');
    const update = () => {
      if (vertical && card) {
        const room =
          card.getBoundingClientRect().bottom -
          element.getBoundingClientRect().top -
          12;
        element.style.height = `${Math.max(size, Math.min(desired, room))}px`;
      }
      setAvailable(vertical ? element.clientHeight : element.clientWidth);
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (card) observer.observe(card);
    update();
    return () => observer.disconnect();
  }, [desired, size, vertical, items.length]);
  const { step } = stackLayout(items.length, size, available, vertical);
  if (!items.length) return null;
  const cells = items;
  return (
    <span
      ref={ref}
      className="relative block"
      style={{
        width: vertical ? size : desired,
        height: vertical ? desired : size,
        maxWidth: '100%',
        minWidth: size,
        flexShrink: 1,
        opacity: 1,
      }}
    >
      {cells.map((item, i) => (
        <span
          key={item.id}
          title={item.name}
          className="absolute flex items-center justify-center rounded-full bg-gray-800 text-white"
          style={{
            width: size,
            height: size,
            boxSizing: 'border-box',
            top: vertical ? i * step : 0,
            left: vertical ? 0 : i * step,
            zIndex: cells.length - i,
            opacity: 1,
            isolation: 'isolate',
            fontSize: 10,
          }}
        >
          {item.image}
        </span>
      ))}
    </span>
  );
}
