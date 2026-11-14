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
    <button
      type="button"
      title={exact}
      aria-label={`${label} · ${exact}`}
      aria-expanded={expanded}
      className="text-left"
      onClick={() => setExpanded((v) => !v)}
    >
      <time
        dateTime={kind === 'review' ? value.slice(0, 10) : value}
        suppressHydrationWarning
      >
        {label}
      </time>
      {expanded && <span className="block text-xs text-gray-300">{exact}</span>}
    </button>
  );
}
