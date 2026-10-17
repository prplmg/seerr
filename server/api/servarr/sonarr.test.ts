import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import type { AxiosInstance } from 'axios';

import SonarrAPI from '@server/api/servarr/sonarr';

function buildSonarr(): SonarrAPI {
  return new SonarrAPI({ url: 'http://localhost:8989/api/v3', apiKey: 'test' });
}

function getAxios(sonarr: SonarrAPI): AxiosInstance {
  return (sonarr as unknown as { axios: AxiosInstance }).axios;
}

describe('Sonarr initial-search selection', () => {
  afterEach(() => mock.restoreAll());
  for (const searchNow of [false, true]) {
    it(`adds a monitored series with searchNow=${searchNow}`, async () => {
      const sonarr = buildSonarr();
      mock.method(sonarr, 'getSeriesByTvdbId', async () => ({
        seasons: [{ seasonNumber: 1 }, { seasonNumber: 2 }],
      }));
      const post = mock.method(getAxios(sonarr), 'post', async () => ({
        data: { id: 9 },
      }));
      await sonarr.addSeries({
        tvdbid: 1234,
        title: 'Test',
        profileId: 1,
        rootFolderPath: '/tv',
        seasons: [1],
        monitored: true,
        searchNow,
        seasonFolder: true,
        seriesType: 'standard',
      });
      const body = post.mock.calls[0].arguments[1] as any;
      assert.equal(body.monitored, true);
      assert.equal(body.addOptions.searchForMissingEpisodes, searchNow);
      assert.equal(
        body.seasons.find((season: any) => season.seasonNumber === 1).monitored,
        true
      );
      assert.equal(
        body.seasons.find((season: any) => season.seasonNumber === 2).monitored,
        false
      );
    });
    it(`updates an existing monitored series with searchNow=${searchNow}`, async () => {
      const sonarr = buildSonarr();
      mock.method(sonarr, 'getSeriesByTvdbId', async () => ({
        id: 9,
        tags: [],
        seasons: [{ seasonNumber: 1, monitored: false }],
      }));
      mock.method(getAxios(sonarr), 'put', async (_url: string, body: any) => ({
        data: body,
      }));
      mock.method(sonarr, 'getEpisodes', async () => []);
      const search = mock.method(sonarr, 'searchSeries', async () => ({}));
      await sonarr.addSeries({
        tvdbid: 1234,
        title: 'Test',
        profileId: 1,
        rootFolderPath: '/tv',
        seasons: [1],
        monitored: true,
        searchNow,
        seasonFolder: true,
        seriesType: 'standard',
      });
      assert.equal(search.mock.callCount(), searchNow ? 1 : 0);
    });
  }
});

describe('SonarrAPI removeSeries', () => {
  afterEach(() => mock.restoreAll());

  it('removes the series when it exists in the library', async () => {
    const sonarr = buildSonarr();
    mock.method(SonarrAPI.prototype, 'getSeriesByTvdbId', async () => ({
      id: 9,
      title: 'Test Series',
    }));
    const del = mock.method(getAxios(sonarr), 'delete', async () => ({}));

    await sonarr.removeSeries(1234);

    assert.strictEqual(del.mock.callCount(), 1);
    assert.strictEqual(del.mock.calls[0].arguments[0], '/series/9');
  });

  it('does nothing when the series is not in the library', async () => {
    const sonarr = buildSonarr();
    mock.method(getAxios(sonarr), 'get', async () => ({
      data: [{ id: 0, title: 'Breaking Bad' }],
    }));
    const del = mock.method(getAxios(sonarr), 'delete', async () => ({}));

    await assert.doesNotReject(() => sonarr.removeSeries(1234));
    assert.strictEqual(del.mock.callCount(), 0);
  });

  it('rejects when the tvdbId is unknown to the lookup', async () => {
    const sonarr = buildSonarr();
    mock.method(getAxios(sonarr), 'get', async () => ({ data: [] }));
    const del = mock.method(getAxios(sonarr), 'delete', async () => ({}));

    await assert.rejects(() => sonarr.removeSeries(1234), /Series not found/);
    assert.strictEqual(del.mock.callCount(), 0);
  });

  it('ignores a 404 when the series was already removed in Sonarr', async () => {
    const sonarr = buildSonarr();
    mock.method(SonarrAPI.prototype, 'getSeriesByTvdbId', async () => ({
      id: 9,
      title: 'Test Series',
    }));
    mock.method(getAxios(sonarr), 'delete', async () => {
      throw { response: { status: 404 } };
    });

    await assert.doesNotReject(() => sonarr.removeSeries(1234));
  });

  it('rethrows errors other than 404', async () => {
    const sonarr = buildSonarr();
    mock.method(SonarrAPI.prototype, 'getSeriesByTvdbId', async () => ({
      id: 9,
      title: 'Test Series',
    }));
    mock.method(getAxios(sonarr), 'delete', async () => {
      throw { response: { status: 500 } };
    });

    await assert.rejects(() => sonarr.removeSeries(1234));
  });

  it('rethrows a 404 from the lookup instead of treating it as removed', async () => {
    const sonarr = buildSonarr();
    mock.method(getAxios(sonarr), 'get', async () => {
      throw { response: { status: 404 } };
    });
    const del = mock.method(getAxios(sonarr), 'delete', async () => ({}));

    await assert.rejects(
      () => sonarr.removeSeries(1234),
      (e: unknown) =>
        (e as { response?: { status?: number } }).response?.status === 404
    );
    assert.strictEqual(del.mock.callCount(), 0);
  });
});

describe('SonarrAPI getSeriesByTvdbId', () => {
  afterEach(() => mock.restoreAll());

  it('rethrows a 401 from the lookup with the status intact', async () => {
    const sonarr = buildSonarr();
    mock.method(getAxios(sonarr), 'get', async () => {
      throw { response: { status: 401 } };
    });

    await assert.rejects(
      () => sonarr.getSeriesByTvdbId(1234),
      (e: unknown) =>
        (e as { response?: { status?: number } }).response?.status === 401
    );
  });

  it('throws "Series not found" when the lookup returns no results', async () => {
    const sonarr = buildSonarr();
    mock.method(getAxios(sonarr), 'get', async () => ({ data: [] }));

    await assert.rejects(() => sonarr.getSeriesByTvdbId(1234), {
      message: 'Series not found',
    });
  });
});
