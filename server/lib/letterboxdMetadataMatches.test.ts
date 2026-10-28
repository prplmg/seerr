import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';
it('retains individual matches across failed exports and process reloads without accepting unsafe identities', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-matches-'));
  const load = () => {
    const api: any = {};
    const code = ts.transpileModule(
      fs.readFileSync(
        path.join(__dirname, 'letterboxdMetadataMatches.ts'),
        'utf8'
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          esModuleInterop: true,
        },
      }
    ).outputText;
    new Function('require', 'exports', code)(
      (name: string) =>
        name === '@server/utils/appDataVolume'
          ? { appDataPath: () => dir }
          : require(name),
      api
    );
    return api;
  };
  try {
    const api = load(),
      url = 'https://letterboxd.com/film/chernobyl/';
    const value = { externalUrl: url, tmdbId: 87108, mediaType: 'tv' };
    api.saveMetadataMatch(url, value);
    api.saveMetadataMatch('https://boxd.it/abc123', value);
    assert.deepEqual(load().readMetadataMatch('https://boxd.it/abc123'),value);
    assert.deepEqual(load().readMetadataMatch(url), value);
    api.saveMetadataMatch('https://attacker.test/', value);
    api.saveMetadataMatch(url, { ...value, tmdbId: 0 });
    assert.deepEqual(load().readMetadataMatch(url), value);
    assert.equal(api.readMetadataMatch('https://attacker.test/'), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
