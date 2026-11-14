// Review dates are calendar dates, never instants. Comments are instants in the viewer's zone.
export function reviewTime(
  value: string,
  kind: 'review' | 'comment',
  locale: string,
  now = new Date()
) {
  const date =
    kind === 'review'
      ? new Date(value.slice(0, 10) + 'T12:00:00')
      : new Date(value);
  if (!Number.isFinite(date.getTime())) return { label: value, exact: value };
  const calendar = (d: Date) =>
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((calendar(now) - calendar(date)) / 86400000);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const exact = new Intl.DateTimeFormat(
    locale,
    kind === 'comment'
      ? { dateStyle: 'long', timeStyle: 'short' }
      : { dateStyle: 'long' }
  ).format(date);
  let label: string;
  const seconds = Math.max(
    0,
    Math.floor((now.getTime() - date.getTime()) / 1000)
  );
  if (kind === 'comment' && days === 0) {
    label =
      seconds < 60
        ? relative.format(0, 'second')
        : seconds < 3600
          ? relative.format(-Math.floor(seconds / 60), 'minute')
          : relative.format(-Math.floor(seconds / 3600), 'hour');
  } else if (days >= 0 && days < 7) label = relative.format(-days, 'day');
  else if (days >= 7 && days < 14) label = relative.format(-1, 'week');
  else
    label = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
      date
    );
  return { label, exact };
}
