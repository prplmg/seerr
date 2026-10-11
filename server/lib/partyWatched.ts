import { appDataPath } from '@server/utils/appDataVolume';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
type Row = { userId: number; tmdbId: number; mediaType: string; stamp: number };
let cached: Row[] = [];
let until = 0;
let pending: Promise<Row[]> | undefined;
// Raw identities only; callers must apply current visibility policy and users.
export async function partyWatched(): Promise<Row[]> {
  if (until > Date.now()) return cached;
  if (pending) return pending;
  pending = (async () => {
    try {
      const cfg = JSON.parse(
        fs
          .readFileSync(path.join(appDataPath(), 'watch-party.json'), 'utf8')
          .replace(/^\uFEFF/, '')
      );
      if (!cfg.enabled) return [];
      const result = await axios.get(
        `${cfg.relayUrl.replace(/\/$/, '')}/catalogue/watched`,
        {
          timeout: 5000,
          maxRedirects: 0,
          headers: { Authorization: `Bearer ${cfg.secret}` },
        }
      );
      if (!Array.isArray(result.data)) throw Error('Invalid history');
      cached = result.data.filter(
        (r: Row) =>
          Number.isSafeInteger(r.userId) &&
          Number.isSafeInteger(r.tmdbId) &&
          ['movie', 'tv'].includes(r.mediaType) &&
          Number.isFinite(r.stamp)
      );
    } catch {
      /* Keep the last successful snapshot during relay restarts. */
    }
    until = Date.now() + 15000;
    return cached;
  })();
  try {
    return await pending;
  } finally {
    pending = undefined;
  }
}
