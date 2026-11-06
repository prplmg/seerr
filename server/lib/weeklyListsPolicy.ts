// Pure policy shared by the scheduler and read-only browser delivery.
export const WEEKLY_LIST_MAX = 560;
export const WEEK = 7 * 86400000;
export const weeklyDiscoveryPages = [
  '',
  'this/week/',
  'this/month/',
  'this/year/',
].flatMap((category) =>
  [1, 2].map(
    (page) =>
      `https://letterboxd.com/lists/popular/${category}${page === 1 ? '' : 'page/2/'}`
  )
);
export function weeklyClock(now = Date.now()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Merida',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return {
    day: parts.weekday,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}
export function weeklyWindow(now = Date.now()) {
  const { minute } = weeklyClock(now);
  return minute >= 440 && minute < 520;
}
export function discoveryListUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  if (
    !/^https:\/\/letterboxd\.com\/[a-z0-9_]+\/list\/(?:[a-z0-9-]+|filmlist:[1-9][0-9]*)\/$/i.test(
      value
    )
  )
    return;
  const url = value.toLowerCase();
  if (
    [
      'https://letterboxd.com/o_zero/list/short-films-on-youtube/',
      'https://letterboxd.com/evegrissel/list/20-underseen-erotic-thrillers-1/',
    ].includes(url)
  )
    return;
  return url;
}
export type ListCandidate = { url: string; title: string; total: number };
export function validateDiscoverySnapshot(
  value: unknown,
  url: string
): ListCandidate[] {
  const s = value as {
    url: string;
    anonymous: boolean;
    complete: boolean;
    candidates: ListCandidate[];
  };
  if (
    !weeklyDiscoveryPages.includes(url) ||
    !s ||
    s.url !== url ||
    s.anonymous !== true ||
    s.complete !== true ||
    !Array.isArray(s.candidates) ||
    !s.candidates.length ||
    s.candidates.length > 100
  )
    throw Error('Incomplete discovery page');
  const result: ListCandidate[] = [];
  for (const c of s.candidates) {
    if (
      !c ||
      typeof c.title !== 'string' ||
      c.title.length > 500 ||
      !Number.isSafeInteger(c.total) ||
      c.total < 0 ||
      c.total > 1000000
    )
      throw Error('Invalid discovery candidate');
    const canonical = discoveryListUrl(c.url);
    if (!canonical) {
      // Blacklisted lists are valid evidence, but never admission candidates.
      if (
        typeof c.url !== 'string' ||
        !/^https:\/\/letterboxd\.com\//.test(c.url)
      )
        throw Error('Invalid discovery URL');
      continue;
    }
    result.push({ ...c, url: canonical });
  }
  return result;
}
