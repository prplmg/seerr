/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';
const realRequire = createRequire(__filename);
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plex-history-'));
  const settings = { plex: { machineId: 'server-a' } };
  const load = () => {
    const exports: any = {};
    const code = ts.transpileModule(
      fs.readFileSync(path.join(__dirname, 'plexHistoryKeys.ts'), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      }
    ).outputText;
    new Function('require', 'exports', code)(
      (name: string) =>
        name === './settings'
          ? { getSettings: () => settings }
          : name === '@server/utils/appDataVolume'
            ? { appDataPath: () => dir }
            : realRequire(name),
      exports
    );
    return exports;
  };
  return {
    dir,
    settings,
    load,
    close: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
it('preserves movie and series history through ID replacement, clearing and process reload', () => {
  const f = fixture();
  try {
    for (const mediaType of ['movie', 'tv']) {
      const m = { mediaType, tmdbId: 123, ratingKey: '10', ratingKey4k: '20' };
      f.load().preservePlexHistoryKeys(m);
      m.ratingKey = '30';
      m.ratingKey4k = '40';
      f.load().preservePlexHistoryKeys(m);
      m.ratingKey = '';
      m.ratingKey4k = '';
      f.load().preservePlexHistoryKeys(m);
      assert.deepEqual(f.load().retainedPlexHistoryKeys(m), [
        '10',
        '20',
        '30',
        '40',
      ]);
    }
  } finally {
    f.close();
  }
});
it('never crosses media type, TMDB identity or Plex server boundaries', () => {
  const f = fixture();
  try {
    const m = { mediaType: 'tv', tmdbId: 123, ratingKey: '10' };
    f.load().preservePlexHistoryKeys(m);
    assert.deepEqual(
      f.load().retainedPlexHistoryKeys({ ...m, mediaType: 'movie' }),
      []
    );
    assert.deepEqual(
      f.load().retainedPlexHistoryKeys({ ...m, tmdbId: 124 }),
      []
    );
    f.settings.plex.machineId = 'server-b';
    assert.deepEqual(f.load().retainedPlexHistoryKeys(m), []);
  } finally {
    f.close();
  }
});
it('deduplicates repeated scans and refuses corrupt history instead of replacing it', () => {
  const f = fixture();
  try {
    const m = {
      mediaType: 'movie',
      tmdbId: 123,
      ratingKey: '10',
      ratingKey4k: '10',
    };
    f.load().preservePlexHistoryKeys(m);
    f.load().preservePlexHistoryKeys(m);
    assert.deepEqual(f.load().retainedPlexHistoryKeys(m), ['10']);
    const file = path.join(f.dir, 'plex-history-keys.json');
    fs.writeFileSync(file, 'broken');
    assert.throws(() => f.load().preservePlexHistoryKeys(m));
    assert.equal(fs.readFileSync(file, 'utf8'), 'broken');
  } finally {
    f.close();
  }
});
it('actual scanner preserves prior IDs before replacing a movie or updated series', async () => {
  const f = fixture();
  try {
    const history = f.load();
    const constants = realRequire('../constants/media');
    let media: any;
    let saved = 0;
    const mocks: any = {
      '@server/lib/plexHistoryKeys': history,
      '@server/constants/media': constants,
      '@server/datasource': {
        getRepository: () => ({
          findOne: async () => media,
          save: async () => {
            saved++;
          },
        }),
      },
      '@server/utils/asyncLock': class {
        dispatch(_id: number, fn: () => any) {
          return fn();
        }
      },
      '@server/logger': { info() {}, debug() {}, warn() {}, error() {} },
    };
    const exports: any = {};
    const code = ts.transpileModule(
      fs.readFileSync(path.join(__dirname, 'scanners/baseScanner.ts'), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      }
    ).outputText;
    new Function('require', 'exports', code)(
      (name: string) =>
        name in mocks
          ? mocks[name]
          : name === 'crypto'
            ? realRequire(name)
            : class {},
      exports
    );
    const scanner = new exports.default('test');
    media = {
      mediaType: 'movie',
      tmdbId: 123,
      ratingKey: '10',
      status: 5,
      status4k: 1,
    };
    await scanner.processMovie(123, { ratingKey: '30' });
    assert.equal(media.ratingKey, '30');
    assert.deepEqual(history.retainedPlexHistoryKeys(media), ['10']);
    media = {
      mediaType: 'tv',
      tmdbId: 124,
      ratingKey: '20',
      status: 5,
      status4k: 1,
      seasons: [{ seasonNumber: 1, status: 5, status4k: 1 }],
    };
    await scanner.processShow(
      124,
      undefined,
      [{ seasonNumber: 1, episodes: 2, episodes4k: 0, totalEpisodes: 2 }],
      { ratingKey: '40' }
    );
    assert.equal(media.ratingKey, '40');
    assert.deepEqual(history.retainedPlexHistoryKeys(media), ['20']);
    assert.equal(saved, 2);
  } finally {
    f.close();
  }
});
