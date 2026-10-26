import logger from '@server/logger';
import axios from 'axios';
import { parsePublicListPage, publicListExportLink } from './discoveryListPage';
import {
  listId,
  readListStore,
  replaceList,
  updateListStore,
  type DiscoveryList,
  type ListFilm,
  type UnmatchedListFilm,
} from './discoveryLists';
import { popularListUrls } from './discoveryPopularLists';
import { readLetterboxdArchive } from './letterboxdArchive';
import { parseExportSnapshot } from './letterboxdExportSnapshot';
import { parseCsv, parseCsvRows, plainReview } from './letterboxdImport';
import { fetchLetterboxd, resolveReview } from './reviews';

export function safeListUrl(value: string, short = false) {
  const u = new URL(value);
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.port ||
    u.search ||
    u.hash ||
    (!(
      u.hostname === 'letterboxd.com' &&
      /^\/[a-z0-9_]+\/list\/[a-z0-9-]+\/$/i.test(u.pathname)
    ) &&
      !(
        short &&
        u.hostname === 'boxd.it' &&
        /^\/[a-z0-9]+\/?$/i.test(u.pathname)
      ))
  )
    throw Error('Use a Letterboxd list URL');
  return u.href;
}
export function parseOwnedList(csv: string, account: string) {
  const rows = parseCsvRows(csv);
  if (rows[0]?.[0] !== 'Letterboxd list export v7')
    throw Error('Unsupported list export');
  const headers = rows[1],
    values = rows[2],
    films = rows[3];
  if (
    !headers ||
    !values ||
    headers.length !== values.length ||
    headers.join(',') !== 'Date,Name,Tags,URL,Description' ||
    films?.join(',') !== 'Position,Name,Year,URL,Description'
  )
    throw Error('Invalid list schema');
  const meta = Object.fromEntries(headers.map((h, i) => [h, values[i]]));
  const url = safeListUrl(meta.URL, true);
  if (
    new URL(url).hostname === 'letterboxd.com' &&
    new URL(url).pathname.split('/')[1].toLowerCase() !== account.toLowerCase()
  )
    throw Error('Wrong list owner');
  const items = rows.slice(4).map((r, i) => {
    if (
      r.length !== 5 ||
      Number(r[0]) !== i + 1 ||
      !/^https:\/\/(?:letterboxd\.com\/film\/(?:[a-z0-9-]+|film:[1-9][0-9]*)\/|boxd\.it\/[a-zA-Z0-9]+\/?)$/.test(
        r[3]
      )
    )
      throw Error('Invalid list item');
    return { title: r[1], year: r[2], url: r[3], note: plainReview(r[4]) };
  });
  return {
    title: plainReview(meta.Name),
    description: plainReview(meta.Description),
    url,
    items,
  };
}
async function canonicalOwnedList(
  parsed: ReturnType<typeof parseOwnedList>,
  account: string
) {
  if (new URL(parsed.url).hostname === 'boxd.it') {
    const response = await axios.head(parsed.url, {
      timeout: 10000,
      maxRedirects: 0,
      validateStatus: (status) => status === 301 || status === 302,
    });
    parsed.url = safeListUrl(String(response.headers.location));
  }
  if (
    new URL(parsed.url).pathname.split('/')[1].toLowerCase() !==
    account.toLowerCase()
  )
    throw Error('Wrong list owner');
  return parsed;
}
async function resolveFilms(
  rows: { title: string; year: string; url: string; note: string }[],
  unmatched?: UnmatchedListFilm[]
) {
  const items: ListFilm[] = [];
  for (const row of rows) {
    const entry = {
      key: row.url,
      title: row.title,
      year: row.year,
      externalUrl: row.url,
      rating: null,
      text: '',
      spoiler: false,
      publishedAt: '1970-01-01T00:00:00Z',
      watchedDate: null,
      mediaType: 'movie' as 'movie' | 'tv',
    };
    const tmdbId = await resolveReview(entry);
    if (!tmdbId && unmatched) {
      // Only explicit invalid TMDB identities qualify. Network/challenge failures
      // still retain the previous snapshot, rather than silently losing matches.
      const html = await fetchLetterboxd(row.url);
      if (
        !/cf-chl-|Just a moment/i.test(html) &&
        /themoviedb\.org\/(?:movie|tv)\/0\//i.test(html)
      ) {
        unmatched.push({ ...row, position: rows.indexOf(row) + 1 });
        continue;
      }
    }
    if (!tmdbId)
      throw Error(
        `List contains an unresolved film: ${row.url}; previous snapshot retained`
      );
    items.push({ tmdbId, type: entry.mediaType, note: row.note });
  }
  return items;
}
// No cookies or arbitrary redirect targets: an anonymous read is public evidence.
async function publicGet(value: string, short = false) {
  let url = safeListUrl(value, short);
  for (let redirects = 0; redirects < 4; redirects++) {
    const response = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 0,
      maxContentLength: 2 * 1024 * 1024,
      validateStatus: (s) => s === 200 || [301, 302, 303, 307, 308].includes(s),
      responseType: 'text',
    });
    if (response.status === 200) return { url, html: String(response.data) };
    url = safeListUrl(new URL(response.headers.location, url).href, true);
  }
  throw Error('Too many list redirects');
}
export async function importPublicList(value: string) {
  const { url, html } = await publicGet(value, true),
    canonical = safeListUrl(url);
  // No authenticated scraping; canonical/count evidence or a matching linked CSV
  // must verify the public snapshot below. Challenges never become empty lists.
  if (/cf-chl-|Just a moment|This list is private/i.test(html))
    throw Error('Public list could not be verified');
  const exportUrl = publicListExportLink(html, canonical);
  let parsed: ReturnType<typeof parseOwnedList>;
  if (exportUrl) {
    const response = await axios.get(exportUrl, {
      timeout: 15000,
      maxRedirects: 0,
      maxContentLength: 2 * 1024 * 1024,
      responseType: 'text',
    });
    parsed = await canonicalOwnedList(
      parseOwnedList(
        String(response.data),
        new URL(canonical).pathname.split('/')[1]
      ),
      new URL(canonical).pathname.split('/')[1]
    );
  } else {
    let page = parsePublicListPage(html, canonical),
      current = canonical;
    parsed = {
      title: page.title,
      description: page.description,
      url: canonical,
      items: [],
    };
    const total = page.total,
      visited = new Set<string>(),
      films = new Set<string>();
    let bytes = Buffer.byteLength(html);
    for (;;) {
      if (visited.has(current) || visited.size >= 100 || page.total !== total)
        throw Error('List changed or pagination limit reached');
      visited.add(current);
      for (const row of page.items) {
        if (films.has(row.url)) throw Error('Duplicate film across pages');
        films.add(row.url);
        parsed.items.push(row);
      }
      if (!page.next) break;
      current = page.next;
      const response = await axios.get(current, {
        timeout: 10000,
        maxRedirects: 0,
        maxContentLength: 2 * 1024 * 1024,
        responseType: 'text',
      });
      bytes += Buffer.byteLength(String(response.data));
      if (bytes > 8 * 1024 * 1024)
        throw Error('Public list response budget exceeded');
      page = parsePublicListPage(String(response.data), canonical, current);
    }
    if (parsed.items.length !== total)
      throw Error('Incomplete list pagination');
  }
  if (parsed.url !== canonical) throw Error('Export list identity changed');
  return applyPublicList(value, parsed);
}
export async function applyPublicList(
  value: string,
  parsed: ReturnType<typeof parseOwnedList>
) {
  const canonical = safeListUrl(parsed.url);
  const unmatched: UnmatchedListFilm[] = [];
  const items = await resolveFilms(parsed.items, unmatched),
    now = Date.now();
  const next: DiscoveryList = {
    id: listId(canonical),
    url: canonical,
    title: parsed.title,
    description: parsed.description,
    creator: new URL(canonical).pathname.split('/')[1],
    source: 'letterboxd',
    visibility: 'public',
    checkedAt: now,
    items,
    unmatched,
    history: [],
  };
  updateListStore((s) => {
    const old =
      s.lists.find((l) => l.id === next.id) ||
      s.lists.find((l) => l.url === value);
    if (
      old?.ownerId &&
      old.creator.toLowerCase() === next.creator.toLowerCase()
    )
      next.ownerId = old.ownerId;
    if (old && old.id !== next.id) {
      // A verified public redirect is canonicalization, not a second list.
      s.lists = s.lists.filter((l) => l.id !== old.id);
      s.lists.push({ ...old, id: next.id, url: canonical });
      for (const user of Object.keys(s.saved))
        s.saved[user] = [
          ...new Set(s.saved[user].map((id) => (id === old.id ? next.id : id))),
        ];
    }
    replaceList(s, next, now);
    for (const user of Object.keys(s.liked))
      s.liked[user] = [
        ...new Set(
          s.liked[user].map((ref) => (ref === value ? canonical : ref))
        ),
      ];
  });
  return next.id;
}
export async function importDiscoveryExport(
  userId: number,
  account: string,
  encoded: string,
  capturedAt: number
) {
  const files = await readLetterboxdArchive(encoded);
  parseExportSnapshot(files, account);
  const parsed = [...files]
    .filter(([f]) => f.startsWith('lists/'))
    .map(([, csv]) => parseOwnedList(csv, account));
  const likes = files.has('likes/lists.csv')
    ? parseCsv(files.get('likes/lists.csv')!, ['Date', 'Content']).map((r) =>
        safeListUrl(r.Content, true)
      )
    : null;
  const next: DiscoveryList[] = [];
  for (const raw of parsed) {
    const p = await canonicalOwnedList(raw, account);
    next.push({
      id: listId(p.url),
      url: p.url,
      title: p.title,
      description: p.description,
      creator: account,
      ownerId: userId,
      source: 'letterboxd',
      visibility: 'unknown',
      checkedAt: capturedAt,
      items: await resolveFilms(p.items),
      history: [],
    });
  }
  updateListStore((s) => {
    if (capturedAt <= (s.exportTimes?.[userId] || 0)) return;
    for (const old of s.lists.filter(
      (l) =>
        l.source === 'letterboxd' &&
        l.ownerId === userId &&
        l.checkedAt <= capturedAt
    ))
      if (!next.some((l) => l.id === old.id)) old.unavailable = true;
    for (const l of next) replaceList(s, l, capturedAt);
    // References are private and resolved separately, never inferred as ownership.
    if (likes) s.liked[userId] = likes;
    s.exportTimes = { ...s.exportTimes, [userId]: capturedAt };
  });
}
let refreshing = false;
export async function refreshDiscoveryLists() {
  if (refreshing) return;
  refreshing = true;
  try {
    const store = readListStore(),
      urls = new Set<string>(popularListUrls);
    for (const ids of Object.values(store.saved))
      for (const id of ids) {
        const l = store.lists.find((l) => l.id === id);
        if (l?.url) urls.add(l.url);
      }
    for (const refs of Object.values(store.liked))
      for (const ref of refs) urls.add(ref);
    for (const l of store.lists) if (l.ownerId && l.url) urls.add(l.url);
    const ordered = [...urls].sort(),
      start = (store.refreshCursor || 0) % Math.max(1, ordered.length);
    const batch = [...ordered.slice(start), ...ordered.slice(0, start)].slice(
      0,
      20
    );
    let succeeded = 0;
    if (batch.length)
      logger.info('Public list refresh started', {
        label: 'Discovery lists',
        count: batch.length,
      });
    for (const url of batch) {
      try {
        await importPublicList(url);
        succeeded++;
      } catch {
        updateListStore((s) => {
          const l = s.lists.find((l) => l.url === url);
          if (l) {
            l.visibility = 'unknown';
            if (!l.ownerId) l.unavailable = true;
          }
        });
        try {
          const { queueBrowserList } = await import('./discoveryBrowser');
          queueBrowserList(url);
        } catch {
          /* A missing worker must not disrupt core reconciliation. */
        }
      }
    }
    if (batch.length) {
      updateListStore((s) => {
        s.refreshCursor = (start + batch.length) % ordered.length;
      });
      logger.info('Public list refresh completed', {
        label: 'Discovery lists',
        succeeded,
        retained: batch.length - succeeded,
      });
    }
  } finally {
    refreshing = false;
  }
}
