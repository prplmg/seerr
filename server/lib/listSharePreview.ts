import TheMovieDb from '@server/api/themoviedb';
import {
  catalogueOrigin,
  listSharePath,
} from '@server/interfaces/api/listShare';
import axios from 'axios';
import sharp from 'sharp';
import path from 'path';
import type { ListStore } from './discoveryLists';
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!
  );
export function listPreview(store: ListStore, id: string) {
  const list = store.lists.find(
    (l) =>
      l.id === id && l.source === 'catalogue' && !l.deletedAt && !l.unavailable
  );
  if (!list) return null;
  const publicList = list.visibility === 'public';
  return {
    id,
    publicList,
    revision: list.checkedAt,
    title: publicList ? list.title : 'A list has been shared with you',
    subtitle: publicList
      ? `${list.creator} · ${list.items.length} movies`
      : '',
    // Never expose private metadata or movie IDs to the image renderer.
    films: publicList ? list.items.slice(0, 4) : [],
  };
}
export type ListPreview = NonNullable<ReturnType<typeof listPreview>>;
export function listPreviewHtml(p: ListPreview) {
  const url = catalogueOrigin + listSharePath(p.id);
  const image = `${url}/image?v=3-${p.revision}`;
  const title = escapeHtml(p.title),
    subtitle = escapeHtml(p.subtitle);
  const login = '/login?next=' + encodeURIComponent('/lists/' + p.id);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title} · Multimeldia</title><meta property="og:type" content="website"><meta property="og:site_name" content="Multimeldia"><meta property="og:title" content="${title}"><meta property="og:description" content="${subtitle ? subtitle + ' · ' : ''}Sign in to view this list."><meta property="og:url" content="${url}"><meta property="og:image" content="${image}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${p.publicList ? 'Movie posters from this list' : 'Multimeldia shared list'}"><meta name="twitter:card" content="summary_large_image"><style>*{box-sizing:border-box}body{margin:0;background:#101725;color:#f3f4f6;font-family:system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}main{width:100%;max-width:720px}.brand{color:#d8b4fe;font-weight:750;font-size:24px;margin-bottom:24px;display:flex;align-items:center;gap:12px}.brand img{width:240px;max-width:100%;height:auto}.card{overflow:hidden;border:1px solid #475166;border-radius:24px;background:#202938}.cover{display:block;width:100%;aspect-ratio:1200/630;object-fit:cover}.body{padding:28px}h1{font-size:clamp(25px,5vw,36px);line-height:1.15;margin:0 0 12px;overflow-wrap:anywhere}.by{color:#d8b4fe;margin:0 0 24px}p{color:#b5bdca;line-height:1.6}.button{display:block;text-align:center;background:linear-gradient(110deg,#7c3aed,#a52ce3);border-radius:999px;padding:14px 24px;color:white;text-decoration:none;font-weight:650;margin-top:24px}.note{font-size:13px;text-align:center;margin-bottom:0}</style></head><body><main><div class="brand"><img src="/logo_full.svg" alt="Multimeldia"></div><article class="card"><img class="cover" src="${listSharePath(p.id)}/image?v=3-${p.revision}" alt="${p.publicList ? 'Movie posters from this list' : 'Multimeldia shared list'}"><div class="body"><h1>${title}</h1>${p.publicList ? `<p class="by">${subtitle}</p>` : ''}<p>${p.publicList ? 'Sign in to see the movies and save this list.' : 'Sign in with an account that has access to explore this list.'}</p><a class="button" href="${login}">Sign in to view list</a><p class="note">A Multimeldia account is required.</p></div></article></main></body></html>`;
}
const cache = new Map<string, { until: number; image: Buffer }>();
const pending = new Map<string, Promise<Buffer>>();
const baseSvg = (generic: boolean) =>
  Buffer.from(
    `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="b" x2="1" y2="1"><stop stop-color="#302346"/><stop offset="1" stop-color="#101725"/></linearGradient></defs><rect width="1200" height="630" fill="url(#b)"/><circle cx="1100" cy="50" r="330" fill="#a78bfa" opacity=".09"/>${generic ? '<g transform="translate(-235 0)" fill="#352948" stroke="#b28ad8" stroke-width="3"><rect x="790" y="160" width="190" height="280" rx="22" transform="rotate(12 885 300)"/><rect x="740" y="150" width="190" height="280" rx="22" transform="rotate(-9 835 290)"/><rect x="690" y="155" width="190" height="280" rx="22"/></g>' : ''}</svg>`
  );
let logoImage: Promise<Buffer> | undefined;
function previewLogo() {
  return (logoImage ??= sharp(path.resolve(__dirname, '../../public/logo_full.svg'))
    .resize({ width: 380 }).png().toBuffer());
}
let genericImage: Promise<Buffer> | undefined;
function genericThumbnail() {
  return (genericImage ??= previewLogo().then((input) =>
    sharp(baseSvg(true)).composite([{ input, left: 64, top: 40 }]).png().toBuffer()
  ));
}
export async function listPreviewImage(p: ListPreview): Promise<Buffer> {
  if (!p.publicList) return genericThumbnail();
  const key = `${p.id}:${p.revision}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.image;
  const existing = pending.get(key);
  if (existing) return existing;
  // Limit unauthenticated image generation; overload receives a generic image.
  if (pending.size >= 2) return genericThumbnail();
  const run = (async () => {
    const tmdb = new TheMovieDb();
    const images = await Promise.all(
      p.films.map(async (film) => {
        try {
          const movie = await tmdb.getListMovie(film.tmdbId);
          if (
            !movie.poster_path ||
            !/^\/[a-zA-Z0-9._-]+$/.test(movie.poster_path)
          )
            return null;
          const response = await axios.get<ArrayBuffer>(
            `https://image.tmdb.org/t/p/w342${movie.poster_path}`,
            {
              responseType: 'arraybuffer',
              timeout: 4000,
              maxContentLength: 3 * 1024 * 1024,
            }
          );
          return await sharp(Buffer.from(response.data))
            .resize(228, 342, { fit: 'cover' })
            .png()
            .toBuffer();
        } catch {
          return null; // Unavailable posters never prevent sharing.
        }
      })
    );
    const posters = images.filter((image): image is Buffer => !!image);
    const image = await sharp(baseSvg(!posters.length))
      .composite([
        { input: await previewLogo(), left: 64, top: 40 },
        ...posters.map((input, i) => ({
          input,
          left:
            Math.round(
              (1200 - (posters.length * 228 + (posters.length - 1) * 36)) / 2
            ) +
            i * 264,
          top: 155,
        }))
      ])
      .png()
      .toBuffer();
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(key, { image, until: Date.now() + 3600000 });
    return image;
  })();
  pending.set(key, run);
  try {
    return await run;
  } finally {
    pending.delete(key);
  }
}
