import { createHash } from 'crypto';
import { parseStringPromise } from 'xml2js';

export type ImportedReview = {
  key: string;
  title: string;
  year: string;
  tmdbId?: number;
  mediaType?: 'movie' | 'tv';
  watched?: boolean;
  entryKind?: 'summary' | 'diary';
  explicitFields?: { rating: boolean; review: boolean };
  rating: number | null;
  text: string;
  spoiler: boolean;
  publishedAt: string;
  watchedDate: string | null;
  externalUrl: string;
};
export function parseCsvRows(csv: string): string[][] {
  if (Buffer.byteLength(csv) > 2 * 1024 * 1024) throw Error('CSV too large');
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  csv = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && csv[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw Error('Unclosed CSV field');
  row.push(field);
  if (row.some(Boolean)) rows.push(row);
  if (rows.length > 10010) throw Error('Too many entries');
  return rows;
}
export function parseCsv(csv: string, requiredHeaders = ['Name', 'Letterboxd URI']): Record<string, string>[] {
  const rows = parseCsvRows(csv);
  const headers = rows.shift();
  if (!headers || requiredHeaders.some(header => !headers.includes(header)) || new Set(headers).size !== headers.length)
    throw Error('Not a Letterboxd export');
  if (rows.length > 10000) throw Error('Too many entries');
  return rows.map((r) => {
    if (r.length !== headers.length) throw Error('Invalid CSV row');
    return Object.fromEntries(headers.map((h, i) => [h, r[i]]));
  });
}
export function ratingValue(value: unknown): number | null {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0.5 || n > 5 || !Number.isInteger(n * 2))
    throw Error('Invalid rating');
  return n;
}
export function plainReview(html: string): string {
  // Store and render plain text only; never interpolate imported HTML.
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    // HTML paragraphs are blank-line boundaries; <br> is only a line break.
    // Consume inter-tag formatting whitespace so indented feeds add no extras.
    .replace(/<\/p>\s*<p\b[^>]*>/gi, '\n\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
      const n =
        code[0].toLowerCase() === 'x'
          ? parseInt(code.slice(1), 16)
          : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_, n: string) =>
        (
          ({
            amp: '&',
            lt: '<',
            gt: '>',
            quot: '"',
            apos: "'",
            nbsp: ' ',
          }) as Record<string, string>
        )[n]
    )
    .trim()
    .slice(0, 20000);
}
export function letterboxdUrl(value: string, username?: string): string {
  const u = new URL(value);
  if (
    u.protocol !== 'https:' ||
    !['letterboxd.com', 'boxd.it'].includes(u.hostname) ||
    u.username ||
    u.password ||
    u.port
  )
    throw Error('Invalid Letterboxd URL');
  if (u.hostname === 'boxd.it' && !/^\/[a-z0-9]+\/?$/i.test(u.pathname))
    throw Error('Invalid short link');
  if (
    u.hostname === 'letterboxd.com' &&
    username &&
    !u.pathname.startsWith(`/${username}/film/`) &&
    !u.pathname.startsWith('/film/')
  )
    throw Error('Wrong Letterboxd account');
  u.search = '';
  u.hash = '';
  return u.hostname === 'boxd.it'
    ? u.href.replace(/\/$/, '')
    : u.href.replace(/\/?$/, '/');
}
function date(value: string): string {
  const d = new Date(value);
  if (!value || !Number.isFinite(d.getTime()))
    throw Error('Missing or invalid date');
  return d.toISOString();
}
export function importKey(url: string, watchedDate: string | null) {
  const identity = letterboxdEntryIdentity(url);
  return createHash('sha256')
    .update(identity || `${url}|${watchedDate || ''}`)
    .digest('hex');
}
// A member entry permalink identifies a viewing; a film page does not.
// Preserve numbered rewatch suffixes and never use a watch date as an entry ID.
export function letterboxdEntryIdentity(value: string): string | null {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'letterboxd.com' ||
    url.username ||
    url.password ||
    url.port
  )
    return null;
  const match = url.pathname.match(
    /^\/([a-zA-Z0-9_]+)\/film\/([a-z0-9-]+|film:[1-9][0-9]*)(?:\/([1-9][0-9]*))?\/?$/
  );
  return match
    ? `https://letterboxd.com/${match[1].toLowerCase()}/film/${match[2]}/${match[3] ? match[3] + '/' : ''}`
    : null;
}
export function csvReviews(
  csv: string,
  username: string,
  kind = 'auto'
): ImportedReview[] {
  return parseCsv(csv)
    .filter(
      (r) =>
        kind === 'watched.csv' ||
        kind === 'diary.csv' ||
        r['Watched Date'] ||
        r.Review?.trim() ||
        r.Rating?.trim()
    )
    .map((r) => {
      if (r.Private === 'Yes' || r.Deleted === 'Yes')
        throw Error('Private/deleted exports are not supported');
      const externalUrl = letterboxdUrl(r['Letterboxd URI'], username),
        watchedDate = r['Watched Date'] || null;
      if (
        watchedDate &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(watchedDate) ||
          date(watchedDate).slice(0, 10) !== watchedDate)
      )
        throw Error('Invalid watched date');
      return {
        key: importKey(externalUrl, watchedDate),
        title: r.Name,
        year: r.Year || '',
        rating: ratingValue(r.Rating),
        text: plainReview(r.Review || ''),
        spoiler: /^(yes|true|1)$/i.test(
          r['Contains Spoilers'] || r.Spoilers || ''
        ),
        publishedAt: date(r.Date || watchedDate || ''),
        watchedDate,
        watched: true,
        entryKind:
          watchedDate || r.Review?.trim()
            ? ('diary' as const)
            : ('summary' as const),
        externalUrl,
      };
    });
}
export async function rssReviews(
  xml: string,
  username: string
): Promise<ImportedReview[]> {
  if (
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    Buffer.byteLength(xml) > 2 * 1024 * 1024
  )
    throw Error('Invalid feed');
  const parsed = await parseStringPromise(xml, {
    explicitArray: false,
    trim: true,
  });
  if (!parsed.rss?.channel) throw Error('Invalid feed');
  const raw = parsed.rss.channel.item;
  const items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
  return items.flatMap((item): ImportedReview[] => {
    if (!item['letterboxd:filmTitle']) return [];
    const externalUrl = letterboxdUrl(item.link, username);
    const watchedDate = item['letterboxd:watchedDate'] || null;
    let description = String(item.description || '')
      .replace(/<p>\s*<img[\s\S]*?<\/p>/i, '')
      .replace(/<p>\s*(?:Watched|Rewatched) on [^<\n]+\.<\/p>/i, '');
    // RSS prepends this UI warning to spoiler reviews. Remove only the exact
    // leading warning paragraph, before text comparison/reconciliation; retain
    // the spoiler flag independently and never strip matching prose elsewhere.
    const leadingParagraph = /^\s*<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(description);
    const spoilerWarning =
      !!leadingParagraph &&
      leadingParagraph[1]
        .replace(/<\/?(?:em|strong|b|i)\b[^>]*>/gi, '')
        .trim() === 'This review may contain spoilers.';
    if (spoilerWarning)
      description = description.slice(leadingParagraph![0].length);
    const text = plainReview(description),
      rating = ratingValue(
        Number(item['letterboxd:memberRating']) === 0
          ? null
          : item['letterboxd:memberRating']
      );
    const explicitFields = {
      rating: Object.prototype.hasOwnProperty.call(
        item,
        'letterboxd:memberRating'
      ),
      review: Object.prototype.hasOwnProperty.call(item, 'description'),
    };
    if (
      !text &&
      rating === null &&
      !watchedDate &&
      !explicitFields.rating &&
      !explicitFields.review
    )
      return [];
    const tmdbId = Number(item['tmdb:movieId'] || item['tmdb:tvId']);
    return [
      {
        key: importKey(externalUrl, watchedDate),
        explicitFields,
        title: String(item['letterboxd:filmTitle']),
        year: String(item['letterboxd:filmYear'] || ''),
        tmdbId: Number.isSafeInteger(tmdbId) && tmdbId > 0 ? tmdbId : undefined,
        mediaType: item['tmdb:tvId'] && !item['tmdb:movieId'] ? 'tv' : 'movie',
        rating,
        text,
        spoiler:
          spoilerWarning ||
          /spoiler/i.test(text) ||
          String(item['letterboxd:spoilers']) === 'true',
        publishedAt: date(item.pubDate),
        watchedDate,
        watched: true,
        entryKind: 'diary',
        externalUrl,
      },
    ];
  });
}
