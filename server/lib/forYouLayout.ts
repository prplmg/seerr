export const forYouSections = [
  'unrated',
  'episodes',
  'movies',
  'recommendations',
  'available',
  'friendsLoved',
  'requested',
  'unfinished',
  'continueLists',
  'activity',
  'almostFinished',
  'explore',
] as const;
export type ForYouRow = {
  id: (typeof forYouSections)[number];
  enabled: boolean;
};
export function forYouLayout(value?: unknown): ForYouRow[] {
  if (value === undefined)
    return forYouSections.map((id) => ({ id, enabled: true }));
  if (
    !Array.isArray(value) ||
    value.length > forYouSections.length + 1 ||
    value.some(
      (row) =>
        !row ||
        (!forYouSections.includes(row.id) && row.id !== 'newlyAvailable') ||
        typeof row.enabled !== 'boolean'
    ) ||
    new Set(value.map((row) => row.id)).size !== value.length
  )
    throw Error('Invalid For you layout');
  const rows: ForYouRow[] = [
    ...(!value.some((row) => row.id === 'unrated')
      ? [{ id: 'unrated' as const, enabled: true }]
      : []),
    ...value
      .filter(({ id }) => id !== 'newlyAvailable')
      .map(({ id, enabled }) => ({ id, enabled })),
    ...forYouSections
      .filter((id) => id !== 'unrated' && !value.some((row) => row.id === id))
      .map((id) => ({ id, enabled: true })),
  ];
  if (!value.some((row) => row.id === 'requested')) {
    const index = rows.findIndex((row) => row.id === 'requested');
    const [added] = rows.splice(index, 1);
    const firstList = rows.findIndex((row) =>
      ['continueLists', 'activity', 'almostFinished', 'explore'].includes(
        row.id
      )
    );
    rows.splice(firstList < 0 ? rows.length : firstList, 0, added);
  }
  if (!value.some((row) => row.id === 'unfinished')) {
    const [added] = rows.splice(
      rows.findIndex((row) => row.id === 'unfinished'),
      1
    );
    rows.splice(rows.findIndex((row) => row.id === 'requested') + 1, 0, added);
  }
  return rows;
}
