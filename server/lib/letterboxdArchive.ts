import { fromBuffer } from 'yauzl';
import { csvReviews, type ImportedReview } from './letterboxdImport';

const allowed = new Set([
  'reviews.csv',
  'ratings.csv',
  'watched.csv',
  'diary.csv',
  'profile.csv',
  'watchlist.csv',
  'deleted/diary.csv',
  'deleted/reviews.csv',
  'orphaned/diary.csv',
  'orphaned/reviews.csv',
]);
// Read only root export files, in memory; never extract paths onto the server.
export async function readLetterboxdArchive(encoded: string): Promise<Map<string, string>> {
  if (
    encoded.length > 14 * 1024 * 1024 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    throw Error('Invalid ZIP');
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.length > 10 * 1024 * 1024) throw Error('ZIP too large');
  const files = await new Promise<Map<string, string>>((resolve, reject) => {
    fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) return reject(error || Error('Invalid ZIP'));
        const files = new Map<string, string>();
        let count = 0,
          declared = 0,
          actual = 0;
        const fail = (e: Error) => {
          zip.close();
          reject(e);
        };
        zip.on('error', fail);
        zip.on('end', () => resolve(files));
        zip.on('entry', (entry) => {
          declared += entry.uncompressedSize;
          if (
            ++count > 500 ||
            declared > 32 * 1024 * 1024 ||
            entry.generalPurposeBitFlag & 1
          )
            return fail(Error('Unsafe ZIP'));
          if (!allowed.has(entry.fileName) && entry.fileName !== 'likes/lists.csv' && !/^lists\/[^/\\]+\.csv$/.test(entry.fileName)) {
            zip.readEntry();
            return;
          }
          if (
            files.has(entry.fileName) ||
            entry.uncompressedSize > 2 * 1024 * 1024
          )
            return fail(Error('Duplicate or oversized CSV'));
          zip.openReadStream(entry, (err, stream) => {
            if (err || !stream) return fail(err || Error('Invalid ZIP entry'));
            const chunks: Buffer[] = [];
            let size = 0;
            stream.on('error', fail);
            stream.on('data', (chunk: Buffer) => {
              size += chunk.length;
              actual += chunk.length;
              if (size > 2 * 1024 * 1024 || actual > 8 * 1024 * 1024) {
                stream.destroy();
                fail(Error('Archive expansion limit'));
                return;
              }
              chunks.push(chunk);
            });
            stream.on('end', () => {
              files.set(entry.fileName, Buffer.concat(chunks).toString('utf8'));
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      }
    );
  });
  if (!files.size) throw Error('No supported export files');
  return files;
}
export async function archiveReviews(encoded: string, username: string): Promise<ImportedReview[]> {
  const files = await readLetterboxdArchive(encoded);
  if (!['reviews.csv', 'diary.csv', 'ratings.csv', 'watched.csv'].some(name => files.has(name)))
    throw Error('No supported export files');
  // Written reviews precede diary records so imports enrich rather than erase text.
  const entries = [
    'reviews.csv',
    'diary.csv',
    'ratings.csv',
    'watched.csv',
  ].flatMap((name) =>
    files.has(name) ? csvReviews(files.get(name)!, username, name) : []
  );
  if (entries.length > 10000) throw Error('Too many entries');
  return entries;
}
