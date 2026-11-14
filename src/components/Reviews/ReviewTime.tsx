import Tooltip from '@app/components/Common/Tooltip';
import { reviewTime } from '@app/utils/reviewTime';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';

export default function ReviewTime({
  value,
  kind,
}: {
  value: string;
  kind: 'review' | 'comment';
}) {
  const { locale } = useIntl();
  const [now, setNow] = useState(() => new Date());
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  const { label, exact } = reviewTime(value, kind, locale, now);
  return (
    <Tooltip
      content={exact}
      className="max-w-[calc(100vw-2rem)] text-center"
      tooltipConfig={{
        trigger: ['hover', 'click'],
        followCursor: false,
        placement: 'top',
        offset: [0, 8],
        closeOnTriggerHidden: true,
        closeOnOutsideClick: true,
        visible: expanded,
        onVisibleChange: setExpanded,
      }}
    >
      <button
        type="button"
        aria-label={`${label} · ${exact}`}
        aria-expanded={expanded}
        className="text-left"
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) setExpanded(true);
        }}
        onBlur={() => setExpanded(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && expanded) {
            event.stopPropagation();
            setExpanded(false);
          }
        }}
      >
        <time
          dateTime={kind === 'review' ? value.slice(0, 10) : value}
          suppressHydrationWarning
        >
          {label}
        </time>
      </button>
    </Tooltip>
  );
}
