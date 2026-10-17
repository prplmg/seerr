import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';
import * as parser from './letterboxdImport';

function harness() {
  const rows = new Map<string, any>();
  const account: any = { userId: 1, username: 'prplmg', enabled: true };
  class MovieReview {}
  class LetterboxdAccount {}
  const repo = {
    findOneBy: async ({ id }: { id: string }) => rows.get(id),
    create: (entry: any) => entry,
    save: async (entry: any) => {
      rows.set(entry.id, { ...entry });
    },
  };
  const source = ts.transpileModule(
    readFileSync(path.join(__dirname, 'reviews.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }
  ).outputText;
  const exports: any = {};
  new Function('require', 'exports', source)((name: string) => {
    if (name === '@server/lib/letterboxdImport') return parser;
    if (name === '@server/entity/MovieReview')
      return { MovieReview, LetterboxdAccount };
    if (name === '@server/datasource')
      return {
        getRepository: (entity: any) =>
          entity === MovieReview
            ? repo
            : {
                findOneBy: async () => account,
                update: async (_where: any, values: any) =>
                  Object.assign(account, values),
              },
      };
    if (name === 'axios')
      return {
        get: async () => {
          throw Error('RSS offline');
        },
        head: async () => ({
          headers: {
            location: 'https://letterboxd.com/prplmg/film/citizen-kane/',
          },
        }),
      };
    return {};
  }, exports);
  return { api: exports, rows, account };
}
const entry: parser.ImportedReview = {
  key: 'stable',
  title: 'Citizen Kane',
  year: '1941',
  rating: 4.5,
  text: 'Original review',
  spoiler: false,
  externalUrl: 'https://letterboxd.com/prplmg/film/citizen-kane/',
  watchedDate: '2026-02-06',
  publishedAt: '2026-02-07T00:00:00.000Z',
};
it('repeat imports do not duplicate or overwrite reviews; RSS updates preserve publication dates', async () => {
  const { api, rows } = harness();
  await api.saveImported(1, entry, 15, false);
  await api.saveImported(1, { ...entry, text: 'Old export' }, 15, false);
  assert.equal(rows.size, 1);
  assert.equal(rows.get('letterboxd:1:stable').text, entry.text);
  const timestamp = rows.get('letterboxd:1:stable').updatedAt;
  await api.saveImported(1, entry, 15);
  assert.equal(rows.get('letterboxd:1:stable').updatedAt, timestamp);
  await api.saveImported(1, { ...entry, text: 'Edited on Letterboxd' }, 15);
  assert.equal(rows.get('letterboxd:1:stable').text, 'Edited on Letterboxd');
  assert.equal(rows.get('letterboxd:1:stable').publishedAt, entry.publishedAt);
});
it('RSS failure preserves existing entries and records a recoverable error', async () => {
  const { api, rows, account } = harness();
  await api.saveImported(1, entry, 15);
  await api.syncReviews(1);
  assert.equal(rows.size, 1);
  assert.equal(account.error, 'unavailable');
  assert.ok(account.lastAttempt);
});
it('short-link expansion creates the same identity as a canonical review and rejects another account', async () => {
  const { api } = harness();
  const short = { ...entry, externalUrl: 'https://boxd.it/d1yWHj' };
  await api.expandReviewLink(short, 'prplmg');
  assert.equal(short.externalUrl, entry.externalUrl);
  assert.equal(
    short.key,
    parser.importKey(entry.externalUrl, entry.watchedDate)
  );
  await assert.rejects(
    api.expandReviewLink(
      { ...entry, externalUrl: 'https://boxd.it/d1yWHj' },
      'other'
    ),
    /Wrong Letterboxd account/
  );
});
it('serializes import and sync operations for the same account', async () => {
  const { api } = harness();
  const steps: number[] = [];
  await Promise.all([
    api.withReviewLock(1, async () => {
      steps.push(1);
      await Promise.resolve();
      steps.push(2);
    }),
    api.withReviewLock(1, async () => {
      steps.push(3);
    }),
  ]);
  assert.deepEqual(steps, [1, 2, 3]);
});
