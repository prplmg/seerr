import type { ReviewObservation } from './letterboxdObservations';
export function manualDiaryViewing(id: string, now: string) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw Error('Invalid viewing time');
  return {
    watchedDate: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Merida', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date),
    viewingEventId: `manual:${id}:${date.toISOString()}`,
  };
}
export function reviewDiaryIntent(
  local: {
    id: string;
    watchedDate: string | null;
    externalEntryId: string | null;
    viewingEventId?: string | null;
    rating?: number | null;
    text?: string;
    spoiler?: boolean;
  },
  receipt: { entryId: string } | undefined,
  observation: ReviewObservation | undefined
) {
  if (!local.watchedDate || local.externalEntryId || receipt) return null;
  if (!local.viewingEventId) throw Error('Missing viewing evidence');
  if (
    !observation?.diaryEntriesComplete ||
    typeof observation.watched !== 'boolean' ||
    !observation.diaryEntryDates
  )
    throw Error('Incomplete viewing inventory');
  if (
    Object.values(observation.diaryEntryDates).some(
      (date) => date >= local.watchedDate!
    )
  )
    throw Error('Viewing already exists or is ambiguous');
  return {
    kind: 'diary' as const,
    originId: `review-viewing:${local.id}`,
    originEntityId: local.id,
    expected: { watchedDate: null, rewatch: false,
      ...(local.rating !== undefined && local.text !== undefined && local.spoiler !== undefined
        ? { rating: observation.rating, text: '', spoiler: false } : {}) },
    desired: {
      watchedDate: local.watchedDate,
      rewatch: observation.watched || !!observation.diaryEntryIds?.length,
      ...(local.rating !== undefined && local.text !== undefined && local.spoiler !== undefined
        ? { rating: local.rating, text: local.text, spoiler: local.spoiler } : {}),
    },
  };
}
