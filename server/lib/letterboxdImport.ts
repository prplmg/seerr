import { createHash } from 'crypto';
import { parseStringPromise } from 'xml2js';

export type ImportedReview = {
  key: string;
  title: string;
  year: string;
  tmdbId?: number;
  rating: number | null;
  text: string;
  spoiler: boolean;
  publishedAt: string;
  watchedDate: string | null;
  externalUrl: string;
};
export function parseCsv(csv: string): Record<string, string>[] {
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
  const headers = rows.shift();
  if (!headers?.includes('Name') || !headers.includes('Letterboxd URI'))
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
    .replace(/<br\s*\/?\s*>|<\/p>/gi, '\n')
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
  return createHash('sha256')
    .update(`${url}|${watchedDate || ''}`)
    .digest('hex');
}
export function csvReviews(csv: string, username: string): ImportedReview[] {
  return parseCsv(csv)
    .filter((r) => r.Review?.trim() || r.Rating?.trim())
    .map((r) => {
      if (r.Private === 'Yes' || r.Deleted === 'Yes')
        throw Error('Private/deleted exports are not supported');
      const externalUrl = letterboxdUrl(r['Letterboxd URI'], username),
        watchedDate = r['Watched Date'] || null;
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
    const description = String(item.description || '')
      .replace(/<p>\s*<img[\s\S]*?<\/p>/i, '')
      .replace(/<p>\s*(?:Watched|Rewatched) on [^<\n]+\.<\/p>/i, '');
    const text = plainReview(description),
      rating = ratingValue(
        Number(item['letterboxd:memberRating']) === 0
          ? null
          : item['letterboxd:memberRating']
      );
    if (!text && rating === null) return [];
    const tmdbId = Number(item['tmdb:movieId']);
    return [
      {
        key: importKey(externalUrl, watchedDate),
        title: String(item['letterboxd:filmTitle']),
        year: String(item['letterboxd:filmYear'] || ''),
        tmdbId: Number.isSafeInteger(tmdbId) && tmdbId > 0 ? tmdbId : undefined,
        rating,
        text,
        spoiler:
          /spoiler/i.test(text) ||
          String(item['letterboxd:spoilers']) === 'true',
        publishedAt: date(item.pubDate),
        watchedDate,
        externalUrl,
      },
    ];
  });
}
