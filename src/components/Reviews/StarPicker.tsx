import { usePartyText } from '@app/components/WatchParty/messages';
import { StarIcon } from '@heroicons/react/24/solid';
import { useRef, useState } from 'react';

export function pointerRating(x: number, left: number, width: number): number {
  return Math.max(0.5, Math.min(5, Math.ceil(((x - left) / width) * 10) / 2));
}

export default function StarPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const t = usePartyText();
  const [preview, setPreview] = useState<number | null>(null);
  const dragging = useRef(false);
  const shown = preview ?? Number(value || 0);
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-gray-300">
        {t('Rating', 'Calificación')}
      </p>
      <div className="flex min-w-0 flex-col items-start gap-2">
        <div
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          aria-label={t('Rating', 'Calificación')}
          aria-valuemin={0}
          aria-valuemax={5}
          aria-valuenow={Number(value || 0)}
          aria-valuetext={
            value ? `${value} / 5` : t('No rating', 'Sin calificación')
          }
          className="flex h-12 w-60 max-w-full cursor-pointer select-none rounded-lg text-purple-400 outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
          style={{ touchAction: 'pan-y' }}
          onPointerDown={(e) => {
            if (disabled || e.button !== 0) return;
            dragging.current = true;
            setPreview(null);
            e.currentTarget.setPointerCapture(e.pointerId);
            const rect = e.currentTarget.getBoundingClientRect();
            onChange(String(pointerRating(e.clientX, rect.left, rect.width)));
            e.currentTarget.focus();
          }}
          onPointerMove={(e) => {
            if (disabled) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const next = pointerRating(e.clientX, rect.left, rect.width);
            if (dragging.current) onChange(String(next));
            else if (e.pointerType === 'mouse') setPreview(next);
          }}
          onPointerUp={() => {
            dragging.current = false;
            setPreview(null);
          }}
          onPointerCancel={() => {
            dragging.current = false;
            setPreview(null);
          }}
          onLostPointerCapture={() => {
            dragging.current = false;
            setPreview(null);
          }}
          onPointerLeave={() => {
            if (!dragging.current) setPreview(null);
          }}
          onKeyDown={(e) => {
            if (disabled) return;
            const current = Number(value || 0);
            const next = {
              ArrowRight: Math.min(5, current + 0.5),
              ArrowUp: Math.min(5, current + 0.5),
              ArrowLeft: Math.max(0, current - 0.5),
              ArrowDown: Math.max(0, current - 0.5),
              Home: 0,
              End: 5,
              Delete: 0,
              Backspace: 0,
            }[e.key];
            if (next === undefined) return;
            e.preventDefault();
            setPreview(null);
            onChange(next ? String(next) : '');
          }}
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} aria-hidden="true" className="relative h-12 w-1/5">
              <StarIcon className="h-12 w-full p-1 text-gray-600" />
              <span
                className="absolute inset-y-0 left-0 overflow-hidden"
                style={{
                  width: `${Math.max(0, Math.min(1, shown - i)) * 100}%`,
                }}
              >
                <StarIcon className="h-12 w-12 max-w-none p-1" />
              </span>
            </span>
          ))}
        </div>
        <div className="flex min-h-[44px] w-full items-center gap-4">
          <span
            className="min-w-[5rem] text-sm leading-6 text-purple-300"
            aria-live="polite"
          >
            {shown ? `${shown} / 5` : t('No rating', 'Sin calificación')}
          </span>
          <button
            type="button"
            disabled={disabled || !value}
            className="min-h-[44px] text-sm text-gray-300 underline hover:text-white disabled:opacity-40"
            onClick={() => {
              setPreview(null);
              onChange('');
            }}
          >
            {t('Clear rating', 'Quitar calificación')}
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-gray-400">
        {t(
          'Tap or drag · half-star steps',
          'Toca o desliza · incrementos de media estrella'
        )}
      </p>
    </div>
  );
}
