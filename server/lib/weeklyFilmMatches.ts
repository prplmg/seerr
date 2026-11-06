import { appDataPath } from '@server/utils/appDataVolume';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { ListFilm } from './discoveryLists';
// Successful identity mappings only; errors and ambiguous results are never cached.
let cache:
  | Record<string, { id: number; type: ListFilm['type']; at: number }>
  | undefined;
let dirty = 0;
const file = () => path.join(appDataPath(), 'weekly-film-matches.json');
function load() {
  if (!cache)
    cache = fs.existsSync(file())
      ? JSON.parse(fs.readFileSync(file(), 'utf8'))
      : {};
  return cache!;
}
export function weeklyFilmMatch(url: string) {
  const item = load()[url];
  return item && Date.now() - item.at < 90 * 86400000 ? item : undefined;
}
export function rememberWeeklyFilm(
  url: string,
  id: number,
  type: ListFilm['type']
) {
  load()[url] = { id, type, at: Date.now() };
  if (++dirty >= 25) flushWeeklyFilms();
}
export function flushWeeklyFilms() {
  if (!dirty || !cache) return;
  const cutoff = Date.now() - 90 * 86400000;
  cache = Object.fromEntries(
    Object.entries(cache)
      .filter(([, v]) => v.at > cutoff)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 20000)
  );
  const tmp = file() + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(cache), { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, file());
    dirty = 0;
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}
