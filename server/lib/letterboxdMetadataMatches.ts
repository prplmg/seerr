import { appDataPath } from '@server/utils/appDataVolume';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
export type MetadataMatch = {
  externalUrl: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
};
const directory = () => path.join(appDataPath(), 'letterboxd-metadata-matches');
const filename = (url: string) =>
  path.join(
    directory(),
    createHash('sha256').update(url).digest('hex') + '.json'
  );
const validUrl = (value: string) =>
  /^https:\/\/letterboxd\.com\/(?:[a-z0-9_-]+\/)?film\/[a-z0-9-]+\/(?:\d+\/)?$/i.test(
    value
  );
const validSource = (url: string) => validUrl(url) || /^https:\/\/boxd\.it\/[a-z0-9]+\/?$/i.test(url);
export function readMetadataMatch(url: string): MetadataMatch | undefined {
  if (!validSource(url)) return;
  try {
    const row = JSON.parse(fs.readFileSync(filename(url), 'utf8'));
    if (
      row &&
      validUrl(row.externalUrl) &&
      Number.isSafeInteger(row.tmdbId) &&
      row.tmdbId > 0 &&
      ['movie', 'tv'].includes(row.mediaType)
    )
      return row;
  } catch {
    /* Optional cache: corrupt/missing data falls back to resolution. */
  }
}
export function saveMetadataMatch(url: string, value: MetadataMatch) {
  if (
    !validSource(url) ||
    !validUrl(value.externalUrl) ||
    !Number.isSafeInteger(value.tmdbId) ||
    value.tmdbId <= 0 ||
    !['movie', 'tv'].includes(value.mediaType)
  )
    return;
  fs.mkdirSync(directory(), { recursive: true });
  const temp = filename(url) + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(value));
    fs.renameSync(temp, filename(url));
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
