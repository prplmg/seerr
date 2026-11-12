import { appDataPath } from '@server/utils/appDataVolume';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { getSettings } from './settings';

type Identity = {
  mediaType: string;
  tmdbId: number;
  ratingKey?: string | null;
  ratingKey4k?: string | null;
};
type Store = { version: 1; servers: Record<string, Record<string, string[]>> };
const filename = () => path.join(appDataPath(), 'plex-history-keys.json');
function read(): Store {
  if (!fs.existsSync(filename())) return { version: 1, servers: {} };
  const s = JSON.parse(fs.readFileSync(filename(), 'utf8')) as Store;
  if (s.version !== 1 || !s.servers)
    throw Error('Invalid Plex history identity store');
  return s;
}
const identity = (m: Identity) => {
  if (
    !['movie', 'tv'].includes(m.mediaType) ||
    !Number.isSafeInteger(m.tmdbId) ||
    m.tmdbId < 1
  )
    throw Error('Invalid Plex history media identity');
  return `${m.mediaType}:${m.tmdbId}`;
};
export function retainedPlexHistoryKeys(m: Identity): string[] {
  const server = getSettings().plex.machineId;
  if (!server) return [];
  const keys = read().servers[server]?.[identity(m)] || [];
  if (
    !Array.isArray(keys) ||
    keys.some((k) => typeof k !== 'string' || !/^\d+$/.test(k))
  )
    throw Error('Invalid retained Plex history keys');
  return keys;
}
// Preserve only already-associated IDs before a scanner/reset replaces them.
// No title matching, user identities, credentials or inferred watch events.
export function preservePlexHistoryKeys(m: Identity): void {
  const server = getSettings().plex.machineId;
  const keys = [m.ratingKey, m.ratingKey4k].filter(
    (k): k is string => typeof k === 'string' && /^\d+$/.test(k)
  );
  if (!server || !keys.length) return;
  const id = identity(m),
    s = read(),
    old = s.servers[server]?.[id] || [];
  const merged = [...new Set([...old, ...keys])];
  if (merged.length === old.length) return;
  s.servers[server] ||= {};
  s.servers[server][id] = merged;
  const target = filename(),
    temp = `${target}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.writeFileSync(temp, JSON.stringify(s), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, target);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
